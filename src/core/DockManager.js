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
import { isDynamicPanelLayout, isFullBarLayout } from './LayoutMode.js';


const FALLBACK_PANEL_HEIGHT = 27;

export default class DockManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
    }

    updatePosition() {
        if (!this.dockUI || !this.dockUI.actor || !this.dockUI.boxActor || !this.dockUI.actor.visible) return;
        if (!this.dockUI.actor.is_mapped()) return;

        if (this.dockUI._isOverviewActive) {
            this.dockUI._applyOverviewLeftPosition();
            return;
        }

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
        const isDynamicPanel = isDynamicPanelLayout();
        const isFullWidth = isFullBarLayout();
        const isNeverHide = Settings.hideMode === 'none';
        const dynAlign = isDynamicPanel ? (Settings.dynamicPanelPosition || 'CENTER') : 'CENTER';
        const edgeGap = Math.max(8, rawMargin);

        const aw = this.dockUI.actor.width;
        const ah = this.dockUI.actor.height;

        const resolveAxisX = () => {
            if (isFullWidth) return workArea.x;
            if (isDynamicPanel && dynAlign === 'START') return workArea.x + edgeGap;
            if (isDynamicPanel && dynAlign === 'END') return workArea.x + workArea.width - aw - edgeGap;
            return workArea.x + (workArea.width - aw) / 2;
        };

        const resolveAxisY = () => {
            if (isFullWidth) return workArea.y;
            if (isDynamicPanel && dynAlign === 'START') return workArea.y + edgeGap;
            if (isDynamicPanel && dynAlign === 'END') return workArea.y + workArea.height - ah - edgeGap;
            return workArea.y + (workArea.height - ah) / 2;
        };

        let xPos = 0;
        let yPos = 0;

        if (isNeverHide) {
            if (pos === 'TOP') {
                xPos = resolveAxisX();
                yPos = workArea.y;
            } else if (pos === 'BOTTOM') {
                xPos = resolveAxisX();
                yPos = actualMonitor.y + actualMonitor.height - ah;
            } else if (pos === 'LEFT') {
                xPos = workArea.x;
                yPos = resolveAxisY();
            } else if (pos === 'RIGHT') {
                xPos = actualMonitor.x + actualMonitor.width - aw;
                yPos = resolveAxisY();
            }
        } else {
            if (pos === 'TOP') {
                xPos = resolveAxisX();
                yPos = workArea.y + rawMargin;
            } else if (pos === 'BOTTOM') {
                xPos = resolveAxisX();
                yPos = workArea.y + workArea.height - ah - rawMargin;
            } else if (pos === 'LEFT') {
                xPos = workArea.x + rawMargin;
                yPos = resolveAxisY();
            } else if (pos === 'RIGHT') {
                xPos = workArea.x + workArea.width - aw - rawMargin;
                yPos = resolveAxisY();
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