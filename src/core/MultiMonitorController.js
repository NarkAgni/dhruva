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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import GnomeDash from './GnomeDash.js';
import AppManager from './AppManager.js';
import FolderManager from './FolderManager.js';
import DockUI from '../ui/dock/DockUI.js';
import { Settings } from './SettingsManager.js';
import { TimeoutTracker } from './TimeoutTracker.js';


export default class MultiMonitorController {
    constructor(settings, openPrefsCallback, uuid) {
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.uuid = uuid;
        this.docks = [];
        this.timers = new TimeoutTracker();
        this._reloadIdleId = null;
        this._gnomeDash = new GnomeDash();
        this.appManager = new AppManager(uuid, settings);
        this.folderManager = new FolderManager(this.appManager);

        this.settings.connectObject('changed::show-on-all-monitors', () => {
            this.reloadDocks();
        }, this);
    }

    handleMonitorsChanged() {
        const monitorCount = Main.layoutManager.monitors.length;
        if (monitorCount === 0) return;

        const expectedCount = Settings.showOnAllMonitors ? monitorCount : 1;
        const primaryChanged = this._primaryIndex !== Main.layoutManager.primaryIndex;
        if (this.docks.length !== expectedCount || primaryChanged) {
            this.reloadDocks();
            return;
        }

        for (const dock of this.docks) {
            dock.dockManager.updatePosition();
            dock.autoHideManager.updateTriggerGeometry();
        }
    }

    _createDock(monitorIndex) {
        const dock = new DockUI(this.settings, this.openPrefsCallback, this.appManager, this.folderManager, monitorIndex);
        dock.show();
        this.docks.push(dock);
    }

    _syncGnomeDash() {
        if (Settings.independentDock) this._gnomeDash.release();
        else this._gnomeDash.takeover();
    }

    reloadDocks() {
        this.destroyDocks();

        if (!this.settings) return;
        this._syncGnomeDash();

        if (this._reloadIdleId) {
            this.timers.remove(this._reloadIdleId);
            this._reloadIdleId = null;
        }

        this._reloadIdleId = this.timers.addIdle(GLib.PRIORITY_HIGH, () => {
            this._reloadIdleId = null;
            if (!this.settings) return GLib.SOURCE_REMOVE;

            this._primaryIndex = Main.layoutManager.primaryIndex;
            const focusedMonitor = this.getFocusedMonitorIndex();
            const showOnAll = Settings.showOnAllMonitors;

            if (showOnAll) {
                const numMonitors = global.display.get_n_monitors();
                let monitorOrder = Array.from({ length: numMonitors }, (_v, i) => i);

                if (focusedMonitor >= 0 && focusedMonitor < numMonitors) {
                    monitorOrder = [
                        focusedMonitor,
                        ...monitorOrder.filter(i => i !== focusedMonitor),
                    ];
                }

                monitorOrder.forEach(i => this._createDock(i));
            } else {
                this._createDock(null);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    getFocusedMonitorIndex() {
        const focused = global.display.get_focus_window();
        if (focused) {
            return focused.get_monitor();
        }
        return Main.layoutManager.primaryIndex;
    }

    getQuickLaunchDock() {
        if (this.docks.length === 0) {
            return null;
        }

        const focusedMonitor = this.getFocusedMonitorIndex();
        const focusedDock = this.docks.find(dock => {
            return dock.monitorManager.getCurrentMonitor().index === focusedMonitor;
        });
        if (focusedDock) {
            return focusedDock;
        }

        const pointerMonitor = global.display.get_current_monitor();
        if (pointerMonitor >= 0) {
            const pointerDock = this.docks.find(dock => {
                return dock.monitorManager.getCurrentMonitor().index === pointerMonitor;
            });
            if (pointerDock) {
                return pointerDock;
            }
        }

        return this.docks[0];
    }

    destroyDocks() {
        if (this._reloadIdleId) {
            this.timers.remove(this._reloadIdleId);
            this._reloadIdleId = null;
        }

        this.docks.forEach(dock => {
            if (dock) dock.destroy();
        });
        this.docks = [];
    }

    destroy() {
        if (this.settings) {
            this.settings.disconnectObject(this);
        }
        this.destroyDocks();
        this.folderManager = null;
        this.appManager.destroy();
        this.appManager = null;
        this._gnomeDash.release();
        if (this.timers) {
            this.timers.destroy();
            this.timers = null;
        }
        this.settings = null;
        this.openPrefsCallback = null;
    }
}