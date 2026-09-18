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
    constructor(dockUI, onEdgeTrigger, onEdgeLeave) {
        this.dockUI = dockUI;
        this.onEdgeTrigger = onEdgeTrigger;
        this.onEdgeLeave = onEdgeLeave;
        this.timers = new TimeoutTracker();
        this._dwellTimeoutId = 0;
        this.triggerActor = null;

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
                const dwellDelay = Settings.edgeDwellDelay;
                
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
        const isFullWidth = Settings.fullWidth;

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
    }

    _setupBarriers() {
        const hasBarrierCapability = Boolean(
            global.backend &&
            Meta.BackendCapabilities &&
            (global.backend.capabilities & Meta.BackendCapabilities.BARRIERS) !== 0
        );

        if (!hasBarrierCapability) return;

        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorResult || !monitorResult.monitor) return;
        const monitor = monitorResult.monitor;
        const pos = this.dockUI.dockPosition;

        let props;
        if (pos === 'BOTTOM') {
            props = {
                x1: monitor.x,
                x2: monitor.x + monitor.width,
                y1: monitor.y + monitor.height,
                y2: monitor.y + monitor.height,
                directions: Meta.BarrierDirection.NEGATIVE_Y,
            };
        } else if (pos === 'TOP') {
            props = {
                x1: monitor.x,
                x2: monitor.x + monitor.width,
                y1: monitor.y,
                y2: monitor.y,
                directions: Meta.BarrierDirection.POSITIVE_Y,
            };
        } else if (pos === 'LEFT') {
            props = {
                x1: monitor.x,
                x2: monitor.x,
                y1: monitor.y,
                y2: monitor.y + monitor.height,
                directions: Meta.BarrierDirection.POSITIVE_X,
            };
        } else if (pos === 'RIGHT') {
            props = {
                x1: monitor.x + monitor.width,
                x2: monitor.x + monitor.width,
                y1: monitor.y,
                y2: monitor.y + monitor.height,
                directions: Meta.BarrierDirection.NEGATIVE_X,
            };
        }

        try {
            this._barrier = new Meta.Barrier({
                backend: global.backend,
                ...props,
            });

            const dwellDelay = Settings.edgeDwellDelay || DEFAULT_BARRIER_DWELL_MS;

            this._pressure = new Layout.PressureBarrier(
                dwellDelay,
                PRESSURE_BARRIER_TIMEOUT_MS,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW
            );

            this._pressure.addBarrier(this._barrier);
            this._pressure.connectObject('trigger', () => {
                if (this.onEdgeTrigger) this.onEdgeTrigger();
            }, this);
        } catch (e) {
            console.warn('[Dhruva] Could not initialize pressure barrier, using chrome trigger fallback:', e);
            if (this._barrier) {
                this._barrier.destroy();
                this._barrier = null;
            }
            if (this._pressure) {
                this._pressure.destroy();
                this._pressure = null;
            }
        }
    }

    show() {
        if (isActorAlive(this.triggerActor)) this.triggerActor.show();
    }

    hide() {
        if (isActorAlive(this.triggerActor)) this.triggerActor.hide();
    }

    destroy() {
        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            this.dockUI.actor.disconnectObject(this);
        }
        if (this._pressure) {
            this._pressure.disconnectObject(this);
            this._pressure.destroy();
            this._pressure = null;
        }
        if (this._barrier) {
            this._barrier.destroy();
            this._barrier = null;
        }

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
    }
}