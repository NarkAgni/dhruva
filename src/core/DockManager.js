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

import { Settings } from './SettingsManager.js';


const FALLBACK_PANEL_HEIGHT = 27;

export default class DockManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
    }

    updatePosition() {
        if (!this.dockUI || !this.dockUI.actor || !this.dockUI.boxActor || !this.dockUI.actor.visible) return;
        if (!this.dockUI.actor.is_mapped()) return;

        const isAutohideActive = this.dockUI.autoHideManager && (this.dockUI.autoHideManager.isAnimating || this.dockUI.autoHideManager.isHidden);
        if (!isAutohideActive) {
            this.dockUI.actor.remove_all_transitions();
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;
        }

        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorResult || !monitorResult.monitor) return;

        const actualMonitor = monitorResult.monitor;
        let topOffset = 0;
        const isHybrid = Settings.hybridPanelMode;
        if (!isHybrid && monitorResult.index === Main.layoutManager.primaryIndex && Main.panel && Main.panel.visible) {
            topOffset = Main.panel.height || FALLBACK_PANEL_HEIGHT;
        }

        const workArea = {
            x: actualMonitor.x,
            y: actualMonitor.y + topOffset,
            width: actualMonitor.width,
            height: actualMonitor.height - topOffset
        };

        const rawMargin = Math.max(0, Settings.dockMargin || 0);
        const pos = Settings.dockPosition;
        const isFullWidth = Settings.fullWidth || isHybrid;
        const isNeverHide = Settings.hideMode === 'none';

        const aw = this.dockUI.actor.width;
        const ah = this.dockUI.actor.height;

        let xPos = 0;
        let yPos = 0;

        if (isNeverHide) {
            if (pos === 'TOP') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y;
            } else if (pos === 'BOTTOM') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = actualMonitor.y + actualMonitor.height - ah;
            } else if (pos === 'LEFT') {
                xPos = workArea.x;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            } else if (pos === 'RIGHT') {
                xPos = actualMonitor.x + actualMonitor.width - aw;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            }
        } else {
            if (pos === 'TOP') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y + rawMargin;
            } else if (pos === 'BOTTOM') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y + workArea.height - ah - rawMargin;
            } else if (pos === 'LEFT') {
                xPos = workArea.x + rawMargin;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            } else if (pos === 'RIGHT') {
                xPos = workArea.x + workArea.width - aw - rawMargin;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            }
        }

        this.dockUI.actor.set_position(Math.round(xPos), Math.round(yPos));

        if (isNeverHide && !this.dockUI._isOverviewActive) {
            Main.layoutManager._queueUpdateRegions();
        }
    }

    destroy() {
        this.dockUI = null;
    }
}