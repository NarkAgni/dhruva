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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import DockUI from '../ui/dock/DockUI.js';


export default class MultiMonitorController {
    constructor(settings, openPrefsCallback, uuid) {
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.uuid = uuid;
        this.docks = [];
    }

    reloadDocks() {
        const focusedMonitor = this.getFocusedMonitorIndex();
        this.destroyDocks();

        const showOnAll = this.settings.get_boolean('show-on-all-monitors');

        if (showOnAll) {
            const numMonitors = global.display.get_n_monitors();
            let monitorOrder = Array.from({ length: numMonitors }, (_v, i) => i);

            if (focusedMonitor !== null && focusedMonitor >= 0 && focusedMonitor < numMonitors) {
                monitorOrder = [
                    focusedMonitor,
                    ...monitorOrder.filter(i => i !== focusedMonitor),
                ];
            }

            for (const i of monitorOrder) {
                const dock = new DockUI(this.settings, this.openPrefsCallback, this.uuid, i);
                dock.show();
                this.docks.push(dock);
            }
        } else {
            const dock = new DockUI(this.settings, this.openPrefsCallback, this.uuid, null);
            dock.show();
            this.docks.push(dock);
        }
    }

    getFocusedMonitorIndex() {
        try {
            const focused = global.display.get_focus_window();
            if (focused) return focused.get_monitor();
        } catch (_e) {}
        return Main.layoutManager.primaryIndex ?? 0;
    }

    getQuickLaunchDock() {
        if (!this.docks || this.docks.length === 0) return null;

        const focusedMonitor = this.getFocusedMonitorIndex();
        if (focusedMonitor !== null && focusedMonitor >= 0) {
            const focusedDock = this.docks.find(dock => {
                try {
                    return dock.monitorManager.getCurrentMonitor().index === focusedMonitor;
                } catch (_e) {
                    return false;
                }
            });
            if (focusedDock) return focusedDock;
        }

        let pointerMonitor = null;
        try {
            if (typeof global.display.get_current_monitor === 'function')
                pointerMonitor = global.display.get_current_monitor();
        } catch (_e) {}

        if (pointerMonitor !== null && pointerMonitor >= 0) {
            const pointerDock = this.docks.find(dock => {
                try {
                    return dock.monitorManager.getCurrentMonitor().index === pointerMonitor;
                } catch (_e) {
                    return false;
                }
            });
            if (pointerDock) return pointerDock;
        }

        return this.docks[0];
    }

    destroyDocks() {
        if (this.docks && this.docks.length > 0) {
            this.docks.forEach(dock => {
                if (dock && typeof dock.destroy === 'function') {
                    dock.destroy();
                }
            });
            this.docks = [];
        }
    }
}