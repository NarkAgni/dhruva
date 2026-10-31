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

const DIGIT_KEYS = [
    Clutter.KEY_1, Clutter.KEY_2, Clutter.KEY_3,
    Clutter.KEY_4, Clutter.KEY_5, Clutter.KEY_6,
    Clutter.KEY_7, Clutter.KEY_8, Clutter.KEY_9,
];

const DUPLICATE_KEY_WINDOW_MS = 70;
const REVEAL_BEFORE_LAUNCH_MS = 50;
const TEXT_INPUT_SEARCH_DEPTH = 5;

export default class QuickLaunchManager {
    constructor(settings, getTargetDock) {
        this.settings = settings;
        this.getTargetDock = getTargetDock;
        this.timers = new TimeoutTracker();
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

        global.stage.connectObject('captured-event', (_stage, event) => {
            return this._onStageCapturedEvent(event);
        }, this);

        this._bindIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._bindIdleId = 0;
            this._rebindWmShortcuts();
            return GLib.SOURCE_REMOVE;
        });
    }

    _dispatchDigit(digit) {
        const now = Date.now();
        if (this._lastQlDigit === digit && now - this._lastQlTs < DUPLICATE_KEY_WINDOW_MS) return;
        this._lastQlTs = now;
        this._lastQlDigit = digit;

        this.timers.remove(this._dispatchIdleId);
        this._dispatchIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT, () => {
            this._dispatchIdleId = 0;
            this._activateDigitSlot(digit);
            return GLib.SOURCE_REMOVE;
        });
    }

    _onStageCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
        if (this._isLikelyTextInputFocused()) return Clutter.EVENT_PROPAGATE;

        const repeatFlag = Clutter.EventFlags.DEVICE_REPEATING;
        if (repeatFlag && (event.get_flags() & repeatFlag) !== 0) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (!this._isSuperDigitModifier(event.get_state())) return Clutter.EVENT_PROPAGATE;

        const digitIdx = DIGIT_KEYS.indexOf(event.get_key_symbol());
        if (digitIdx === -1) return Clutter.EVENT_PROPAGATE;

        this._dispatchDigit(digitIdx + 1);
        return Clutter.EVENT_STOP;
    }

    _migrateLegacyAccelsToSuper() {
        for (let i = 0; i < 9; i++) {
            const n = i + 1;
            const name = QUICK_LAUNCH_KEY_NAMES[i];
            const wantMain = `<Super>${n}`;

            const cur = this.settings.get_strv(name);

            if (cur.length === 0) {
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

            const [accel] = this.settings.get_strv(name);
            if (!accel) continue;

            Main.wm.addKeybinding(name, this.settings, flags, modes, () => this._dispatchDigit(digit));
            this._activeBindings.add(name);
        }
    }

    _activateDigitSlot(digit) {
        const dock = this.getTargetDock();
        if (!dock || !dock.boxActor) return;

        let target = this._resolveTargetByDigit(dock, digit);
        if (!target) {
            dock.render('incremental', true);
            target = this._resolveTargetByDigit(dock, digit);
        }
        if (!target) return;

        if (!dock.autoHideManager.isHidden) {
            this._launchTarget(dock, target);
            return;
        }

        dock.autoHideManager.show();
        this.timers.remove(this._activateTimeoutId);
        this._activateTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, REVEAL_BEFORE_LAUNCH_MS, () => {
            this._activateTimeoutId = 0;
            if (dock.actor) this._launchTarget(dock, target);
            return GLib.SOURCE_REMOVE;
        });
    }

    _launchTarget(dock, target) {
        dock.actor._lastIconClickTime = Date.now();
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
        let actor = global.stage.get_key_focus();
        for (let depth = 0; depth < TEXT_INPUT_SEARCH_DEPTH && actor; depth++) {
            if ('hint_text' in actor) return true;
            actor = actor.get_parent();
        }
        return false;
    }

    _resolveTargetByDigit(dock, digit) {
        const targets = dock.boxActor.get_children().filter(child =>
            !child._isExternal &&
            child.visible &&
            child._activateCallback &&
            (child.get_style_class_name() || '').includes('dock-app-button')
        );
        return targets[digit - 1] || null;
    }

    destroy() {
        this.timers.destroy();

        this.settings.disconnectObject(this);

        global.stage.disconnectObject(this);

        for (const name of this._activeBindings) {
            Main.wm.removeKeybinding(name);
        }
        this._activeBindings.clear();

        this.settings = null;
        this.getTargetDock = null;
    }
}