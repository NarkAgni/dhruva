/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program. If not, see <https://www.gnu.org/licenses/>.
*/


import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

import { Settings } from '../../core/SettingsManager.js';
import { getWindowAnimationFilter, setWindowAnimationFilter } from '../../core/Compat.js';
import { CRTMinimize, CRTRestore } from './CrtEffect.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { SnakeMinimize, SnakeRestore } from './SnakeEffect.js';
import { JellyMinimize, JellyRestore } from './JellyEffect.js';
import { VortexMinimize, VortexRestore } from './VortexEffect.js';
import { OrigamiMinimize, OrigamiRestore } from './OrigamiEffect.js';
import { isActorAlive, captureActorRect } from '../../core/Utils.js';
import { getWindowIdentity, hasPendingLaunchFor } from '../dock/LaunchMatcher.js';
import { MagicLampMinimize, MagicLampRestore } from './GenieEffect.js';


const MIN_EFFECT_NAME = 'we-minimize-effect';
const UNMIN_EFFECT_NAME = 'we-unminimize-effect';
const DEFAULT_EFFECT_DURATION_MS = 350;
const LAUNCH_DURATION_RATIO = 0.4;
const LAUNCH_MAX_DURATION_MS = 250;

let _pendingActor = null;
let _pendingButton = null;
let _pendingDockPos = null;
let _pendingLaunchActor = null;
let _settings = null;
let _dockUI = null;
const _docks = [];
const WM_SIGNAL_OWNER = {};

const _animatingActors = [];
let _effectTimers = null;
let _effectIdleId = 0;

let _origShouldAnimate = null;
let _origCompletedMinimize = null;
let _origCompletedUnminimize = null;

const _hiddenThumbs = new Set();
let _minimizeStamps = new WeakMap();
let _minimizeCounter = 0;

export function isThumbnailHidden(win) {
    return _hiddenThumbs.has(win.get_compositor_private());
}

export function minimizeOrder(win) {
    return _minimizeStamps.get(win.get_compositor_private()) || 0;
}

function _findThumbnailButton(win) {
    for (const dock of _docks) {
        if (!isActorAlive(dock.boxActor)) continue;
        const btn = dock.boxActor.get_children().find(child => child._minimizedWindow === win);
        if (btn) return btn;
    }
    return null;
}

function _renderThumbnailDocks() {
    _docks.forEach(dock => dock.render('incremental', true));
}

function _revealThumbnail(actor) {
    if (!_hiddenThumbs.delete(actor) || !isActorAlive(actor)) return;
    const btn = _findThumbnailButton(actor.meta_window);
    if (btn) btn._revealThumbnail();
}

function _dropThumbnail(actor) {
    _hiddenThumbs.delete(actor);
    if (!Settings.minimizedThumbnails) return;
    const btn = _findThumbnailButton(actor.meta_window);
    if (btn) btn._hideThumbnail();
    _renderThumbnailDocks();
}

function _prepareThumbnail(actor, isAnimated) {
    if (!Settings.minimizedThumbnails) return;
    _minimizeStamps.set(actor, ++_minimizeCounter);
    if (isAnimated) _hiddenThumbs.add(actor);
    _renderThumbnailDocks();
}

function _findDockButtonForWindow(win) {
    const thumbnail = _findThumbnailButton(win);
    if (thumbnail) return thumbnail;

    const app = Shell.WindowTracker.get_default().get_window_app(win);
    if (!app) return null;

    const appId = app.get_id();
    return _dockUI.boxActor.get_children().find(btn => {
        const delegate = btn._delegate;
        return delegate && delegate.app && 'get_id' in delegate.app && delegate.app.get_id() === appId;
    }) || null;
}

function _getIconRect(btn, win) {
    const target = isActorAlive(btn._iconWrapper) ? btn._iconWrapper : btn;
    const rect = captureActorRect(target, win);
    const dock = _docks.find(d => isActorAlive(d.actor) && d.actor.contains(btn));
    if (dock) {
        rect.x -= dock.actor.translation_x;
        rect.y -= dock.actor.translation_y;
    }
    return rect;
}

function _createIconTracker(btn, win) {
    let source = btn;
    let isThumbnail = Boolean(btn._minimizedWindow);
    let lastRect = null;
    return () => {
        if ((!isActorAlive(source) || !source.get_stage()) && _dockUI) {
            if (isThumbnail && !win.minimized && lastRect) return lastRect;
            source = _findDockButtonForWindow(win);
            isThumbnail = Boolean(source && source._minimizedWindow);
        }
        if (source) lastRect = _getIconRect(source, win);
        return lastRect;
    };
}

