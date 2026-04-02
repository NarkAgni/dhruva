/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
* * This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
* * This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
* * You should have received a copy of the GNU General Public License
* along with this program. If not, see https://www.gnu.org/licenses/. 
*/


import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const DIGIT_SYMBOLS = new Map([
    [Clutter.KEY_1, 1], [Clutter.KEY_KP_1, 1],
    [Clutter.KEY_2, 2], [Clutter.KEY_KP_2, 2],
    [Clutter.KEY_3, 3], [Clutter.KEY_KP_3, 3],
    [Clutter.KEY_4, 4], [Clutter.KEY_KP_4, 4],
    [Clutter.KEY_5, 5], [Clutter.KEY_KP_5, 5],
    [Clutter.KEY_6, 6], [Clutter.KEY_KP_6, 6],
    [Clutter.KEY_7, 7], [Clutter.KEY_KP_7, 7],
    [Clutter.KEY_8, 8], [Clutter.KEY_KP_8, 8],
    [Clutter.KEY_9, 9], [Clutter.KEY_KP_9, 9],
]);

export default class QuickLaunchManager {
    constructor(settings, getTargetDock) {
        this._destroyed = false;
        this.settings = settings;
        this.getTargetDock = getTargetDock;
        this._stageCaptureId = null;

        this._stageCaptureId = global.stage.connect('captured-event', (_stage, event) => {
            return this._onCapturedEvent(event);
        });
    }

    _onCapturedEvent(event) {
        if (this._destroyed) return Clutter.EVENT_PROPAGATE;
        if (!event || event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
        if (Main.overview.visible) return Clutter.EVENT_PROPAGATE;
        if (this._isLikelyTextInputFocused()) return Clutter.EVENT_PROPAGATE;

        const state = event.get_state ? event.get_state() : 0;
        if (!this._isConfiguredModifierPressed(state)) return Clutter.EVENT_PROPAGATE;

        const digit = DIGIT_SYMBOLS.get(event.get_key_symbol ? event.get_key_symbol() : 0);
        if (!digit) return Clutter.EVENT_PROPAGATE;

        const dock = this.getTargetDock ? this.getTargetDock() : null;
        if (!dock || dock._isDestroyed || !dock.boxActor) return Clutter.EVENT_PROPAGATE;

        let target = this._resolveTargetByDigit(dock, digit);
        if (!target && typeof dock._renderDock === 'function') {
            try { dock._renderDock(true); } catch (_e) { }
            target = this._resolveTargetByDigit(dock, digit);
        }
        if (!target || typeof target._activateCallback !== 'function') return Clutter.EVENT_PROPAGATE;

        try {
            if (dock.actor) dock.actor._lastIconClickTime = Date.now();
            target._activateCallback(1, 0);
            return Clutter.EVENT_STOP;
        } catch (_e) {
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _isConfiguredModifierPressed(state) {
        const hasCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const hasAlt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const hasSuper =
            (state & Clutter.ModifierType.SUPER_MASK) !== 0 ||
            (state & Clutter.ModifierType.MOD4_MASK) !== 0;
        const hasShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (hasSuper || hasShift) return false;

        let modifier = 'ctrl';
        try {
            modifier = this.settings.get_string('quick-launch-modifier') || 'ctrl';
        } catch (_e) { }

        if (modifier === 'alt') return hasAlt && !hasCtrl;
        return hasCtrl && !hasAlt;
    }

    _isLikelyTextInputFocused() {
        const focusActor = global.stage.get_key_focus ? global.stage.get_key_focus() : null;
        if (!focusActor) return false;

        if (focusActor instanceof St.Entry)
            return true;

        let parent = focusActor;
        for (let i = 0; i < 5 && parent; i++) {
            if (parent instanceof St.Entry)
                return true;
            if (typeof parent.get_parent !== 'function')
                break;
            parent = parent.get_parent();
        }
        return false;
    }

    _resolveTargetByDigit(dock, digit) {
        const children = dock.boxActor && typeof dock.boxActor.get_children === 'function'
            ? dock.boxActor.get_children()
            : [];

        const targets = [];

        children.forEach(child => {
            if (!child) return;
            if (child._isExternal) return;
            if (child.visible === false) return;
            if (typeof child._activateCallback !== 'function') return;

            const sClass = typeof child.get_style_class_name === 'function'
                ? child.get_style_class_name()
                : (child.style_class || '');
            if (!sClass.includes('dock-app-button')) return;

            targets.push(child);
        });

        const index = digit - 1;
        if (index < 0 || index >= targets.length) return null;
        return targets[index];
    }

    destroy() {
        this._destroyed = true;

        if (this._stageCaptureId) {
            try { global.stage.disconnect(this._stageCaptureId); } catch (_e) { }
            this._stageCaptureId = null;
        }

        this.settings = null;
        this.getTargetDock = null;
    }
}
