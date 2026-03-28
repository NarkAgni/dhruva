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


export default class DockManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
    }

    updatePosition() {
        if (!this.dockUI || this.dockUI._isDestroyed || !this.dockUI.actor || !this.dockUI.boxActor) return;
        if (!this.dockUI.actor.is_mapped()) return;

        try {
            this.dockUI.actor.remove_all_transitions();
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;

            const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
            if (!monitorResult || !monitorResult.monitor) return;
            
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorResult.index);
            const margin = this.settings.get_int('dock-margin');
            const pos = this.settings.get_string('dock-position');
            const isFullWidth = this.settings.get_boolean('full-width');

            let xPos = 0, yPos = 0;
            const aw = this.dockUI.actor.width;
            const ah = this.dockUI.actor.height;

            if (pos === 'TOP') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y + margin + 2;
            } else if (pos === 'BOTTOM') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y + workArea.height - ah - margin;
            } else if (pos === 'LEFT') {
                xPos = workArea.x + margin;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            } else if (pos === 'RIGHT') {
                xPos = workArea.x + workArea.width - aw - margin;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            }

            this.dockUI.actor.set_position(xPos, yPos);

            if (this.dockUI.autoHideManager) {
                this.dockUI.autoHideManager.isVisible = true;
                this.dockUI.autoHideManager.isAnimating = false;
            }
        } catch (e) {}
    }

    destroy() {
        this.dockUI = null;
        this.settings = null;
    }
}