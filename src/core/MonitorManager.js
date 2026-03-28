/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
* * This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
* * This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
* * You should have received a copy of the GNU General Public License
* along with this program. If not, see https://www.gnu.org/licenses/. 
*/


import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export default class MonitorManager {
    constructor(settings) {
        this.settings = settings;
    }

    getCurrentMonitor() {
        try {
            const preferredIdx = this.settings.get_int('preferred-monitor');
            const monitors = Main.layoutManager.monitors;

            if (preferredIdx >= 0 && preferredIdx < monitors.length) {
                return { monitor: monitors[preferredIdx], index: preferredIdx };
            }
        } catch (e) {
            console.error(`[Dhruva] Monitor fetch error: ${e.message}`);
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