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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { CRTMinimize, CRTRestore } from './CrtEffect.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { SnakeMinimize, SnakeRestore } from './SnakeEffect.js';
import { JellyMinimize, JellyRestore } from './JellyEffect.js';
import { VortexMinimize, VortexRestore } from './VortexEffect.js';
import { OrigamiMinimize, OrigamiRestore } from './OrigamiEffect.js';
import { MagicLampMinimize, MagicLampRestore } from './GenieEffect.js';


const MIN_EFFECT_NAME = 'we-minimize-effect';
const UNMIN_EFFECT_NAME = 'we-unminimize-effect';

let _pendingActor = null;
let _pendingIcon = null;
let _pendingDockPos = null;
let _pendingLaunchActor = null;
let _settings = null;
let _dockUI = null;
let _setupRefCount = 0;

const _animatingActors = new Set();
let _effectTimers = null;

let _origShouldAnimate = null;
let _origCompletedMinimize = null;
let _origCompletedUnminimize = null;
let _origCompletedMap = null;

function _isActorUsable(actor) {
    if (!actor) return false;
    return actor.visible !== undefined;
}

function _addEffectIdle(cb) {
    _effectTimers.addIdle(GLib.PRIORITY_DEFAULT, () => {
        cb();
        return GLib.SOURCE_REMOVE;
    });
}

function _clearEffectIdles() {
    _effectTimers.destroy();
}

function _resolveIconRect(btn, win) {
    if (_isActorUsable(btn)) {
        const [x, y] = btn.get_transformed_position();
        const [w, h] = btn.get_transformed_size();
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            return { x, y, w, h };
        }
    }

    if (win) {
        const frameRect = win.get_frame_rect();
        if (frameRect && Number.isFinite(frameRect.x) && Number.isFinite(frameRect.y) &&
            Number.isFinite(frameRect.width) && Number.isFinite(frameRect.height)) {
            const cx = frameRect.x + frameRect.width / 2;
            const cy = frameRect.y + frameRect.height / 2;
            return { x: cx - 0.5, y: cy - 0.5, w: 1, h: 1 };
        }
    }

    return { x: 0, y: 0, w: 1, h: 1 };
}

function _makeMinimize(iconPos, dockPos, type) {
    switch (type) {
        case 'magic-lamp':
            return new MagicLampMinimize(iconPos, dockPos);
        case 'snake':
            return new SnakeMinimize(iconPos, dockPos);
        case 'vortex':
            return new VortexMinimize(iconPos, dockPos);
        case 'crt':
            return new CRTMinimize(iconPos, dockPos);
        case 'origami':
            return new OrigamiMinimize(iconPos, dockPos);
        case 'jelly':
            return new JellyMinimize(iconPos, dockPos);
        default:
            return new MagicLampMinimize(iconPos, dockPos);
    }
}

function _makeRestore(iconPos, dockPos, type) {
    switch (type) {
        case 'magic-lamp':
            return new MagicLampRestore(iconPos, dockPos);
        case 'snake':
            return new SnakeRestore(iconPos, dockPos);
        case 'vortex':
            return new VortexRestore(iconPos, dockPos);
        case 'crt':
            return new CRTRestore(iconPos, dockPos);
        case 'origami':
            return new OrigamiRestore(iconPos, dockPos);
        case 'jelly':
            return new JellyRestore(iconPos, dockPos);
        default:
            return new MagicLampRestore(iconPos, dockPos);
    }
}

