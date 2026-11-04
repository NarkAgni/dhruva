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

const QUICK_LAUNCH_ENABLED_KEY = 'quick-launch-enabled';

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
        this._superDigits = new Set();

        this._bindIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._bindIdleId = 0;
            this._migrateLegacyAccels();

            for (const name of [QUICK_LAUNCH_ENABLED_KEY, ...QUICK_LAUNCH_KEY_NAMES]) {
                this.settings.connectObject(`changed::${name}`, () => this._sync(), this);
            }
            this._sync();
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

        const digit = DIGIT_KEYS.indexOf(event.get_key_symbol()) + 1;
        if (!this._superDigits.has(digit)) return Clutter.EVENT_PROPAGATE;

        this._dispatchDigit(digit);
        return Clutter.EVENT_STOP;
    }

    _migrateLegacyAccels() {
        for (let i = 0; i < 9; i++) {
            const n = i + 1;
            const name = QUICK_LAUNCH_KEY_NAMES[i];
            const cur = this.settings.get_strv(name);

            const legacy = [`<Primary>${n}`, `<Alt>${n}`, `<Control>${n}`];
            if (cur.some(c => legacy.includes(c))) {
                this.settings.set_strv(name, [`<Super>${n}`]);
            } else if (cur.some(c => c.includes('KP_'))) {
                this.settings.set_strv(name, cur.filter(c => !c.includes('KP_')));
            }
        }
    }

    _unbind() {
        global.stage.disconnectObject(this);

        for (const name of this._activeBindings) {
            Main.wm.removeKeybinding(name);
        }
        this._activeBindings.clear();
        this._superDigits.clear();
    }

    _sync() {
        this._unbind();
        if (!this.settings.get_boolean(QUICK_LAUNCH_ENABLED_KEY)) return;

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

            const accels = this.settings.get_strv(name);
            if (accels.length === 0) continue;

            Main.wm.addKeybinding(name, this.settings, flags, modes, () => this._dispatchDigit(digit));
            this._activeBindings.add(name);
            if (accels.includes(`<Super>${digit}`)) this._superDigits.add(digit);
        }

        if (this._superDigits.size === 0) return;

        global.stage.connectObject('captured-event', (_stage, event) => {
            return this._onStageCapturedEvent(event);
        }, this);
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
            !child._isGridBtn &&
            child._entityId !== 'dhruva-grid-button' &&
            child.visible &&
            child._activateCallback &&
            (child.get_style_class_name() || '').includes('dock-app-button')
        );
        return targets[digit - 1] || null;
    }

    destroy() {
        this.timers.destroy();

        this.settings.disconnectObject(this);
        this._unbind();

        this.settings = null;
        this.getTargetDock = null;
    }
}