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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../../core/Utils.js';
import { Settings } from '../../core/SettingsManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';


const GRAB_WATCH_INTERVAL_MS = 25;
const AUTOHIDE_RECHECK_MS = 20;
const CURSOR_TOLERANCE_PX = 10;
const FALLBACK_DOCK_SIZE_PX = 64;
const GRABBABLE_WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

export default class DockGrabController {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.timers = new TimeoutTracker();
        this.isGrabbed = false;
        this._window = null;
        this._isTouchingDock = false;
        this._lockedMonitor = null;
        this._watchTimerId = 0;
    }

    onGrabBegin(window) {
        if (!window || !GRABBABLE_WINDOW_TYPES.has(window.get_window_type())) return;

        const monitors = Main.layoutManager.monitors;
        const isMultiMonitor = monitors && monitors.length > 1;
        const pos = this.dockUI.dockPosition;
        if (!isMultiMonitor || (pos !== 'LEFT' && pos !== 'RIGHT')) return;

        this._lockedMonitor = this.dockUI.monitorManager.getCurrentMonitor();
        this.isGrabbed = true;
        this._window = window;
        this._isTouchingDock = false;

        this.dockUI.updateStruts();

        window.connectObject('position-changed', () => this._checkNearDock(), this);

        this._stopWatch();
        this._watchTimerId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, GRAB_WATCH_INTERVAL_MS, () => {
            if (!this.isGrabbed || !this._window) {
                this._watchTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._checkNearDock();
            return GLib.SOURCE_CONTINUE;
        });

        this._checkNearDock();
    }

    onGrabEnd() {
        this._stopWatch();
        if (!this.isGrabbed) return;

        this._releaseWindow();
        this.isGrabbed = false;
        this._lockedMonitor = null;
        const wasTouching = this._isTouchingDock;
        this._isTouchingDock = false;

        this._setDockReactive(true);
        this.dockUI.updateStruts();

        const autoHide = this.dockUI.autoHideManager;
        if (autoHide) {
            if (wasTouching) autoHide.setWindowGrabPassThrough(false);
            else autoHide.scheduleCheck(AUTOHIDE_RECHECK_MS);
        }

        if (Settings.isolateMonitors) this.dockUI.queueRender('incremental');
    }

    _stopWatch() {
        this.timers.remove(this._watchTimerId);
        this._watchTimerId = 0;
    }

    _releaseWindow() {
        if (!this._window) return;
        this._window.disconnectObject(this);
        this._window = null;
    }

    _setDockReactive(reactive) {
        const { actor, bgActor, boxActor } = this.dockUI;
        if (isActorAlive(actor)) actor.reactive = reactive;
        if (isActorAlive(bgActor)) bgActor.reactive = reactive;
        if (isActorAlive(boxActor)) boxActor.reactive = reactive;
    }

    _getTouchBounds() {
        const actor = this.dockUI.actor;
        const monResult = this._lockedMonitor || this.dockUI.monitorManager.getCurrentMonitor();
        const mon = monResult ? monResult.monitor : null;

        const dockW = (actor._cachedW || actor.width || FALLBACK_DOCK_SIZE_PX) * (actor.scale_x || 1.0);
        const dockH = (actor._cachedH || actor.height || FALLBACK_DOCK_SIZE_PX) * (actor.scale_y || 1.0);

        const bounds = {
            left: actor.x - CURSOR_TOLERANCE_PX,
            right: actor.x + dockW + CURSOR_TOLERANCE_PX,
            top: actor.y - CURSOR_TOLERANCE_PX,
            bottom: actor.y + dockH + CURSOR_TOLERANCE_PX,
        };

        if (mon && this.dockUI.dockPosition === 'RIGHT') {
            bounds.right = Math.max(bounds.right, mon.x + mon.width + CURSOR_TOLERANCE_PX);
            bounds.left = Math.min(bounds.left, (mon.x + mon.width) - dockW - CURSOR_TOLERANCE_PX);
        } else if (mon && this.dockUI.dockPosition === 'LEFT') {
            bounds.left = Math.min(bounds.left, mon.x - CURSOR_TOLERANCE_PX);
            bounds.right = Math.max(bounds.right, mon.x + dockW + CURSOR_TOLERANCE_PX);
        }

        return bounds;
    }

    _checkNearDock() {
        if (!this.isGrabbed || !this._window || !isActorAlive(this.dockUI.actor)) return;

        const bounds = this._getTouchBounds();
        const [px, py] = global.get_pointer();
        const isTouching = px >= bounds.left && px <= bounds.right && py >= bounds.top && py <= bounds.bottom;

        if (isTouching === this._isTouchingDock) return;
        this._isTouchingDock = isTouching;
        this._setDockReactive(!isTouching);

        const autoHide = this.dockUI.autoHideManager;
        if (!autoHide) return;

        if (isTouching) {
            autoHide.forceHideImmediately();
            autoHide.setWindowGrabPassThrough(true);
        } else {
            autoHide.setWindowGrabPassThrough(false);
            autoHide.scheduleCheck(AUTOHIDE_RECHECK_MS);
        }
    }

    destroy() {
        this.timers.destroy();
        this._releaseWindow();
        this.dockUI = null;
    }
}