function _startEffect(actor, effectName, effect, tracker) {
    effect.setIconTracker(tracker);
    actor.add_effect_with_name(effectName, effect);
}

function _getEffectDuration() {
    const val = Settings.windowEffectSpeed;
    return (Number.isFinite(val) && val >= 50) ? val : DEFAULT_EFFECT_DURATION_MS;
}

function _getLaunchDuration() {
    return Math.min(LAUNCH_MAX_DURATION_MS, Math.round(_getEffectDuration() * LAUNCH_DURATION_RATIO));
}

function _addAnimatingActor(actor) {
    if (!_animatingActors.includes(actor)) {
        _animatingActors.push(actor);
    }
}

function _removeAnimatingActor(actor) {
    const idx = _animatingActors.indexOf(actor);
    if (idx !== -1) _animatingActors.splice(idx, 1);
}

function _addEffectIdle(cb) {
    if (_effectTimers) {
        if (_effectIdleId) {
            _effectTimers.remove(_effectIdleId);
            _effectIdleId = 0;
        }
        _effectIdleId = _effectTimers.addIdle(GLib.PRIORITY_DEFAULT, () => {
            _effectIdleId = 0;
            cb();
            return GLib.SOURCE_REMOVE;
        });
    }
}

function _clearEffectIdles() {
    if (_effectIdleId && _effectTimers) {
        _effectTimers.remove(_effectIdleId);
        _effectIdleId = 0;
    }
    if (_effectTimers) {
        _effectTimers.destroy();
        _effectTimers = null;
    }
}

function _syncActorToWindow(actor) {
    const rect = actor.meta_window.get_buffer_rect();
    if (rect.width <= 0 || rect.height <= 0) return;
    actor.set_position(rect.x, rect.y);
    actor.set_size(rect.width, rect.height);
}

function _applyEffectDuration(effect, duration) {
    if (!effect) return null;
    effect._duration = duration;
    effect.duration = duration;
    if (effect.setDuration) effect.setDuration(duration);
    return effect;
}

function _makeMinimize(iconPos, dockPos, type) {
    const duration = _getEffectDuration();
    let effect;
    switch (type) {
        case 'magic-lamp': effect = new MagicLampMinimize(iconPos, dockPos); break;
        case 'snake': effect = new SnakeMinimize(iconPos, dockPos); break;
        case 'vortex': effect = new VortexMinimize(iconPos, dockPos); break;
        case 'crt': effect = new CRTMinimize(iconPos, dockPos); break;
        case 'origami': effect = new OrigamiMinimize(iconPos, dockPos); break;
        case 'jelly': effect = new JellyMinimize(iconPos, dockPos); break;
        default: effect = new MagicLampMinimize(iconPos, dockPos); break;
    }
    return _applyEffectDuration(effect, duration);
}

function _makeRestore(iconPos, dockPos, type, duration = _getEffectDuration()) {
    let effect;
    switch (type) {
        case 'magic-lamp': effect = new MagicLampRestore(iconPos, dockPos); break;
        case 'snake': effect = new SnakeRestore(iconPos, dockPos); break;
        case 'vortex': effect = new VortexRestore(iconPos, dockPos); break;
        case 'crt': effect = new CRTRestore(iconPos, dockPos); break;
        case 'origami': effect = new OrigamiRestore(iconPos, dockPos); break;
        case 'jelly': effect = new JellyRestore(iconPos, dockPos); break;
        default: effect = new MagicLampRestore(iconPos, dockPos); break;
    }
    return _applyEffectDuration(effect, duration);
}

function _resolveEffectTarget(actor) {
    const win = actor.meta_window;
    const isPending = actor === _pendingActor;
    const pendingButton = isPending ? _pendingButton : null;
    const dockPos = isPending ? _pendingDockPos : (_dockUI && _dockUI.dockPosition);

    if (isPending) {
        _addEffectIdle(() => {
            if (_pendingActor === actor) {
                _pendingActor = _pendingButton = _pendingDockPos = null;
            }
        });
    }

    const thumbnail = win ? _findThumbnailButton(win) : null;
    const btn = thumbnail || pendingButton || (_dockUI && _dockUI.boxActor && win ? _findDockButtonForWindow(win) : null);
    if (!btn) return null;

    const tracker = _createIconTracker(btn, win);
    const iconRect = tracker();
    if (!iconRect) return null;

    return { iconRect, dockPos, tracker };
}

function _completeMinimize(actor) {
    if (_origCompletedMinimize) _origCompletedMinimize.call(global.window_manager, actor);
}

function _completeUnminimize(actor) {
    if (_origCompletedUnminimize) _origCompletedUnminimize.call(global.window_manager, actor);
}

