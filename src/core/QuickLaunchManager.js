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


import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutTracker } from './TimeoutTracker.js';


const QUICK_LAUNCH_KEY_NAMES = [
    'quick-launch-accel-1', 'quick-launch-accel-2', 'quick-launch-accel-3',
    'quick-launch-accel-4', 'quick-launch-accel-5', 'quick-launch-accel-6',
    'quick-launch-accel-7', 'quick-launch-accel-8', 'quick-launch-accel-9',
];

const DIGIT_SYMBOLS = new Map([
    [Clutter.KEY_1, 1], [Clutter.KEY_2, 2], [Clutter.KEY_3, 3],
    [Clutter.KEY_4, 4], [Clutter.KEY_5, 5], [Clutter.KEY_6, 6],
    [Clutter.KEY_7, 7], [Clutter.KEY_8, 8], [Clutter.KEY_9, 9],
]);

export default class QuickLaunchManager {
    constructor(settings, getTargetDock) {
        this.settings = settings;
        this.getTargetDock = getTargetDock;
        this.timers = new TimeoutTracker();
        this._stageCaptureId = null;
        this._bindIdleId = 0;
        this._dispatchIdleId = 0;
        this._activateTimeoutId = 0;
        this._lastQlTs = 0;
        this._lastQlDigit = 0;
        this._activeBindings = new Set();

        for (const name of QUICK_LAUNCH_KEY_NAMES) {
            this.settings.connectObject(`changed::${name}`, () => {
                this._rebindWmShortcuts();
            }, this);
        }

        this._stageCaptureId = global.stage.connect('captured-event', (_stage, event) => {
            return this._onStageCapturedEvent(event);
        });

        this._bindIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._bindIdleId = 0;
            this._rebindWmShortcuts();
            return GLib.SOURCE_REMOVE;
        });
    }

    _dispatchDigit(digit) {
        const now = Date.now();
        if (this._lastQlDigit === digit && now - this._lastQlTs < 70)
            return;
        this._lastQlTs = now;
        this._lastQlDigit = digit;

        if (this._dispatchIdleId) {
            this.timers.remove(this._dispatchIdleId);
        }
        
        this._dispatchIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT, () => {
            this._dispatchIdleId = 0;
            this._activateDigitSlot(digit);
            return GLib.SOURCE_REMOVE;
        });
    }

    _onStageCapturedEvent(event) {
        if (!event || event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
        if (this._isLikelyTextInputFocused()) return Clutter.EVENT_PROPAGATE;

        const repeatFlag = Clutter.EventFlags.DEVICE_REPEATING;
        if (repeatFlag && (event.get_flags() & repeatFlag) !== 0) {
            return Clutter.EVENT_PROPAGATE;
        }

        const state = event.get_state ? event.get_state() : 0;
        if (!this._isSuperDigitModifier(state)) return Clutter.EVENT_PROPAGATE;

        const digit = DIGIT_SYMBOLS.get(event.get_key_symbol ? event.get_key_symbol() : 0);
        if (!digit) return Clutter.EVENT_PROPAGATE;

        this._dispatchDigit(digit);
        return Clutter.EVENT_STOP;
    }

    _migrateLegacyAccelsToSuper() {
        for (let i = 0; i < 9; i++) {
            const n = i + 1;
            const name = QUICK_LAUNCH_KEY_NAMES[i];
            const wantMain = `<Super>${n}`;

            const cur = this.settings.get_strv(name);

            if (!cur || cur.length === 0) {
                this.settings.set_strv(name, [wantMain]);
                continue;
            }

            const legacy = [`<Primary>${n}`, `<Alt>${n}`, `<Control>${n}`];
            const hasLegacy = cur.some(c => legacy.includes(c));

            if (hasLegacy) {
                this.settings.set_strv(name, [wantMain]);
            } else if (cur.some(c => c.includes('KP_'))) {
                const cleaned = cur.filter(c => !c.includes('KP_'));
                if (cleaned.length === 0) cleaned.push(wantMain);
                this.settings.set_strv(name, cleaned);
            }
        }
    }

    _rebindWmShortcuts() {
        this._migrateLegacyAccelsToSuper();

        for (const name of this._activeBindings) {
            Main.wm.removeKeybinding(name);
        }
        this._activeBindings.clear();

        let flags = 0;
        const K = Meta.KeyBindingFlags;
        if (K.IGNORE_AUTOREPEAT) flags |= K.IGNORE_AUTOREPEAT;
        if (K.NON_MASKABLE) flags |= K.NON_MASKABLE;
        if (K.PER_WINDOW) flags |= K.PER_WINDOW;

        let modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        if (Shell.ActionMode.POPUP) modes |= Shell.ActionMode.POPUP;

        for (let i = 0; i < 9; i++) {
            const name = QUICK_LAUNCH_KEY_NAMES[i];
            const digit = i + 1;

            const a = this.settings.get_strv(name);
            const accelOk = a && a.length > 0 && !!a[0];

            if (!accelOk) continue;

            const handler = () => {
                this._dispatchDigit(digit);
            };

            Main.wm.addKeybinding(name, this.settings, flags, modes, handler);
            this._activeBindings.add(name);
        }
    }

    _activateDigitSlot(digit) {
        const dock = this.getTargetDock ? this.getTargetDock() : null;
        
        if (!dock || !dock.boxActor) return;

        let target = this._resolveTargetByDigit(dock, digit);
        if (!target && dock._renderDock) {
            dock._renderDock(true);
            target = this._resolveTargetByDigit(dock, digit);
        }
        if (!target || !target._activateCallback) return;

        if (dock.autoHideManager && dock.autoHideManager.isHidden) {
            dock.autoHideManager.show();
            
            if (this._activateTimeoutId) this.timers.remove(this._activateTimeoutId);
            
            this._activateTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 50, () => {
                this._activateTimeoutId = 0;
                
                if (!dock || !dock.actor) return GLib.SOURCE_REMOVE;
                if (dock.actor) dock.actor._lastIconClickTime = Date.now();
                target._activateCallback(1, 0);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        if (dock.actor) dock.actor._lastIconClickTime = Date.now();
        target._activateCallback(1, 0);
    }

    _isSuperDigitModifier(state) {
        const hasCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const hasAlt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const hasSuper =
            (state & Clutter.ModifierType.SUPER_MASK) !== 0 ||
            (state & Clutter.ModifierType.MOD4_MASK) !== 0;
        const hasShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        return hasSuper && !hasCtrl && !hasAlt && !hasShift;
    }

    _isLikelyTextInputFocused() {
        const focusActor = global.stage.get_key_focus ? global.stage.get_key_focus() : null;
        if (!focusActor) return false;

        if (focusActor instanceof St.Entry) return true;

        let parent = focusActor;
        for (let i = 0; i < 5 && parent; i++) {
            if (parent instanceof St.Entry) return true;
            if (!parent.get_parent) break;
            parent = parent.get_parent();
        }
        return false;
    }

    _resolveTargetByDigit(dock, digit) {
        const children = dock.boxActor && dock.boxActor.get_children ? dock.boxActor.get_children() : [];
        const targets = [];

        children.forEach(child => {
            if (!child || child._isExternal || child.visible === false || !child._activateCallback) return;
            const sClass = child.get_style_class_name ? child.get_style_class_name() : (child.style_class || '');
            if (!sClass.includes('dock-app-button')) return;
            targets.push(child);
        });

        const index = digit - 1;
        if (index < 0 || index >= targets.length) return null;
        return targets[index];
    }

    destroy() {
        this.timers.destroy();

        if (this.settings) this.settings.disconnectObject(this);

        if (this._stageCaptureId) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = null;
        }

        for (const name of this._activeBindings) {
            Main.wm.removeKeybinding(name);
        }
        this._activeBindings.clear();

        this.settings = null;
        this.getTargetDock = null;
    }
}