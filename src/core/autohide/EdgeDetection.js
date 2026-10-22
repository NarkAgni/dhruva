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
import { Settings } from '../SettingsManager.js';
import { TimeoutTracker } from '../TimeoutTracker.js';


const TRIGGER_DEPTH_PX = 4;
const DEFAULT_BARRIER_DWELL_MS = 150;
const PRESSURE_BARRIER_TIMEOUT_MS = 1000;

export class EdgeDetection {
    constructor(dockUI, onEdgeTrigger, onEdgeLeave, getDwellDelay) {
        this.dockUI = dockUI;
        this.onEdgeTrigger = onEdgeTrigger;
        this.onEdgeLeave = onEdgeLeave;
        this.getDwellDelay = getDwellDelay;
        this.timers = new TimeoutTracker();
        this._dwellTimeoutId = 0;
        this.triggerActor = null;

        this._isPassThrough = false;
        this._isActive = true;
        this._lastBarrierKey = '';

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

        this.triggerActor.connectObject(
            'enter-event', () => {
                const dwellDelay = this.getDwellDelay();

                if (this._dwellTimeoutId) {
                    this.timers.remove(this._dwellTimeoutId);
                    this._dwellTimeoutId = 0;
                }

                if (dwellDelay <= 0) {
                    if (this.onEdgeTrigger) this.onEdgeTrigger();
                } else {
                    this._dwellTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, dwellDelay, () => {
                        this._dwellTimeoutId = 0;
                        if (this.onEdgeTrigger) this.onEdgeTrigger();
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return Clutter.EVENT_PROPAGATE;
            },
            'leave-event', () => {
                if (this._dwellTimeoutId) {
                    this.timers.remove(this._dwellTimeoutId);
                    this._dwellTimeoutId = 0;
                }
                if (this.onEdgeLeave) this.onEdgeLeave();
                return Clutter.EVENT_PROPAGATE;
            },
            this
        );
    }

    updateGeometry() {
        if (!this.dockUI || !isActorAlive(this.dockUI.actor) || !isActorAlive(this.triggerActor)) return;

        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorResult || !monitorResult.monitor) return;

        const monitor = monitorResult.monitor;
        const pos = this.dockUI.dockPosition;
        const isDynamicPanel = Settings.hybridPanelMode && Settings.dynamicPanel;
        const isFullWidth = Settings.fullWidth || (Settings.hybridPanelMode && !isDynamicPanel);

        let x = 0;
        let y = 0;
        let w = 0;
        let h = 0;

        if (isFullWidth) {
            if (pos === 'BOTTOM') {
                x = monitor.x;
                y = monitor.y + monitor.height - TRIGGER_DEPTH_PX;
                w = monitor.width;
                h = TRIGGER_DEPTH_PX;
            } else if (pos === 'TOP') {
                x = monitor.x;
                y = monitor.y;
                w = monitor.width;
                h = TRIGGER_DEPTH_PX;
            } else if (pos === 'LEFT') {
                x = monitor.x;
                y = monitor.y;
                w = TRIGGER_DEPTH_PX;
                h = monitor.height;
            } else if (pos === 'RIGHT') {
                x = monitor.x + monitor.width - TRIGGER_DEPTH_PX;
                y = monitor.y;
                w = TRIGGER_DEPTH_PX;
                h = monitor.height;
            }
        } else {
            const dockX = this.dockUI.actor.x;
            const dockY = this.dockUI.actor.y;
            const dockW = this.dockUI.actor.width;
            const dockH = this.dockUI.actor.height;

            if (pos === 'BOTTOM') {
                x = dockX;
                y = monitor.y + monitor.height - TRIGGER_DEPTH_PX;
                w = dockW;
                h = TRIGGER_DEPTH_PX;
            } else if (pos === 'TOP') {
                x = dockX;
                y = monitor.y;
                w = dockW;
                h = TRIGGER_DEPTH_PX;
            } else if (pos === 'LEFT') {
                x = monitor.x;
                y = dockY;
                w = TRIGGER_DEPTH_PX;
                h = dockH;
            } else if (pos === 'RIGHT') {
                x = monitor.x + monitor.width - TRIGGER_DEPTH_PX;
                y = dockY;
                w = TRIGGER_DEPTH_PX;
                h = dockH;
            }
        }

        this.triggerActor.set_position(x, y);
        this.triggerActor.set_size(w, h);

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
        if (this._isPassThrough || !this._isActive) return;

        const hasBarrierCapability = Boolean(
            global.backend &&
            Meta.BackendCapabilities &&
            (global.backend.capabilities & Meta.BackendCapabilities.BARRIERS) !== 0
        );

        if (!hasBarrierCapability) return;
        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;

        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorResult || !monitorResult.monitor) return;
        const monitor = monitorResult.monitor;
        const pos = this.dockUI.dockPosition;

        if (this.dockUI._isOnSharedMonitorEdge && this.dockUI._isOnSharedMonitorEdge()) {
            this._teardownBarriers();
            return;
        }

        const isDynamicPanel = Settings.hybridPanelMode && Settings.dynamicPanel;
        const isFullBar = Settings.fullWidth || (Settings.hybridPanelMode && !isDynamicPanel);

        const dockScaleX = this.dockUI.actor.scale_x || 1.0;
        const dockScaleY = this.dockUI.actor.scale_y || 1.0;
        const rawW = (this.dockUI.actor.width || 0) * dockScaleX;
        const rawH = (this.dockUI.actor.height || 0) * dockScaleY;

        const dockW = rawW > 20 ? Math.round(rawW) : monitor.width;
        const dockH = rawH > 20 ? Math.round(rawH) : monitor.height;
        const dockX = rawW > 20 ? Math.round(this.dockUI.actor.x) : monitor.x;
        const dockY = rawH > 20 ? Math.round(this.dockUI.actor.y) : monitor.y;

        const xStart = isFullBar ? monitor.x : Math.max(monitor.x, dockX);
        const xEnd = isFullBar ? (monitor.x + monitor.width) : Math.min(monitor.x + monitor.width, dockX + dockW);
        const yStart = isFullBar ? monitor.y : Math.max(monitor.y, dockY);
        const yEnd = isFullBar ? (monitor.y + monitor.height) : Math.min(monitor.y + monitor.height, dockY + dockH);

        if (xEnd <= xStart || yEnd <= yStart) return;

        let props;
        if (pos === 'BOTTOM') {
            props = {
                x1: xStart,
                x2: xEnd,
                y1: monitor.y + monitor.height,
                y2: monitor.y + monitor.height,
                directions: Meta.BarrierDirection.NEGATIVE_Y,
            };
        } else if (pos === 'TOP') {
            props = {
                x1: xStart,
                x2: xEnd,
                y1: monitor.y,
                y2: monitor.y,
                directions: Meta.BarrierDirection.POSITIVE_Y,
            };
        } else if (pos === 'LEFT') {
            props = {
                x1: monitor.x,
                x2: monitor.x,
                y1: yStart,
                y2: yEnd,
                directions: Meta.BarrierDirection.POSITIVE_X,
            };
        } else if (pos === 'RIGHT') {
            props = {
                x1: monitor.x + monitor.width,
                x2: monitor.x + monitor.width,
                y1: yStart,
                y2: yEnd,
                directions: Meta.BarrierDirection.NEGATIVE_X,
            };
        }

        const dwellDelay = this.getDwellDelay() || DEFAULT_BARRIER_DWELL_MS;
        const barrierKey = `${pos}:${props.x1},${props.y1}-${props.x2},${props.y2}:${dwellDelay}`;
        if (this._barrier && this._lastBarrierKey === barrierKey) {
            return;
        }

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
        this._pressure.connectObject('trigger', () => {
            if (this.onEdgeTrigger) this.onEdgeTrigger();
        }, this);
    }