function _patchWm() {
    if (_origShouldAnimate) return;
    if (!getWindowAnimationFilter()) return;

    _origShouldAnimate = getWindowAnimationFilter();
    setWindowAnimationFilter(function (actor, types) {
        if (actor === _pendingActor || actor === _pendingLaunchActor || _animatingActors.includes(actor)) return false;

        if (actor.meta_window && _dockUI && _dockUI.pendingLaunches.length > 0) {
            const identity = getWindowIdentity(actor.meta_window, Shell.WindowTracker.get_default());
            if (hasPendingLaunchFor(_dockUI.pendingLaunches, identity)) return false;
        }

        return _origShouldAnimate.call(this, actor, types);
    });

    const shellwm = global.window_manager;

    _origCompletedMinimize = shellwm.completed_minimize;
    shellwm.completed_minimize = function (actor) {
        if (actor === _pendingActor || _animatingActors.includes(actor)) return;
        _origCompletedMinimize.call(this, actor);
    };

    _origCompletedUnminimize = shellwm.completed_unminimize;
    shellwm.completed_unminimize = function (actor) {
        if (actor === _pendingActor || _animatingActors.includes(actor)) return;
        _origCompletedUnminimize.call(this, actor);
    };
}

function _unpatchWm() {
    if (_origShouldAnimate) {
        const shellwm = global.window_manager;
        setWindowAnimationFilter(_origShouldAnimate);
        shellwm.completed_minimize = _origCompletedMinimize;
        shellwm.completed_unminimize = _origCompletedUnminimize;

        _origShouldAnimate = null;
        _origCompletedMinimize = null;
        _origCompletedUnminimize = null;
    }
}

export function finishMinimizeEffect(actor) {
    _removeAnimatingActor(actor);
    _revealThumbnail(actor);
    if (isActorAlive(actor)) _completeMinimize(actor);
}

export function finishRestoreEffect(actor) {
    _removeAnimatingActor(actor);
    if (isActorAlive(actor)) {
        if (actor._isDhruvaLaunching) actor._isDhruvaLaunching = false;
        else _completeUnminimize(actor);
    }
}

export function setupWindowEffects(settings, dockUI) {
    if (!_docks.includes(dockUI)) {
        _docks.push(dockUI);
    }
    if (_docks.length > 1) return;

    _settings = settings;
    _dockUI = dockUI;

    if (!_effectTimers) {
        _effectTimers = new TimeoutTracker();
    }

    _patchWm();

    global.window_manager.connectObject(
        'minimize', (_wm, actor) => {
            const type = (_settings && Settings.minimizeEffect) || 'magic-lamp';
            const isFade = actor === _pendingActor && global._dhruvaIsFade;
            _prepareThumbnail(actor, isFade || type !== 'none');

            if (isFade) {
                global._dhruvaIsFade = false;

                const capturedActor = _pendingActor;
                _addEffectIdle(() => {
                    if (_pendingActor === capturedActor) _pendingActor = null;
                });

                _addAnimatingActor(actor);
                if (actor.remove_all_transitions) actor.remove_all_transitions();

                const fadeDuration = Math.max(120, Math.round(_getEffectDuration() * 0.5));
                actor.set_pivot_point(0.5, 0.5);
                actor.ease({
                    opacity: 0,
                    scale_x: 0.95,
                    scale_y: 0.95,
                    duration: fadeDuration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        _removeAnimatingActor(actor);
                        _revealThumbnail(actor);
                        if (isActorAlive(actor)) {
                            actor.set_pivot_point(0, 0);
                            actor.set_scale(1.0, 1.0);
                            actor.opacity = 255;
                            actor.hide();
                            _completeMinimize(actor);
                        }
                    }
                });
                return;
            }

            if (type === 'none') {
                if (isActorAlive(actor)) _completeMinimize(actor);
                return;
            }

            const target = _resolveEffectTarget(actor);
            if (!target) {
                _revealThumbnail(actor);
                if (isActorAlive(actor)) _completeMinimize(actor);
                return;
            }

            _addAnimatingActor(actor);
            if (actor.remove_all_transitions) actor.remove_all_transitions();

            const old = actor.get_effect(MIN_EFFECT_NAME);
            if (old) actor.remove_effect(old);

            _startEffect(actor, MIN_EFFECT_NAME, _makeMinimize(target.iconRect, target.dockPos, type), target.tracker);
        },
        'unminimize', (_wm, actor) => {
            const type = (_settings && Settings.minimizeEffect) || 'magic-lamp';

            if (actor.meta_window) _syncActorToWindow(actor);

            if (actor === _pendingActor && global._dhruvaIsFade) {
                global._dhruvaIsFade = false;
                _dropThumbnail(actor);

                const capturedActor = _pendingActor;
                _addEffectIdle(() => {
                    if (_pendingActor === capturedActor) _pendingActor = null;
                });

                _addAnimatingActor(actor);
                if (actor.remove_all_transitions) actor.remove_all_transitions();

                const fadeDuration = Math.max(120, Math.round(_getEffectDuration() * 0.5));
                actor.show();
                actor.opacity = 0;
                actor.set_pivot_point(0.5, 0.5);
                actor.set_scale(0.95, 0.95);

                actor.ease({
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: fadeDuration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        _removeAnimatingActor(actor);
                        if (isActorAlive(actor)) {
                            actor.set_pivot_point(0, 0);
                            actor.set_scale(1.0, 1.0);
                            actor.opacity = 255;
                            _completeUnminimize(actor);
                        }
                    }
                });
                return;
            }

            if (type === 'none') {
                _dropThumbnail(actor);
                if (isActorAlive(actor)) _completeUnminimize(actor);
                return;
            }

            const target = _resolveEffectTarget(actor);
            _dropThumbnail(actor);
            if (!target) {
                if (isActorAlive(actor)) _completeUnminimize(actor);
                return;
            }

            _addAnimatingActor(actor);
            if (actor.remove_all_transitions) actor.remove_all_transitions();

            const old = actor.get_effect(UNMIN_EFFECT_NAME);
            if (old) actor.remove_effect(old);

            actor.show();
            actor.set_opacity(255);
            _startEffect(actor, UNMIN_EFFECT_NAME, _makeRestore(target.iconRect, target.dockPos, type), target.tracker);
        },
        WM_SIGNAL_OWNER
    );
}

