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
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Settings } from './src/core/SettingsManager.js';
import { TimeoutTracker } from './src/core/TimeoutTracker.js';
import QuickLaunchManager from './src/core/QuickLaunchManager.js';
import MultiMonitorController from './src/core/MultiMonitorController.js';


export default class DhruvaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        Settings.init(this._settings);
        this._timers = new TimeoutTracker();

        this._monitorController = new MultiMonitorController(
            this._settings,
            () => this.openPreferences(),
            this.uuid
        );

        this._monitorsChangedId = 0;
        Main.layoutManager.connectObject(
            'monitors-changed',
            () => {
                if (this._monitorsChangedId) {
                    this._timers.remove(this._monitorsChangedId);
                    this._monitorsChangedId = 0;
                }

                this._monitorsChangedId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._monitorsChangedId = 0;
                    if (this._monitorController && Main.layoutManager.monitors && Main.layoutManager.monitors.length > 0) {
                        this._monitorController.handleMonitorsChanged();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            },
            this
        );

        this._currentAxis = this._getAxis();

        this._settings.connectObject(
            'changed::dock-position',
            () => {
                const axis = this._getAxis();
                if (this._currentAxis !== axis) {
                    this._currentAxis = axis;
                    if (this._monitorController) {
                        this._monitorController.reloadDocks();
                    }
                }
            },
            'changed::independent-dock',
            () => {
                if (this._monitorController) {
                    this._monitorController.reloadDocks();
                }
            },
            this
        );

        this._monitorController.reloadDocks();

        this._quickLaunchManager = new QuickLaunchManager(
            this._settings,
            () => {
                if (this._monitorController) {
                    return this._monitorController.getQuickLaunchDock();
                }
                return null;
            }
        );
    }

    disable() {
        Main.layoutManager.disconnectObject(this);

        if (this._timers) {
            this._timers.destroy();
            this._timers = null;
        }

        if (this._settings) {
            this._settings.disconnectObject(this);
        }

        if (this._quickLaunchManager) {
            this._quickLaunchManager.destroy();
            this._quickLaunchManager = null;
        }

        if (this._monitorController) {
            this._monitorController.destroy();
            this._monitorController = null;
        }

        this._currentAxis = null;
        Settings.destroy();
        this._settings = null;
    }

    _getAxis() {
        const pos = this._settings ? Settings.dockPosition : 'BOTTOM';
        return (pos === 'LEFT' || pos === 'RIGHT') ? 'vertical' : 'horizontal';
    }
}