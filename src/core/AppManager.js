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

import { Settings } from './SettingsManager.js';


const DEFAULT_PINNED_APPS = [
    'org.gnome.Nautilus.desktop',
    'org.gnome.Terminal.desktop',
    'org.gnome.Software.desktop',
    'org.gnome.Calculator.desktop',
    'org.gnome.TextEditor.desktop'
];

export default class AppManager {
    constructor(uuid, settings) {
        this.appSystem = Shell.AppSystem.get_default();
        this.settings = settings;
        this.uuid = uuid;

        this.pinnedApps = [];
        this.dockOrder = [];
        this.independentFolders = [];
        this.nonIndependentFolders = [];
        this._unpinnedOrder = [];
        this._isLoaded = false;
        this._cancellable = new Gio.Cancellable();
        this._docks = new Set();
        this._stateListeners = new Set();

        this.extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), this.uuid]);
        this.dbPath = GLib.build_filenamev([this.extConfigDir, 'dhruva-dock-items.json']);
        this.orderPath = GLib.build_filenamev([this.extConfigDir, 'dhruva-dock-order.json']);

        this.favManager = AppFavorites.getAppFavorites();

        this._loadState();
        this.settings.connectObject('changed::independent-dock', () => {
            this._loadState();
            this.notifyStateChanged();
        }, this);
    }

    _loadState() {
        this.dockOrder = [];
        this._unpinnedOrder = [];

        if (this.isIndependent()) {
            this.loadDockState();
        } else {
            this.loadNonIndependentFolders();
            this._loadDockOrderFile();
            this._syncFolderAppsToPinned();
        }

        let iconFixed = false;
        this.getFolders().forEach(folder => {
            if (!folder.icon || folder.icon === 'folder-symbolic') {
                folder.icon = 'folder';
                iconFixed = true;
            }
        });
        if (iconFixed) this.saveFolders(this.getFolders());
    }

    attachDock(dockUI) {
        this._docks.add(dockUI);
    }

    detachDock(dockUI) {
        this._docks.delete(dockUI);
    }

    queueRender(mode, force = false) {
        this._docks.forEach(dock => dock.queueRender(mode, force));
    }

    addStateListener(callback) {
        this._stateListeners.add(callback);
    }

    removeStateListener(callback) {
        this._stateListeners.delete(callback);
    }

    notifyStateChanged() {
        this._stateListeners.forEach(callback => callback());
        this.queueRender('incremental');
    }

    isIndependent() {
        return this.settings.get_boolean('independent-dock');
    }

    getFolderAppIds() {
        const set = new Set();
        this.getFolders().forEach(folder => {
            if (!Array.isArray(folder.apps)) return;
            folder.apps.forEach(appId => {
                if (appId) set.add(appId);
            });
        });
        return set;
    }

    isAppInFolder(appId) {
        if (!appId) return false;
        const id = appId.get_id ? appId.get_id() : appId;
        return this.getFolderAppIds().has(id);
    }

    _syncFolderAppsToPinned() {
        const folderApps = [...this.getFolderAppIds()];

        if (this.isIndependent()) {
            const standalone = this.pinnedApps.filter(id => !folderApps.includes(id));
            this.pinnedApps = [...standalone, ...folderApps];
            return;
        }

        try {
            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            const currentFavs = shellSettings.get_strv('favorite-apps');
            const nextFavs = [...currentFavs.filter(id => !folderApps.includes(id)), ...folderApps];

            const isSame = currentFavs.length === nextFavs.length &&
                currentFavs.every((id, index) => id === nextFavs[index]);

            if (!isSame) shellSettings.set_strv('favorite-apps', nextFavs);
        } catch (e) {
            console.error(`[Dhruva] Failed to sync folder apps with GNOME Dash: ${e.message}`);
        }
    }

    getCurrentPinnedList() {
        const ids = this.isIndependent()
            ? [...this.pinnedApps]
            : this.favManager.getFavorites().map(app => app.get_id());

        this.getFolderAppIds().forEach(id => {
            if (!ids.includes(id)) ids.push(id);
        });
        return ids;
    }

    loadNonIndependentFolders() {
        try {
            const raw = this.settings.get_string('app-folders');
            const parsed = raw ? JSON.parse(raw) : [];
            this.nonIndependentFolders = Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            this.nonIndependentFolders = [];
        }
    }

    _loadDockOrderFile() {
        const file = Gio.File.new_for_path(this.orderPath);
        if (!file.query_exists(null)) return;

        try {
            const [, contents] = file.load_contents(null);
            const parsed = JSON.parse(new TextDecoder('utf-8').decode(contents));
            if (Array.isArray(parsed)) this.dockOrder = parsed;
        } catch (e) {
            console.error(`[Dhruva] Failed to read dock order JSON: ${e.message}`);
        }
    }

    _writeJson(path, data) {
        if (!this._cancellable) return;
        GLib.mkdir_with_parents(this.extConfigDir, 0o755);

        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(data, null, 2)));
        Gio.File.new_for_path(path).replace_contents_bytes_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            this._cancellable,
            (obj, res) => {
                try {
                    obj.replace_contents_finish(res);
                } catch (e) {
                    console.error(`[Dhruva] Failed to write ${path}: ${e.message}`);
                }
            }
        );
    }

    _saveOrder() {
        if (this.isIndependent()) this.saveDockState();
        else this._writeJson(this.orderPath, this.dockOrder);
    }

    loadDockState() {
        const file = Gio.File.new_for_path(this.dbPath);

        if (file.query_exists(null)) {
            try {
                const [success, contents] = file.load_contents(null);
                if (success && contents) {
                    const parsed = JSON.parse(new TextDecoder('utf-8').decode(contents));

                    if (Array.isArray(parsed)) {
                        this.pinnedApps = parsed.filter(id => !id.startsWith('folder:'));
                        this.dockOrder = [...parsed];
                        this.independentFolders = [];
                    } else if (parsed && (Array.isArray(parsed.apps) || Array.isArray(parsed.order))) {
                        this.pinnedApps = Array.isArray(parsed.apps) ? parsed.apps : [];
                        this.dockOrder = Array.isArray(parsed.order) ? parsed.order : [];
                        this.independentFolders = Array.isArray(parsed.folders) ? parsed.folders : [];
                    }

                    this._syncFolderAppsToPinned();
                    this._isLoaded = true;
                    return;
                }
            } catch (e) {
                console.error(`[Dhruva] Failed to read dock state JSON: ${e.message}`);
            }
        }

        if (!this._isLoaded) {
            this.pinnedApps = [...DEFAULT_PINNED_APPS];
            this.dockOrder = [...this.pinnedApps];
            this.independentFolders = [];
            this.saveDockState();
            this._isLoaded = true;
        }
    }

    saveDockState() {
        if (!this.isIndependent()) return;

        this._writeJson(this.dbPath, {
            apps: this.pinnedApps,
            order: this.dockOrder,
            folders: this.independentFolders
        });
    }

    savePinnedApps(newArray = null) {
        if (!Array.isArray(newArray)) return;

        const merged = [...newArray];
        this.getFolderAppIds().forEach(id => {
            if (!merged.includes(id)) merged.push(id);
        });
        this.pinnedApps = merged;
        this.saveDockState();
    }

    getDockOrder() {
        const folderApps = this.getFolderAppIds();
        const currentPinned = this.getCurrentPinnedList().filter(id => !folderApps.has(id));
        const currentFolderKeys = this.getFolders().map(f => `folder:${f.id}`);
        const existingOrder = [...this.dockOrder];

        const finalOrder = [];
        existingOrder.forEach(key => {
            if (finalOrder.includes(key)) return;
            if (key.startsWith('folder:') ? currentFolderKeys.includes(key) : currentPinned.includes(key)) {
                finalOrder.push(key);
            }
        });

        [...currentPinned, ...currentFolderKeys].forEach(key => {
            if (!finalOrder.includes(key)) finalOrder.push(key);
        });

        const orderChanged = existingOrder.length !== finalOrder.length ||
            existingOrder.some((k, idx) => k !== finalOrder[idx]);

        this.dockOrder = finalOrder;
        if (orderChanged) this._saveOrder();
        return this.dockOrder;
    }

    saveDockOrder(newOrderArray = null) {
        if (!Array.isArray(newOrderArray)) return;

        const folderApps = this.getFolderAppIds();
        const currentFolderKeys = new Set(this.getFolders().map(f => `folder:${f.id}`));
        const prevOrder = [...this.dockOrder];

        const incomingHasFolders = newOrderArray.some(k => k.startsWith('folder:'));
        const nextOrder = newOrderArray.filter(k => k.startsWith('folder:') || !folderApps.has(k));

        if (!incomingHasFolders && currentFolderKeys.size > 0) {
            prevOrder.forEach((key, idx) => {
                if (key.startsWith('folder:') && currentFolderKeys.has(key) && !nextOrder.includes(key)) {
                    nextOrder.splice(Math.min(idx, nextOrder.length), 0, key);
                }
            });
        }

        this.dockOrder = nextOrder;
        this._saveOrder();
    }

    getFolders() {
        return this.isIndependent() ? this.independentFolders : this.nonIndependentFolders;
    }

    saveFolders(foldersList) {
        if (!Array.isArray(foldersList)) return;

        foldersList.forEach(f => {
            const key = `folder:${f.id}`;
            if (!this.dockOrder.includes(key)) this.dockOrder.push(key);
        });

        if (this.isIndependent()) {
            this.independentFolders = foldersList;
            this._syncFolderAppsToPinned();
            this.saveDockState();
            return;
        }

        this.nonIndependentFolders = foldersList;
        try {
            this.settings.set_string('app-folders', JSON.stringify(foldersList));
        } catch (e) {
            console.error(`[Dhruva] Failed to save non-independent folders: ${e.message}`);
        }
        this._syncFolderAppsToPinned();
        this._writeJson(this.orderPath, this.dockOrder);
    }

    hasApp(app) {
        if (!app) return false;
        const id = app.get_id ? app.get_id() : app;
        if (this.isAppInFolder(id)) return true;
        if (this.isIndependent()) return this.pinnedApps.includes(id);
        return this.favManager.isFavorite(id);
    }

    addApp(app) {
        if (!app) return false;
        const id = app.get_id ? app.get_id() : app;
        const inFolder = this.isAppInFolder(id);

        if (this.isIndependent()) {
            if (!this.pinnedApps.includes(id)) this.pinnedApps.push(id);
            if (!inFolder && !this.dockOrder.includes(id)) this.dockOrder.push(id);
            this._syncFolderAppsToPinned();
            this.saveDockState();
        } else {
            if (!this.favManager.isFavorite(id)) this.favManager.addFavorite(id);
            this._syncFolderAppsToPinned();
            if (!inFolder && !this.dockOrder.includes(id)) {
                this.dockOrder.push(id);
                this._writeJson(this.orderPath, this.dockOrder);
            }
        }

        this.queueRender('incremental');
        return true;
    }

    removeApp(app) {
        if (!app) return false;
        const id = app.get_id ? app.get_id() : app;

        this.dockOrder = this.dockOrder.filter(itemId => itemId !== id);

        if (this.isIndependent()) {
            if (!this.pinnedApps.includes(id)) return false;
            this.pinnedApps = this.pinnedApps.filter(pinnedId => pinnedId !== id);
            this.saveDockState();
            this.queueRender('incremental');
            return true;
        }

        if (this.favManager.isFavorite(id)) this.favManager.removeFavorite(id);

        try {
            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            const currentFavs = shellSettings.get_strv('favorite-apps');
            if (currentFavs.includes(id)) {
                shellSettings.set_strv('favorite-apps', currentFavs.filter(favId => favId !== id));
            }
        } catch (e) {
            console.error(`[Dhruva] Failed to sync unpin with GNOME Dash: ${e.message}`);
        }

        this._writeJson(this.orderPath, this.dockOrder);
        this.queueRender('incremental');
        return true;
    }

    _collectUnpinned(activeRunningAppMap, excluded, folderApps, displayApps) {
        this._unpinnedOrder = this._unpinnedOrder.filter(id =>
            !excluded.has(id) && !folderApps.has(id) && activeRunningAppMap.has(id)
        );

        activeRunningAppMap.forEach((_app, id) => {
            if (!excluded.has(id) && !folderApps.has(id) && !this._unpinnedOrder.includes(id)) {
                this._unpinnedOrder.push(id);
            }
        });

        this._unpinnedOrder.forEach(id => displayApps.push(activeRunningAppMap.get(id)));
    }

    getDisplayApps() {
        const folderApps = this.getFolderAppIds();
        const activeRunningAppMap = new Map();

        this.appSystem.get_running().forEach(app => {
            if (app.get_windows().some(w => !w.is_skip_taskbar())) {
                activeRunningAppMap.set(app.get_id(), app);
            }
        });

        let displayApps;
        let pinnedIds;

        if (this.isIndependent()) {
            const standalonePinned = this.pinnedApps.filter(id => !folderApps.has(id));
            pinnedIds = new Set(standalonePinned);
            displayApps = standalonePinned
                .map(id => this.appSystem.lookup_app(id))
                .filter(app => app !== null);
        } else {
            displayApps = this.favManager.getFavorites().filter(app => !folderApps.has(app.get_id()));
            pinnedIds = new Set(displayApps.map(app => app.get_id()));
        }

        if (Settings.showUnpinnedApps) {
            this._collectUnpinned(activeRunningAppMap, pinnedIds, folderApps, displayApps);
        }
        return displayApps;
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        this.settings.disconnectObject(this);
        this._docks.clear();
        this._stateListeners.clear();
        this.pinnedApps = [];
        this.dockOrder = [];
        this._unpinnedOrder = [];
        this.independentFolders = [];
        this.nonIndependentFolders = [];
        this.appSystem = null;
        this.favManager = null;
    }
}