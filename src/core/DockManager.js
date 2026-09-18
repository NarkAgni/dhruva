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
import { TimeoutTracker } from './TimeoutTracker.js';


const FALLBACK_PANEL_HEIGHT = 27;

export default class DockManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this._originalDash = Main.overview.dash;
        this.timers = new TimeoutTracker();

        this._applyDashState();

        this.settings.connectObject('changed::independent-dock', () => {
            this._applyDashState();
        }, this);
    }

    _applyDashState() {
        if (Settings.independentDock) {
            this._restoreGnomeDash();
        } else {
            this._takeoverGnomeDash();
        }
    }

    _takeoverGnomeDash() {
        if (!this._originalDash) return;

        if (!this._origAdjustIconSize && this._originalDash._adjustIconSize) {
            this._origAdjustIconSize = this._originalDash._adjustIconSize.bind(this._originalDash);
            this._originalDash._adjustIconSize = () => {
                const box = this._originalDash._box;
                if (!box) return;
                const children = box.get_children ? box.get_children() : [];
                const firstIcon = children.find(c => c && c.icon && c.icon.ensure_style);
                if (!firstIcon) return;
                try {
                    this._origAdjustIconSize();
                } catch (_e) { }
            };
        }

        this._originalDash.opacity = 0;
        this._originalDash.reactive = false;

        if (this._originalDash.show) {
            this._originalDash.show();
        }
    }

    _restoreGnomeDash() {
        if (this._originalDash && this._origAdjustIconSize) {
            this._originalDash._adjustIconSize = this._origAdjustIconSize;
            this._origAdjustIconSize = null;
        }

        if (this._originalDash) {
            this._originalDash.opacity = 255;
            this._originalDash.reactive = true;
            this._originalDash.set_height(-1);
            this._originalDash.set_width(-1);
            if (this._originalDash.show) {
                this._originalDash.show();
            }
        }
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
        if (monitorResult.index === Main.layoutManager.primaryIndex && Main.panel && Main.panel.visible) {
            topOffset = Main.panel.height || FALLBACK_PANEL_HEIGHT;
        }

        const workArea = {
            x: actualMonitor.x,
            y: actualMonitor.y + topOffset,
            width: actualMonitor.width,
            height: actualMonitor.height - topOffset
        };

        const rawMargin = Settings.dockMargin;
        const pos = Settings.dockPosition;
        const isFullWidth = Settings.fullWidth;

        const margin = rawMargin;

        let xPos = 0;
        let yPos = 0;
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
    }

    destroy() {
        this.timers.destroy();

        if (this.settings) {
            this.settings.disconnectObject(this);
        }

        this._restoreGnomeDash();

        this.dockUI = null;
        this.settings = null;
    }
}