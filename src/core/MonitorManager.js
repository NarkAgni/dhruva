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


export default class MonitorManager {
    constructor(settings, fixedMonitorIndex = null) {
        this.settings = settings;
        this.fixedMonitorIndex = fixedMonitorIndex;
    }

    getCurrentMonitor() {
        const monitors = Main.layoutManager.monitors;

        if (this.fixedMonitorIndex !== null && this.fixedMonitorIndex >= 0 && this.fixedMonitorIndex < monitors.length) {
            return {
                monitor: monitors[this.fixedMonitorIndex],
                index: this.fixedMonitorIndex
            };
        }

        const preferredIdx = this.settings.get_int('preferred-monitor');
        if (preferredIdx >= 0 && preferredIdx < monitors.length) {
            return {
                monitor: monitors[preferredIdx],
                index: preferredIdx
            };
        }

        return {
            monitor: Main.layoutManager.primaryMonitor,
            index: Main.layoutManager.primaryIndex,
        };
    }

    destroy() {
        this.settings = null;
    }
}