    setPassThrough(passThrough) {
        this._isPassThrough = Boolean(passThrough);

        if (this._isPassThrough) {
            if (this._dwellTimeoutId) {
                this.timers.remove(this._dwellTimeoutId);
                this._dwellTimeoutId = 0;
            }
            this._teardownBarriers();
            if (isActorAlive(this.triggerActor)) {
                this.triggerActor.reactive = false;
                this.triggerActor.hide();
            }
        } else {
            this._setupBarriers();
            const mode = Settings.hideMode || 'none';
            if (mode !== 'none' && isActorAlive(this.triggerActor)) {
                this.triggerActor.reactive = true;
                this.triggerActor.show();
            }
        }
    }

    show() {
        this._isActive = true;
        if (this._isPassThrough) return;
        this._setupBarriers();
        if (isActorAlive(this.triggerActor)) {
            this.triggerActor.reactive = true;
            this.triggerActor.show();
        }
    }

    hide() {
        this._isActive = false;
        if (this._dwellTimeoutId) {
            this.timers.remove(this._dwellTimeoutId);
            this._dwellTimeoutId = 0;
        }
        this._teardownBarriers();
        if (isActorAlive(this.triggerActor)) this.triggerActor.hide();
    }

    destroy() {
        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            this.dockUI.actor.disconnectObject(this);
        }
        this._teardownBarriers();

        if (this._dwellTimeoutId) {
            this.timers.remove(this._dwellTimeoutId);
            this._dwellTimeoutId = 0;
        }
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