function _patchWm() {
    if (_origShouldAnimate) return;
    if (!Main.wm || !Main.wm._shellwm || !Main.wm._shouldAnimateActor) {
        return;
    }

    _origShouldAnimate = Main.wm._shouldAnimateActor;
    Main.wm._shouldAnimateActor = function (actor, types) {
        if (actor === _pendingActor || actor === _pendingLaunchActor || _animatingActors.has(actor)) return false;

        if (actor.meta_window && _dockUI && _dockUI._pendingLaunches && _dockUI._pendingLaunches.length > 0) {
            const tracker = Shell.WindowTracker.get_default();
            const winApp = tracker.get_window_app(actor.meta_window);
            const winClass = actor.meta_window.get_wm_class() ? actor.meta_window.get_wm_class().toLowerCase() : '';

            const isPending = _dockUI._pendingLaunches.some(p => {
                if (p.consumed) return false;

                if (p.appId && winApp && winApp.get_id() === p.appId) {
                    return true;
                } else if (p.appId && winClass) {
                    const appBase = p.appId.toLowerCase().replace('.desktop', '');
                    if (appBase.includes(winClass) || winClass.includes(appBase)) {
                        return true;
                    }
                } else if (p.isFolder && (winClass.includes('nautilus') || winClass.includes('files'))) {
                    return true;
                }

                return false;
            });

            if (isPending) return false;
        }

        return _origShouldAnimate.call(this, actor, types);
    };

    const shellwm = Main.wm._shellwm;

    _origCompletedMinimize = shellwm.completed_minimize;
    shellwm.completed_minimize = function (actor) {
        if (actor === _pendingActor || _animatingActors.has(actor)) return;
        _origCompletedMinimize.call(this, actor);
    };

    _origCompletedUnminimize = shellwm.completed_unminimize;
    shellwm.completed_unminimize = function (actor) {
        if (actor === _pendingActor || _animatingActors.has(actor)) return;
        _origCompletedUnminimize.call(this, actor);
    };

    _origCompletedMap = shellwm.completed_map;
    shellwm.completed_map = function (actor) {
        if (_animatingActors.has(actor)) return;
        _origCompletedMap.call(this, actor);
    };
}

function _unpatchWm() {
    if (!_origShouldAnimate) return;

    if (Main.wm) Main.wm._shouldAnimateActor = _origShouldAnimate;
    if (Main.wm && Main.wm._shellwm) {
        Main.wm._shellwm.completed_minimize = _origCompletedMinimize;
        Main.wm._shellwm.completed_unminimize = _origCompletedUnminimize;
        if (_origCompletedMap) Main.wm._shellwm.completed_map = _origCompletedMap;
    }

    _origShouldAnimate = null;
    _origCompletedMinimize = null;
    _origCompletedUnminimize = null;
    _origCompletedMap = null;
}

export function finishMinimizeEffect(actor) {
    _animatingActors.delete(actor);
    if (!_isActorUsable(actor)) return;
    if (_origCompletedMinimize && Main.wm && Main.wm._shellwm)
        _origCompletedMinimize.call(Main.wm._shellwm, actor);
}

export function finishRestoreEffect(actor) {
    _animatingActors.delete(actor);
    if (!_isActorUsable(actor)) return;

    if (actor._isDhruvaLaunching) {
        actor._isDhruvaLaunching = false;
        if (_origCompletedMap && Main.wm && Main.wm._shellwm) {
            _origCompletedMap.call(Main.wm._shellwm, actor);
        }
    } else {
        if (_origCompletedUnminimize && Main.wm && Main.wm._shellwm)
            _origCompletedUnminimize.call(Main.wm._shellwm, actor);
    }
}

