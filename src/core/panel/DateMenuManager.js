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


import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import ClockBox from './ClockBox.js';
import { isActorAlive } from '../Utils.js';
import { TimeoutTracker } from '../TimeoutTracker.js';
import { hookPopupGap, unhookPopupGap } from './PopupGap.js';
import { NativeActorState, stylePanelItem } from './NativeActorState.js';


const RELAYOUT_DELAY_MS = 60;

export default class DateMenuManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.actor = null;
        this.indicator = null;
        this._state = null;
        this._clock = null;
        this._isVertical = false;
        this._relayoutId = 0;
        this._timeouts = new TimeoutTracker();

        this._clockSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        this._clockSettings.connectObject(
            'changed::clock-show-seconds', () => this._onClockFormatChanged(),
            'changed::clock-show-date', () => this._onClockFormatChanged(),
            'changed::clock-format', () => this._onClockFormatChanged(),
            this
        );
        this.dockUI.settings.connectObject('changed::panel-date-format', () => this._onClockFormatChanged(), this);
    }

    steal(targetSide, isVertical) {
        this.indicator = Main.panel.statusArea.dateMenu;
        if (!this.indicator) return null;

        const target = this.indicator.container;
        this._isVertical = isVertical;
        this._state = new NativeActorState();
        this._state.rememberPlace(target);
        target.get_parent().remove_child(target);

        this._installClock();
        stylePanelItem(this._state, target, false, isVertical);

        this._state.set(target, {
            reactive: true,
            can_focus: false,
            track_hover: true,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let lastSize = -1;
        this._state.connect(target, 'notify::allocation', () => {
            const size = Math.round(this._isVertical ? target.height : target.width);
            if (size > 0 && Math.abs(size - lastSize) >= 2) {
                lastSize = size;
                this.dockUI.syncPanelSpace();
            }
        });

        this.updateArrowSide(targetSide);
        hookPopupGap(this.dockUI, this.indicator.menu, true);

        this.actor = target;
        this._queueRelayout();
        return target;
    }

    _installClock() {
        const indicator = this.indicator;

        this._clock = new ClockBox(this._clockSettings, this.dockUI.settings, this._isVertical);
        this._clock.actor.name = 'DhruvaWindowsDateMenuBox';
        this._state.connect(indicator._clock, 'notify::clock', () => this._updateClock());
        this._updateClock();

        const dot = indicator._indicator;
        this._state.set(dot, { visible: false });
        this._state.connect(dot, 'notify::visible', () => {
            if (dot.visible) dot.visible = false;
        });

        const clockDisplay = indicator._clockDisplay;
        const clockParent = clockDisplay.get_parent();
        this._state.set(clockDisplay, { visible: false });
        this._state.set(clockParent, { y_align: Clutter.ActorAlign.CENTER, y_expand: false });
        clockParent.insert_child_above(this._clock.actor, clockDisplay);
    }

    _updateClock() {
        if (this._clock.update()) this._queueRelayout();
    }

    _onClockFormatChanged() {
        if (!this.actor) return;
        this._clock.update();
        this._queueRelayout();
    }

    _queueRelayout() {
        if (this._relayoutId) {
            this._timeouts.remove(this._relayoutId);
            this._relayoutId = 0;
        }
        this._relayoutId = this._timeouts.addTimeout(GLib.PRIORITY_DEFAULT, RELAYOUT_DELAY_MS, () => {
            this._relayoutId = 0;
            if (isActorAlive(this.actor)) {
                this._clock.actor.queue_relayout();
                this.actor.queue_relayout();
                this.dockUI.syncPanelSpace();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    updateArrowSide(targetSide) {
        this._state.setArrowSide(this.indicator.menu._boxPointer, targetSide);
    }

    restore() {
        if (this._relayoutId) {
            this._timeouts.remove(this._relayoutId);
            this._relayoutId = 0;
        }
        if (this.indicator) {
            unhookPopupGap(this.indicator.menu);
            if (this._clock) {
                this._clock.destroy();
                this._clock = null;
            }

            if (this._state) {
                this._state.restore();
                this._state = null;
            }

            const dot = this.indicator._indicator;
            if (dot && dot._sync) dot._sync();

            this.actor = null;
            this.indicator = null;
        }
    }

    destroy() {
        this.restore();
        if (this._timeouts) {
            this._timeouts.destroy();
            this._timeouts = null;
        }
        this._clockSettings.disconnectObject(this);
        this._clockSettings = null;
        this.dockUI.settings.disconnectObject(this);
    }
}