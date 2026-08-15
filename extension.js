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


import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import QuickLaunchManager from './src/core/QuickLaunchManager.js';
import MultiMonitorController from './src/core/MultiMonitorController.js';


export default class DhruvaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        
        this._monitorController = new MultiMonitorController(
            this._settings,
            () => this.openPreferences(),
            this.uuid
        );

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._monitorController.reloadDocks();
        });

        this._settingsChangedId = this._settings.connect('changed::show-on-all-monitors', () => {
            this._monitorController.reloadDocks();
        });

        const getAxis = () => {
            const pos = this._settings.get_string('dock-position');
            return (pos === 'LEFT' || pos === 'RIGHT') ? 'vertical' : 'horizontal';
        };
        this._currentAxis = getAxis();

        this._positionChangedId = this._settings.connect('changed::dock-position', () => {
            const newAxis = getAxis();
            if (this._currentAxis !== newAxis) {
                this._currentAxis = newAxis;
                this._monitorController.reloadDocks();
            }
        });

        this._monitorController.reloadDocks();

        this._clearGnomeSwitchToApplicationShortcuts();

        this._quickLaunchManager = new QuickLaunchManager(
            this._settings,
            () => this._monitorController.getQuickLaunchDock()
        );
    }

    _clearGnomeSwitchToApplicationShortcuts() {
        let shellKeys;

        try {
            shellKeys = new Gio.Settings({
                schema_id: 'org.gnome.shell.keybindings'
            });
        } catch (_e) {}

        if (shellKeys) {
            for (let i = 1; i <= 9; i++) {
                const key = `switch-to-application-${i}`;
                try {
                    if (shellKeys.is_writable(key)) shellKeys.set_strv(key, []);
                } catch (_e) {}
            }
        }
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._positionChangedId) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }

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