export function setupWindowEffects(settings, dockUI) {
    _settings = settings;
    _dockUI = dockUI;
    _setupRefCount++;
    if (_setupRefCount > 1) return;

    if (!_effectTimers) {
        _effectTimers = new TimeoutTracker();
    }

    _patchWm();

    global.window_manager.connectObject(
        'minimize', (_wm, actor) => {
            const type = (_settings && _settings.get_string('minimize-effect')) || 'magic-lamp';

            if (actor === _pendingActor && global._dhruvaIsFade) {
                global._dhruvaIsFade = false;

                const capturedActor = _pendingActor;
                _addEffectIdle(() => {
                    if (_pendingActor === capturedActor) _pendingActor = null;
                });

                _animatingActors.add(actor);
                if (actor.remove_all_transitions) actor.remove_all_transitions();

                actor.set_pivot_point(0.5, 0.5);
                actor.ease({
                    opacity: 0,
                    scale_x: 0.93,
                    scale_y: 0.93,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        _animatingActors.delete(actor);
                        actor.set_pivot_point(0, 0);
                        if (_origCompletedMinimize && Main.wm && Main.wm._shellwm)
                            _origCompletedMinimize.call(Main.wm._shellwm, actor);
                    }
                });
                return;
            }

            if (type === 'none') {
                if (_origCompletedMinimize && Main.wm && Main.wm._shellwm && _isActorUsable(actor))
                    _origCompletedMinimize.call(Main.wm._shellwm, actor);
                return;
            }

            let iconPos = null;
            let dockPos = null;
            let isOurAnimation = false;

            if (actor === _pendingActor && _pendingIcon) {
                iconPos = _pendingIcon;
                dockPos = _pendingDockPos;
                isOurAnimation = true;

                const capturedActor = _pendingActor;
                _addEffectIdle(() => {
                    if (_pendingActor === capturedActor) {
                        _pendingActor = _pendingIcon = _pendingDockPos = null;
                    }
                });
            }
            else if (_dockUI && _dockUI.boxActor && actor.meta_window) {
                const win = actor.meta_window;
                const tracker = Shell.WindowTracker.get_default();
                const app = tracker.get_window_app(win);

                if (app) {
                    const appId = app.get_id();
                    const children = _dockUI.boxActor.get_children();

                    for (let i = 0; i < children.length; i++) {
                        const btn = children[i];
                        const delegate = btn._delegate;
                        if (delegate && delegate.app && 'get_id' in delegate.app && delegate.app.get_id() === appId) {
                            iconPos = _resolveIconRect(btn, win);
                            dockPos = _dockUI.dockPosition;
                            isOurAnimation = true;
                            break;
                        }
                    }
                }
            }

            if (!isOurAnimation) {
                if (_origCompletedMinimize && Main.wm && Main.wm._shellwm && _isActorUsable(actor))
                    _origCompletedMinimize.call(Main.wm._shellwm, actor);
                return;
            }

            _animatingActors.add(actor);

            if (actor.remove_all_transitions) {
                actor.remove_all_transitions();
            }

            const old = actor.get_effect(MIN_EFFECT_NAME);
            if (old) actor.remove_effect(old);

            actor.add_effect_with_name(MIN_EFFECT_NAME, _makeMinimize(iconPos, dockPos, type));
        },
        'unminimize', (_wm, actor) => {
            const type = (_settings && _settings.get_string('minimize-effect')) || 'magic-lamp';

            if (actor === _pendingActor && global._dhruvaIsFade) {
                global._dhruvaIsFade = false;

                const capturedActor = _pendingActor;
                _addEffectIdle(() => {
                    if (_pendingActor === capturedActor) _pendingActor = null;
                });

                _animatingActors.add(actor);
                if (actor.remove_all_transitions) actor.remove_all_transitions();

                actor.show();
                actor.opacity = 0;
                actor.set_pivot_point(0.5, 0.5);
                actor.set_scale(0.93, 0.93);

                actor.ease({
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        _animatingActors.delete(actor);
                        actor.set_pivot_point(0, 0);
                        if (_origCompletedUnminimize && Main.wm && Main.wm._shellwm)
                            _origCompletedUnminimize.call(Main.wm._shellwm, actor);
                    }
                });
                return;
            }

            if (type === 'none') {
                if (_origCompletedUnminimize && Main.wm && Main.wm._shellwm && _isActorUsable(actor))
                    _origCompletedUnminimize.call(Main.wm._shellwm, actor);
                return;
            }

            let iconPos = null;
            let dockPos = null;
            let isOurAnimation = false;

            if (actor === _pendingActor && _pendingIcon) {
                iconPos = _pendingIcon;
                dockPos = _pendingDockPos;
                isOurAnimation = true;

                const capturedActor = _pendingActor;
                _addEffectIdle(() => {
                    if (_pendingActor === capturedActor) {
                        _pendingActor = _pendingIcon = _pendingDockPos = null;
                    }
                });
            }
            else if (_dockUI && _dockUI.boxActor && actor.meta_window) {
                const win = actor.meta_window;
                const tracker = Shell.WindowTracker.get_default();
                const app = tracker.get_window_app(win);

                if (app) {
                    const appId = app.get_id();
                    const children = _dockUI.boxActor.get_children();

                    for (let i = 0; i < children.length; i++) {
                        const btn = children[i];
                        const delegate = btn._delegate;
                        if (delegate && delegate.app && 'get_id' in delegate.app && delegate.app.get_id() === appId) {
                            iconPos = _resolveIconRect(btn, win);
                            dockPos = _dockUI.dockPosition;
                            isOurAnimation = true;
                            break;
                        }
                    }
                }
            }

            if (!isOurAnimation) {
                if (_origCompletedUnminimize && Main.wm && Main.wm._shellwm && _isActorUsable(actor))
                    _origCompletedUnminimize.call(Main.wm._shellwm, actor);
                return;
            }

            _animatingActors.add(actor);

            if (actor.remove_all_transitions) {
                actor.remove_all_transitions();
            }

            const old = actor.get_effect(UNMIN_EFFECT_NAME);
            if (old) actor.remove_effect(old);

            actor.show();
            actor.set_opacity(255);
            actor.add_effect_with_name(UNMIN_EFFECT_NAME, _makeRestore(iconPos, dockPos, type));
        },
        _dockUI
    );
}

