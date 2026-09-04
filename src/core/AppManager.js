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
        this.dockOrder = [];
        this.folders = [];

        this.extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), this.uuid]);
        this.dbPath = GLib.build_filenamev([this.extConfigDir, 'dhruva-dock-items.json']);

        this.favManager = AppFavorites.getAppFavorites();

        this.loadDockStateSync();

        this.settings.connectObject('changed::independent-dock', () => {
            if (this.isIndependent()) {
                this.loadDockStateSync();
            } else if (this._onStateChangedCallback) {
                this._onStateChangedCallback();
            }
        }, this);
    }

    isIndependent() {
        return this.settings.get_boolean('independent-dock');
    }

    onStateChanged(callback) {
        this._onStateChangedCallback = callback;
    }

    getCurrentPinnedList() {
        if (this.isIndependent()) {
            return [...(this.pinnedApps || [])];
        }
        const favorites = this.favManager.getFavorites();
        return favorites.map(a => a.get_id ? a.get_id() : '').filter(Boolean);
    }

    loadDockStateSync() {
        const file = Gio.File.new_for_path(this.dbPath);
        if (!file.query_exists(null)) {
            this.pinnedApps = [
                'org.gnome.Nautilus.desktop',
                'org.gnome.Terminal.desktop',
                'org.gnome.Software.desktop',
                'org.gnome.Calculator.desktop',
                'org.gnome.TextEditor.desktop'
            ];
            this.dockOrder = [...this.pinnedApps];
            this.folders = [];
            this.saveDockState();
            return;
        }

        try {
            const [success, contents] = file.load_contents(null);
            if (success && contents) {
                const decoder = new TextDecoder('utf-8');
                const parsed = JSON.parse(decoder.decode(contents));

                if (Array.isArray(parsed)) {
                    this.pinnedApps = parsed.filter(id => !id.startsWith('folder:'));
                    this.dockOrder = [...parsed];
                    this.folders = [];
                } else if (parsed && typeof parsed === 'object') {
                    this.pinnedApps = Array.isArray(parsed.apps) ? parsed.apps : [];
                    this.dockOrder = Array.isArray(parsed.order) ? parsed.order : [];
                    this.folders = Array.isArray(parsed.folders) ? parsed.folders : [];
                }
                return;
            }
        } catch (e) {
            console.error(`[Dhruva] Failed to read dock state JSON: ${e.message}`);
        }

        this.pinnedApps = [
            'org.gnome.Nautilus.desktop',
            'org.gnome.Terminal.desktop',
            'org.gnome.Software.desktop',
            'org.gnome.Calculator.desktop',
            'org.gnome.TextEditor.desktop'
        ];
        this.dockOrder = [...this.pinnedApps];
        this.folders = [];
        this.saveDockState();
    }

    saveDockState() {
        GLib.mkdir_with_parents(this.extConfigDir, 0o755);

        const payload = {
            apps: this.pinnedApps || [],
            order: this.dockOrder || [],
            folders: this.folders || []
        };

        const dataStr = JSON.stringify(payload, null, 2);
        const file = Gio.File.new_for_path(this.dbPath);
        const bytes = new GLib.Bytes(new TextEncoder().encode(dataStr));

        file.replace_contents_bytes_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (obj, res) => {
                try {
                    obj.replace_contents_finish(res);
                } catch (e) {
                    console.error(`[Dhruva] Failed to write dock state JSON: ${e.message}`);
                }
            }
        );
    }

    savePinnedApps(newArray = null) {
        if (newArray) this.pinnedApps = newArray;
        this.saveDockState();
    }

    getDockOrder() {
        const currentPinned = this.getCurrentPinnedList();
        const currentFolderKeys = (this.folders || []).map(f => `folder:${f.id}`);
        const existingOrder = [...(this.dockOrder || [])];

        const finalOrder = [];

        existingOrder.forEach(key => {
            if (key.startsWith('folder:')) {
                if (currentFolderKeys.includes(key) && !finalOrder.includes(key)) {
                    finalOrder.push(key);
                }
            } else {
                if (currentPinned.includes(key) && !finalOrder.includes(key)) {
                    finalOrder.push(key);
                }
            }
        });

        currentPinned.forEach(appId => {
            if (!finalOrder.includes(appId)) {
                finalOrder.push(appId);
            }
        });

        currentFolderKeys.forEach(fKey => {
            if (!finalOrder.includes(fKey)) {
                finalOrder.push(fKey);
            }
        });

        this.dockOrder = finalOrder;
        return this.dockOrder;
    }

    saveDockOrder(newOrderArray = null) {
        if (Array.isArray(newOrderArray)) {
            this.dockOrder = newOrderArray;
            this.saveDockState();
        }
    }

    getFolders() {
        return this.folders || [];
    }

    saveFolders(foldersList) {
        if (Array.isArray(foldersList)) {
            this.folders = foldersList;
            this.saveDockState();
        }
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
                if (!this.dockOrder.includes(id)) {
                    this.dockOrder.push(id);
                }
                this.saveDockState();
                if (this._onStateChangedCallback) this._onStateChangedCallback();
            }
            return true;
        }

        if (!this.hasApp(app)) {
            this.favManager.addFavorite(id);
            if (!this.dockOrder.includes(id)) {
                this.dockOrder.push(id);
                this.saveDockState();
            }
        }
        return true;
    }

    removeApp(app) {
        if (!app) return false;
        let id = app.get_id ? app.get_id() : app;

        this.dockOrder = (this.dockOrder || []).filter(itemId => itemId !== id);

        if (this.isIndependent()) {
            if (this.pinnedApps.includes(id)) {
                this.pinnedApps = this.pinnedApps.filter(pinnedId => pinnedId !== id);
                this.saveDockState();
                if (this._onStateChangedCallback) this._onStateChangedCallback();
                return true;
            }
            return false;
        }

        if (this.hasApp(app)) {
            this.favManager.removeFavorite(id);
        }

        try {
            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            const currentFavs = shellSettings.get_strv('favorite-apps') || [];
            if (currentFavs.includes(id)) {
                const newFavs = currentFavs.filter(favId => favId !== id);
                shellSettings.set_strv('favorite-apps', newFavs);
            }
        } catch (e) {
            console.error(`[Dhruva] Failed to sync unpin with GNOME Dash: ${e.message}`);
        }

        this.saveDockState();
        if (this._onStateChangedCallback) this._onStateChangedCallback();
        return true;
    }

    getDisplayApps() {
        const showUnpinned = this.settings.get_boolean('show-unpinned-apps');

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

        if (needsSave) this.saveDockState();

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
        if (this.settings) {
            this.settings.disconnectObject(this);
        }
        this.pinnedApps = [];
        this.dockOrder = [];
        this.folders = [];
        this.appSystem = null;
        this.favManager = null;
    }
}