import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import { CRTMinimize, CRTRestore } from './CrtEffect.js';
import { SnakeMinimize, SnakeRestore } from './SnakeEffect.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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

let _minimizeSignalId = 0;
let _unminimizeSignalId = 0;

let _origShouldAnimate = null;
let _origCompletedMinimize = null;
let _origCompletedUnminimize = null;

function _makeMinimize(iconPos, dockPos, type) {
    switch (type) {
        case 'magic-lamp': return new MagicLampMinimize(iconPos, dockPos);
        case 'snake':      return new SnakeMinimize(iconPos, dockPos);
        case 'vortex':     return new VortexMinimize(iconPos, dockPos);
        case 'crt':        return new CRTMinimize(iconPos, dockPos);
        case 'origami':    return new OrigamiMinimize(iconPos, dockPos);
        case 'jelly':      return new JellyMinimize(iconPos, dockPos);
        default:           return new MagicLampMinimize(iconPos, dockPos);
    }
}

function _makeRestore(iconPos, dockPos, type) {
    switch (type) {
        case 'magic-lamp': return new MagicLampRestore(iconPos, dockPos);
        case 'snake':      return new SnakeRestore(iconPos, dockPos);
        case 'vortex':     return new VortexRestore(iconPos, dockPos);
        case 'crt':        return new CRTRestore(iconPos, dockPos);
        case 'origami':    return new OrigamiRestore(iconPos, dockPos);
        case 'jelly':      return new JellyRestore(iconPos, dockPos);
        default:           return new MagicLampRestore(iconPos, dockPos);
    }
}

function _patchWm() {
    if (_origShouldAnimate) return;

    _origShouldAnimate = Main.wm._shouldAnimateActor;
    Main.wm._shouldAnimateActor = function(actor, types) {
        if (actor === _pendingActor || actor === _pendingLaunchActor) return false;
        return _origShouldAnimate.call(this, actor, types);
    };

    const shellwm = Main.wm._shellwm;
    
    _origCompletedMinimize = shellwm.completed_minimize;
    shellwm.completed_minimize = function(actor) {
        if (actor === _pendingActor) return; 
        _origCompletedMinimize.call(this, actor);
    };

    _origCompletedUnminimize = shellwm.completed_unminimize;
    shellwm.completed_unminimize = function(actor) {
        if (actor === _pendingActor) return;
        _origCompletedUnminimize.call(this, actor);
    };
}

function _unpatchWm() {
    if (!_origShouldAnimate) return;

    Main.wm._shouldAnimateActor = _origShouldAnimate;
    Main.wm._shellwm.completed_minimize = _origCompletedMinimize;
    Main.wm._shellwm.completed_unminimize = _origCompletedUnminimize;

    _origShouldAnimate = null;
    _origCompletedMinimize = null;
    _origCompletedUnminimize = null;
}

export function finishMinimizeEffect(actor) {
    if (_origCompletedMinimize) _origCompletedMinimize.call(Main.wm._shellwm, actor);
}

export function finishRestoreEffect(actor) {
    if (_origCompletedUnminimize) _origCompletedUnminimize.call(Main.wm._shellwm, actor);
}

export function setupWindowEffects(settings) {
    _settings = settings;
    _patchWm();

    _minimizeSignalId = global.window_manager.connect('minimize', (_wm, actor) => {
        const type = _settings?.get_string('minimize-effect') ?? 'magic-lamp';
        if (actor !== _pendingActor || !_pendingIcon || type === 'none') {
            if (_origCompletedMinimize) _origCompletedMinimize.call(Main.wm._shellwm, actor);
            return;
        }

        const iconPos = _pendingIcon;
        const dockPos = _pendingDockPos;
        _pendingActor = _pendingIcon = _pendingDockPos = null;

        const old = actor.get_effect(MIN_EFFECT_NAME);
        if (old) actor.remove_effect(old);

        actor.add_effect_with_name(MIN_EFFECT_NAME, _makeMinimize(iconPos, dockPos, type));
    });

    _unminimizeSignalId = global.window_manager.connect('unminimize', (_wm, actor) => {
        const type = _settings?.get_string('minimize-effect') ?? 'magic-lamp';
        if (actor !== _pendingActor || !_pendingIcon || type === 'none') {
            if (_origCompletedUnminimize) _origCompletedUnminimize.call(Main.wm._shellwm, actor);
            return;
        }

        const iconPos = _pendingIcon;
        const dockPos = _pendingDockPos;
        _pendingActor = _pendingIcon = _pendingDockPos = null;

        const old = actor.get_effect(UNMIN_EFFECT_NAME);
        if (old) actor.remove_effect(old);

        actor.show();
        actor.set_opacity(255);
        actor.add_effect_with_name(UNMIN_EFFECT_NAME, _makeRestore(iconPos, dockPos, type));
    });
}

export function teardownWindowEffects() {
    if (_minimizeSignalId) { 
        global.window_manager.disconnect(_minimizeSignalId); 
        _minimizeSignalId = 0; 
    }
    if (_unminimizeSignalId) { 
        global.window_manager.disconnect(_unminimizeSignalId); 
        _unminimizeSignalId = 0; 
    }
    
    _pendingActor = null;
    _pendingIcon = null;
    _pendingDockPos = null;
    _pendingLaunchActor = null;
    _settings = null;
    
    _unpatchWm();
}

export function animateMinimize(win, btn, dockPosition) {
    const wa = win.get_compositor_private();
    if (!wa) { 
        win.minimize(); 
        return; 
    }

    const [ix, iy] = btn.get_transformed_position();
    const [iw, ih] = btn.get_transformed_size();
    
    _pendingActor = wa;
    _pendingIcon = { x: ix, y: iy, w: iw, h: ih };
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

    const [ix, iy] = btn.get_transformed_position();
    const [iw, ih] = btn.get_transformed_size();
    
    _pendingActor = wa;
    _pendingIcon = { x: ix, y: iy, w: iw, h: ih };
    _pendingDockPos = dockPosition;
    
    win.unminimize();
    win.activate(global.get_current_time());
}

export function animateLaunch(win, btn, _dockPosition) {
    const actor = win.get_compositor_private();
    if (!actor) return;

    _pendingLaunchActor = actor;
    actor.remove_all_transitions();

    const [ix, iy] = btn.get_transformed_position();
    const [iw, ih] = btn.get_transformed_size();
    const frameRect = win.get_frame_rect();
    const winCX = frameRect.x + frameRect.width / 2;
    const winCY = frameRect.y + frameRect.height / 2;
    const iconCX = ix + iw / 2;
    const iconCY = iy + ih / 2;

    actor.set_pivot_point(0.5, 0.5);
    actor.translation_x = iconCX - winCX;
    actor.translation_y = iconCY - winCY;
    actor.set_scale(0.01, 0.01);
    actor.opacity = 0;
    actor.show();

    global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
        actor.ease({
            translation_x: 0,
            translation_y: 0,
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
            duration: 400,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => {
                actor.set_scale(1.0, 1.0);
                actor.translation_x = 0;
                actor.translation_y = 0;
                actor.set_pivot_point(0, 0);
                if (_pendingLaunchActor === actor) _pendingLaunchActor = null;
            }
        });
        return false;
    });
}