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
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import QuickLaunchManager from './src/core/QuickLaunchManager.js';
import MultiMonitorController from './src/core/MultiMonitorController.js';


export default class DhruvaExtension extends Extension {
    enable() {
        const ubuntuDock = Main.extensionManager?.lookup('ubuntu-dock@ubuntu.com');
        if (ubuntuDock && ubuntuDock.state === 1) {
            console.warn('[Dhruva] Detected active ubuntu-dock@ubuntu.com. Disabling or resetting its pressure barriers is recommended.');
        }

        this._settings = this.getSettings();

        this._monitorController = new MultiMonitorController(
            this._settings,
            () => {
                const res = this.openPreferences();
                if (res instanceof Promise) res.catch(err => console.warn('[Dhruva]', err.message));
            },
            this.uuid
        );

        Main.layoutManager.connectObject('monitors-changed', () => {
            this._monitorController.reloadDocks();
        }, this);

        const getAxis = () => {
            const pos = this._settings.get_string('dock-position');
            return (pos === 'LEFT' || pos === 'RIGHT') ? 'vertical' : 'horizontal';
        };
        this._currentAxis = getAxis();

        this._settings.connectObject(
            'changed::show-on-all-monitors', () => {
                this._monitorController.reloadDocks();
            },
            'changed::dock-position', () => {
                const newAxis = getAxis();
                if (this._currentAxis !== newAxis) {
                    this._currentAxis = newAxis;
                    this._monitorController.reloadDocks();
                }
            },
            this
        );

        this._monitorController.reloadDocks();

        this._quickLaunchManager = new QuickLaunchManager(
            this._settings,
            () => this._monitorController.getQuickLaunchDock()
        );
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);

        if (this._quickLaunchManager) {
            this._quickLaunchManager.destroy();
            this._quickLaunchManager = null;
        }

        if (this._monitorController) {
            this._monitorController.destroyDocks();
            this._monitorController = null;
        }

        this._currentAxis = null;
        this._settings = null;
    }
}