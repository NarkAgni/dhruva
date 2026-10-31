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
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import { isActorAlive } from '../Utils.js';
import { hasPointerBarriers } from '../Compat.js';
import { isFullBarLayout } from '../LayoutMode.js';
import { Settings } from '../SettingsManager.js';
import { TimeoutTracker } from '../TimeoutTracker.js';


const TRIGGER_DEPTH_PX = 4;
const DEFAULT_BARRIER_DWELL_MS = 150;
const PRESSURE_BARRIER_TIMEOUT_MS = 1000;
const MIN_MEASURED_SIZE_PX = 20;

function isHorizontalEdge(pos) {
    return pos === 'BOTTOM' || pos === 'TOP';
}

function clampSpan(monitorStart, monitorLength, start, size) {
    const monitorEnd = monitorStart + monitorLength;
    if (size <= MIN_MEASURED_SIZE_PX) return [monitorStart, monitorEnd];

    const roundedStart = Math.round(start);
    return [Math.max(monitorStart, roundedStart), Math.min(monitorEnd, roundedStart + Math.round(size))];
}

export class EdgeDetection {
    constructor(dockUI, onEdgeTrigger, onEdgeLeave, getDwellDelay) {
        this.dockUI = dockUI;
        this.onEdgeTrigger = onEdgeTrigger;
        this.onEdgeLeave = onEdgeLeave;
        this.getDwellDelay = getDwellDelay;
        this.timers = new TimeoutTracker();
        this._dwellTimeoutId = 0;
        this.triggerActor = null;
        this._barrier = null;
        this._pressure = null;

        this._isPassThrough = false;
        this._isActive = true;
        this._lastBarrierKey = '';
        this._hasBarrierSupport = hasPointerBarriers();

        this._createTrigger();
        this._setupBarriers();

        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            this.dockUI.actor.connectObject(
                'notify::allocation', () => this.updateGeometry(),
                'notify::x', () => this.updateGeometry(),
                'notify::y', () => this.updateGeometry(),
                this
            );
        }
    }

    _createTrigger() {
        this.triggerActor = new Clutter.Actor({
            name: 'DhruvaEdgeTrigger',
            reactive: true,
            opacity: 0,
        });

        Main.layoutManager.addChrome(this.triggerActor, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        const dockParent = this.dockUI.actor.get_parent();
        if (dockParent === this.triggerActor.get_parent())
            dockParent.set_child_below_sibling(this.triggerActor, this.dockUI.actor);

        this.triggerActor.connectObject(
            'enter-event', () => {
                this._startDwell();
                return Clutter.EVENT_PROPAGATE;
            },
            'leave-event', () => {
                this._cancelDwell();
                this.onEdgeLeave();
                return Clutter.EVENT_PROPAGATE;
            },
            this
        );
    }

    _startDwell() {
        this._cancelDwell();

        const dwellDelay = this.getDwellDelay();
        if (dwellDelay <= 0) {
            this.onEdgeTrigger();
            return;
        }

        this._dwellTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, dwellDelay, () => {
            this._dwellTimeoutId = 0;
            this.onEdgeTrigger();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelDwell() {
        this.timers.remove(this._dwellTimeoutId);
        this._dwellTimeoutId = 0;
    }

    _getMonitor() {
        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        return monitorResult ? monitorResult.monitor : null;
    }

    _getTriggerRect(monitor) {
        const pos = this.dockUI.dockPosition;
        const source = isFullBarLayout() ? monitor : this.dockUI.actor;
        const [start, length] = isHorizontalEdge(pos)
            ? [source.x, source.width]
            : [source.y, source.height];

        switch (pos) {
        case 'BOTTOM':
            return { x: start, y: monitor.y + monitor.height - TRIGGER_DEPTH_PX, width: length, height: TRIGGER_DEPTH_PX };
        case 'TOP':
            return { x: start, y: monitor.y, width: length, height: TRIGGER_DEPTH_PX };
        case 'LEFT':
            return { x: monitor.x, y: start, width: TRIGGER_DEPTH_PX, height: length };
        case 'RIGHT':
            return { x: monitor.x + monitor.width - TRIGGER_DEPTH_PX, y: start, width: TRIGGER_DEPTH_PX, height: length };
        default:
            return { x: 0, y: 0, width: 0, height: 0 };
        }
    }

    _getBarrierProps(monitor) {
        const actor = this.dockUI.actor;
        const isFullBar = isFullBarLayout();

        const [xStart, xEnd] = isFullBar
            ? [monitor.x, monitor.x + monitor.width]
            : clampSpan(monitor.x, monitor.width, actor.x, actor.width * (actor.scale_x || 1.0));
        const [yStart, yEnd] = isFullBar
            ? [monitor.y, monitor.y + monitor.height]
            : clampSpan(monitor.y, monitor.height, actor.y, actor.height * (actor.scale_y || 1.0));

        if (xEnd <= xStart || yEnd <= yStart) return null;

        const right = monitor.x + monitor.width;
        const bottom = monitor.y + monitor.height;

        switch (this.dockUI.dockPosition) {
        case 'BOTTOM':
            return { x1: xStart, x2: xEnd, y1: bottom, y2: bottom, directions: Meta.BarrierDirection.NEGATIVE_Y };
        case 'TOP':
            return { x1: xStart, x2: xEnd, y1: monitor.y, y2: monitor.y, directions: Meta.BarrierDirection.POSITIVE_Y };
        case 'LEFT':
            return { x1: monitor.x, x2: monitor.x, y1: yStart, y2: yEnd, directions: Meta.BarrierDirection.POSITIVE_X };
        case 'RIGHT':
            return { x1: right, x2: right, y1: yStart, y2: yEnd, directions: Meta.BarrierDirection.NEGATIVE_X };
        default:
            return null;
        }
    }

    updateGeometry() {
        if (!this.dockUI || !isActorAlive(this.dockUI.actor) || !isActorAlive(this.triggerActor)) return;

        const monitor = this._getMonitor();
        if (!monitor) return;

        const rect = this._getTriggerRect(monitor);
        this.triggerActor.set_position(rect.x, rect.y);
        this.triggerActor.set_size(rect.width, rect.height);

        this._setupBarriers();
    }

    _teardownBarriers() {
        this._lastBarrierKey = '';
        if (this._pressure) {
            this._pressure.disconnectObject(this);
            this._pressure.destroy();
            this._pressure = null;
        }
        if (this._barrier) {
            this._barrier.destroy();
            this._barrier = null;
        }
    }

    _setupBarriers() {
        if (this._isPassThrough || !this._isActive || !this._hasBarrierSupport) return;
        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;

        const monitor = this._getMonitor();
        if (!monitor) return;

        if (this.dockUI.isOnSharedMonitorEdge()) {
            this._teardownBarriers();
            return;
        }

        const props = this._getBarrierProps(monitor);
        if (!props) return;

        const dwellDelay = this.getDwellDelay() || DEFAULT_BARRIER_DWELL_MS;
        const barrierKey = `${this.dockUI.dockPosition}:${props.x1},${props.y1}-${props.x2},${props.y2}:${dwellDelay}`;
        if (this._barrier && this._lastBarrierKey === barrierKey) return;

        this._teardownBarriers();
        this._lastBarrierKey = barrierKey;

        this._barrier = new Meta.Barrier({
            backend: global.backend,
            ...props,
        });

        this._pressure = new Layout.PressureBarrier(
            dwellDelay,
            PRESSURE_BARRIER_TIMEOUT_MS,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW
        );

        this._pressure.addBarrier(this._barrier);
        this._pressure.connectObject('trigger', () => this.onEdgeTrigger(), this);
    }

    _setTriggerEnabled(enabled) {
        if (!isActorAlive(this.triggerActor)) return;
        this.triggerActor.reactive = enabled;
        if (enabled) this.triggerActor.show();
        else this.triggerActor.hide();
    }

    setPassThrough(passThrough) {
        this._isPassThrough = Boolean(passThrough);

        if (this._isPassThrough) {
            this._cancelDwell();
            this._teardownBarriers();
            this._setTriggerEnabled(false);
            return;
        }

        this._setupBarriers();
        if ((Settings.hideMode || 'none') !== 'none') this._setTriggerEnabled(true);
    }

    show() {
        this._isActive = true;
        if (this._isPassThrough) return;
        this._setupBarriers();
        this._setTriggerEnabled(true);
    }

    hide() {
        this._isActive = false;
        this._cancelDwell();
        this._teardownBarriers();
        this._setTriggerEnabled(false);
    }

    destroy() {
        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            this.dockUI.actor.disconnectObject(this);
        }
        this._teardownBarriers();
        this._cancelDwell();
        this.timers.destroy();

        if (this.triggerActor) {
            this.triggerActor.disconnectObject(this);
            Main.layoutManager.removeChrome(this.triggerActor);
            this.triggerActor.destroy();
            this.triggerActor = null;
        }
        this.dockUI = null;
        this.onEdgeTrigger = null;
        this.onEdgeLeave = null;
        this.getDwellDelay = null;
    }
}