export function teardownWindowEffects() {
    if (_setupRefCount > 0) _setupRefCount--;
    if (_setupRefCount > 0) return;

    if (_dockUI) {
        global.window_manager.disconnectObject(_dockUI);
    }

    _clearEffectIdles();

    if (_effectTimers) {
        _effectTimers = null;
    }

    _animatingActors.clear();

    _pendingActor = null;
    _pendingIcon = null;
    _pendingDockPos = null;
    _pendingLaunchActor = null;
    _settings = null;
    _dockUI = null;

    _unpatchWm();
}

export function animateMinimize(win, btn, dockPosition) {
    const wa = win.get_compositor_private();
    if (!wa) {
        win.minimize();
        return;
    }

    const iconRect = _resolveIconRect(btn, win);

    _pendingActor = wa;
    _pendingIcon = iconRect;
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

    const iconRect = _resolveIconRect(btn, win);

    _pendingActor = wa;
    _pendingIcon = iconRect;
    _pendingDockPos = dockPosition;

    win.unminimize();
    win.activate(global.get_current_time());
}

export function animateLaunch(win, btn, _dockPosition, iconRect = null) {
    const actor = win.get_compositor_private();

    if (!_isActorUsable(actor)) return;

    const type = (_settings && _settings.get_string('minimize-effect')) || 'magic-lamp';
    if (type === 'none') {
        if (_origCompletedMap && Main.wm && Main.wm._shellwm) {
            _origCompletedMap.call(Main.wm._shellwm, actor);
        }
        return;
    }

    _animatingActors.add(actor);
    actor._isDhruvaLaunching = true;

    if (actor.remove_all_transitions) actor.remove_all_transitions();

    const old = actor.get_effect(UNMIN_EFFECT_NAME);
    if (old) actor.remove_effect(old);

    const resolvedIconRect = iconRect || _resolveIconRect(btn, win);

    actor.show();
    actor.set_opacity(255);
    actor.add_effect_with_name(UNMIN_EFFECT_NAME, _makeRestore(resolvedIconRect, _dockPosition, type));
}

export function fadeMinimize(win) {
    const wa = win.get_compositor_private();
    if (!wa) { win.minimize(); return; }

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