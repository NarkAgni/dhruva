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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutTracker } from '../TimeoutTracker.js';


export class EdgeDetection {
    constructor(dockUI, onEdgeTrigger, onEdgeLeave) {
        this.dockUI = dockUI;
        this.onEdgeTrigger = onEdgeTrigger;
        this.onEdgeLeave = onEdgeLeave;
        this.timers = new TimeoutTracker();
        this._dwellTimeoutId = 0;
        this.triggerActor = null;

        this._createTrigger();
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
                const dwellDelay = this.dockUI.settings.get_int('edge-dwell-delay');
                
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
        if (!this.dockUI || !this.dockUI.actor || !this.triggerActor) return;

        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorResult || !monitorResult.monitor) return;

        const monitor = monitorResult.monitor;
        const pos = this.dockUI.dockPosition;
        const isFullWidth = this.dockUI.settings.get_boolean('full-width');
        const triggerDepth = 4;

        let x = 0;
        let y = 0;
        let w = 0;
        let h = 0;

        if (isFullWidth) {
            if (pos === 'BOTTOM') {
                x = monitor.x;
                y = monitor.y + monitor.height - triggerDepth;
                w = monitor.width;
                h = triggerDepth;
            } else if (pos === 'TOP') {
                x = monitor.x;
                y = monitor.y;
                w = monitor.width;
                h = triggerDepth;
            } else if (pos === 'LEFT') {
                x = monitor.x;
                y = monitor.y;
                w = triggerDepth;
                h = monitor.height;
            } else if (pos === 'RIGHT') {
                x = monitor.x + monitor.width - triggerDepth;
                y = monitor.y;
                w = triggerDepth;
                h = monitor.height;
            }
        } else {
            const dockX = this.dockUI.actor.x;
            const dockY = this.dockUI.actor.y;
            const dockW = this.dockUI.actor.width;
            const dockH = this.dockUI.actor.height;

            if (pos === 'BOTTOM') {
                x = dockX;
                y = monitor.y + monitor.height - triggerDepth;
                w = dockW;
                h = triggerDepth;
            } else if (pos === 'TOP') {
                x = dockX;
                y = monitor.y;
                w = dockW;
                h = triggerDepth;
            } else if (pos === 'LEFT') {
                x = monitor.x;
                y = dockY;
                w = triggerDepth;
                h = dockH;
            } else if (pos === 'RIGHT') {
                x = monitor.x + monitor.width - triggerDepth;
                y = dockY;
                w = triggerDepth;
                h = dockH;
            }
        }

        this.triggerActor.set_position(x, y);
        this.triggerActor.set_size(w, h);
    }

    show() {
        if (this.triggerActor) this.triggerActor.show();
    }

    hide() {
        if (this.triggerActor) this.triggerActor.hide();
    }

    destroy() {
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