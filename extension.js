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


import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { destroyUtils } from './src/core/Utils.js';
import { Settings } from './src/core/SettingsManager.js';
import { migrateLegacyPaths } from './src/core/DataPaths.js';
import { TimeoutTracker } from './src/core/TimeoutTracker.js';
import { migrateSettings } from './src/core/SettingsMigration.js';
import QuickLaunchManager from './src/core/QuickLaunchManager.js';
import MultiMonitorController from './src/core/MultiMonitorController.js';


const SHORTCUT_KEY = 'toggle-independent-dock-shortcut';
const MONITORS_SETTLE_MS = 500;

const RELOAD_KEYS = ['dock-position', 'independent-dock', 'full-width', 'hybrid-panel-mode', 'start-menu'];

export default class DhruvaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        migrateLegacyPaths(this._settings);
        migrateSettings(this._settings, this.metadata['version-name']);
        Settings.init(this._settings);
        this._timers = new TimeoutTracker();
        this._isShortcutRegistered = false;
        this._monitorsChangedId = 0;

        this._monitorController = new MultiMonitorController(this._settings, () => this.openPreferences(), this.uuid);

        Main.layoutManager.connectObject('monitors-changed', () => {
            if (this._monitorsChangedId) {
                this._timers.remove(this._monitorsChangedId);
                this._monitorsChangedId = 0;
            }
            this._monitorsChangedId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, MONITORS_SETTLE_MS, () => {
                this._monitorsChangedId = 0;
                this._monitorController.handleMonitorsChanged();
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        for (const key of RELOAD_KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._monitorController.reloadDocks(), this);
        this._settings.connectObject(`changed::${SHORTCUT_KEY}`, () => this._syncShortcut(), this);

        this._syncShortcut();
        this._monitorController.reloadDocks();
        this._quickLaunchManager = new QuickLaunchManager(this._settings, () => this._monitorController.getQuickLaunchDock());
    }

    _syncShortcut() {
        if (this._isShortcutRegistered) {
            Main.wm.removeKeybinding(SHORTCUT_KEY);
            this._isShortcutRegistered = false;
        }

        const [accelerator] = this._settings.get_strv(SHORTCUT_KEY);
        if (!accelerator || !accelerator.trim()) return;

        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => { Settings.independentDock = !Settings.independentDock; });
        this._isShortcutRegistered = true;
    }

    disable() {
        if (this._isShortcutRegistered) Main.wm.removeKeybinding(SHORTCUT_KEY);
        this._isShortcutRegistered = false;

        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._timers.destroy();
        this._timers = null;

        this._quickLaunchManager.destroy();
        this._quickLaunchManager = null;
        this._monitorController.destroy();
        this._monitorController = null;

        destroyUtils();
        Settings.destroy();
        this._settings = null;
    }
}