export function teardownWindowEffects(dockUI) {
    const idx = _docks.indexOf(dockUI);
    if (idx !== -1) _docks.splice(idx, 1);
    if (_docks.length > 0) {
        if (_dockUI === dockUI) _dockUI = _docks[0];
    } else {
        global.window_manager.disconnectObject(WM_SIGNAL_OWNER);
        _clearEffectIdles();

        _animatingActors.length = 0;
        _hiddenThumbs.clear();
        _minimizeStamps = new WeakMap();
        _minimizeCounter = 0;
        _pendingActor = null;
        _pendingButton = null;
        _pendingDockPos = null;
        _pendingLaunchActor = null;
        _settings = null;
        _dockUI = null;

        _unpatchWm();
    }
}

export function animateMinimize(win, btn, dockPosition) {
    const wa = win.get_compositor_private();
    if (!wa) {
        win.minimize();
        return;
    }
    _pendingActor = wa;
    _pendingButton = btn;
    _pendingDockPos = dockPosition;
    win.minimize();
}

export function animateRestore(win, btn, dockPosition) {
    const wa = win.get_compositor_private();
    if (!wa) {
        win.unminimize();
        win.activate(global.get_current_time());
        return;
    }
    _pendingActor = wa;
    _pendingButton = btn;
    _pendingDockPos = dockPosition;
    win.unminimize();
    win.activate(global.get_current_time());
}

export function animateLaunch(win, btn, _dockPosition, iconRect = null) {
    const actor = win.get_compositor_private();
    if (!isActorAlive(actor)) return;

    const type = (_settings && Settings.minimizeEffect) || 'magic-lamp';
    if (type === 'none') return;

    _addAnimatingActor(actor);
    actor._isDhruvaLaunching = true;
    if (actor.remove_all_transitions) actor.remove_all_transitions();

    const old = actor.get_effect(UNMIN_EFFECT_NAME);
    if (old) actor.remove_effect(old);

    const tracker = _createIconTracker(btn, win);
    const resolvedIconRect = tracker() || iconRect || captureActorRect(btn, win);
    actor.show();
    actor.set_opacity(255);
    _startEffect(actor, UNMIN_EFFECT_NAME, _makeRestore(resolvedIconRect, _dockPosition, type, _getLaunchDuration()), tracker);
}

export function fadeMinimize(win) {
    const wa = win.get_compositor_private();
    if (!wa) {
        win.minimize();
        return;
    }
    _pendingActor = wa;
    global._dhruvaIsFade = true;
    win.minimize();
}

export function fadeRestore(win) {
    const wa = win.get_compositor_private();
    if (!wa) {
        win.unminimize();
        win.activate(global.get_current_time());
        return;
    }
    _pendingActor = wa;
    global._dhruvaIsFade = true;
    win.unminimize();
    win.activate(global.get_current_time());
}