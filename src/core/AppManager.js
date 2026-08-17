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
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';


export default class AppManager {
    constructor(uuid, settings) {
        this.appSystem = Shell.AppSystem.get_default();
        this.settings = settings;
        this.uuid = uuid;
        
        this.pinnedApps = [];
        this.extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), this.uuid]);
        this.dbPath = GLib.build_filenamev([this.extConfigDir, 'dhruva-apps.json']);

        this.favManager = AppFavorites.getAppFavorites();

        if (this.isIndependent()) {
            this.loadPinnedAppsAsync();
        }

        this._settingSignal = this.settings.connect('changed::independent-dock', () => {
            if (this.isIndependent()) {
                this.loadPinnedAppsAsync();
            } else if (typeof this._onStateChangedCallback === 'function') {
                this._onStateChangedCallback();
            }
        });
    }

    isIndependent() {
        return this.settings.get_boolean('independent-dock');
    }

    onStateChanged(callback) {
        this._onStateChangedCallback = callback;
    }

    loadPinnedAppsAsync() {
        const file = Gio.File.new_for_path(this.dbPath);
        file.load_contents_async(null, (obj, res) => {
            let success = false;
            let contents = null;
            [success, contents] = obj.load_contents_finish(res);

            if (success && contents) {
                const decoder = new TextDecoder('utf-8');
                const parsed = JSON.parse(decoder.decode(contents));
                if (Array.isArray(parsed)) {
                    this.pinnedApps = parsed;
                    if (typeof this._onStateChangedCallback === 'function') {
                        this._onStateChangedCallback();
                    }
                    return;
                }
            }

            this.pinnedApps = [
                'org.gnome.Nautilus.desktop',
                'org.gnome.Terminal.desktop',
                'org.gnome.Software.desktop',
                'org.gnome.Calculator.desktop',
                'org.gnome.TextEditor.desktop'
            ];
            this.savePinnedApps();
            if (typeof this._onStateChangedCallback === 'function') {
                this._onStateChangedCallback();
            }
        });
    }

    savePinnedApps(newArray = null) {
        if (newArray) this.pinnedApps = newArray;
        
        GLib.mkdir_with_parents(this.extConfigDir, 0o755);
        const dataStr = JSON.stringify(this.pinnedApps, null, 2);
        
        const file = Gio.File.new_for_path(this.dbPath);
        const bytes = new GLib.Bytes(new TextEncoder().encode(dataStr));
        
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (obj, res) => {
            obj.replace_contents_finish(res);
        });
    }

    hasApp(app) {
        if (!app) return false;
        if (this.isIndependent()) {
            return this.pinnedApps.includes(app.get_id());
        }
        return this.favManager.isFavorite(app.get_id());
    }

    addApp(app) {
        if (!app) return false;
        let id = app.get_id();
        
        if (this.isIndependent()) {
            if (!this.pinnedApps.includes(id)) {
                this.pinnedApps.push(id);
                this.savePinnedApps();
                if (this._onStateChangedCallback) this._onStateChangedCallback();
            }
            return true;
        }

        if (!this.hasApp(app)) {
            this.favManager.addFavorite(id);
        }
        return true;
    }

    removeApp(app) {
        if (!app) return false;
        let id = app.get_id();
        
        if (this.isIndependent()) {
            if (this.pinnedApps.includes(id)) {
                this.pinnedApps = this.pinnedApps.filter(pinnedId => pinnedId !== id);
                this.savePinnedApps();
                if (this._onStateChangedCallback) this._onStateChangedCallback();
                return true;
            }
            return false;
        }

        if (this.hasApp(app)) {
            this.favManager.removeFavorite(id);
            return true;
        }
        return false;
    }

    getDisplayApps() {
        let showUnpinned = true;
        try {
            showUnpinned = this.settings.get_boolean('show-unpinned-apps');
        } catch (e) {}

        if (!this.isIndependent()) {
            const favorites = this.favManager.getFavorites();
            const runningApps = this.appSystem.get_running();
            const favIds = new Set(favorites.map(a => a.get_id()));

            let displayApps = [...favorites];
            
            if (showUnpinned) {
                runningApps.forEach(app => {
                    if (!favIds.has(app.get_id())) {
                        const activeWins = app.get_windows().filter(w => !w.is_skip_taskbar());
                        if (activeWins.length > 0) {
                            displayApps.push(app);
                        }
                    }
                });
            }
            return displayApps;
        }

        const runningApps = this.appSystem.get_running();
        const runningIds = new Set(runningApps.map(a => a.get_id()));
        let displayApps = [];
        let needsSave = false;

        this.pinnedApps = this.pinnedApps.filter(id => {
            let app = this.appSystem.lookup_app(id);
            if (app) {
                displayApps.push(app);
                runningIds.delete(id);
                return true;
            } else {
                needsSave = true;
                return false;
            }
        });

        if (needsSave) this.savePinnedApps();

        if (showUnpinned) {
            runningApps.forEach(app => {
                if (runningIds.has(app.get_id())) {
                    const activeWins = app.get_windows().filter(w => !w.is_skip_taskbar());
                    if (activeWins.length > 0) {
                        displayApps.push(app);
                    }
                }
            });
        }

        return displayApps;
    }

    destroy() {
        if (this._settingSignal) {
            this.settings.disconnect(this._settingSignal);
            this._settingSignal = null;
        }
        this.pinnedApps = [];
        this.appSystem = null;
        this.favManager = null;
    }
}