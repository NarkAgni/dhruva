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


import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Settings } from './SettingsManager.js';


export default class FolderManager {
    constructor(settings, uuid, appManager = null, dockUI = null) {
        this.settings = settings;
        this.uuid = uuid || 'dhruva@narkagni';
        this.appManager = appManager;
        this.dockUI = dockUI;

        this.folders = [];
        this._stateListeners = new Set();
        this._loadFolders();

        if (this.settings) {
            this.settings.connectObject('changed::independent-dock', () => {
                this._loadFolders();
            }, this);
        }
    }

    setDockUI(dockUI) {
        this.dockUI = dockUI;
    }

    setAppManager(appManager) {
        this.appManager = appManager;
        this._loadFolders();
    }

    onStateChanged(callback) {
        this.addStateListener(callback);
    }

    addStateListener(callback) {
        if (callback) this._stateListeners.add(callback);
    }

    removeStateListener(callback) {
        if (callback) this._stateListeners.delete(callback);
    }

    _notifyStateChanged() {
        this._stateListeners.forEach(cb => {
            if (cb) cb();
        });
    }

    _loadFolders() {
        if (this.appManager) {
            this.folders = [...this.appManager.getFolders()];
        } else if (this.settings) {
            try {
                const raw = this.settings.get_string('app-folders');
                this.folders = raw ? JSON.parse(raw) : [];
            } catch (_e) {
                this.folders = [];
            }
        } else {
            this.folders = [];
        }

        if (!Array.isArray(this.folders)) {
            this.folders = [];
        }

        this._notifyStateChanged();
    }

    _saveFolders() {
        if (!Array.isArray(this.folders)) this.folders = [];

        if (this.appManager) {
            this.appManager.saveFolders(this.folders);
        } else if (this.settings && !Settings.independentDock) {
            try {
                this.settings.set_string('app-folders', JSON.stringify(this.folders));
            } catch (_e) {}
        }

        this._notifyStateChanged();
    }

    saveFolders() {
        this._saveFolders();
    }

    createFolder(name = _('New Folder'), icon = 'folder-symbolic') {
        const id = `dhruva-folder-${Date.now()}`;
        const newFolder = {
            id,
            name,
            icon,
            apps: []
        };
        this.folders.push(newFolder);

        if (this.appManager) {
            const currentPinned = this.appManager.getCurrentPinnedList();
            const currentOrder = [...this.appManager.getDockOrder()];
            const newFolderKey = `folder:${id}`;

            const baseOrder = [];

            currentOrder.forEach(key => {
                if (key !== newFolderKey && !baseOrder.includes(key)) {
                    baseOrder.push(key);
                }
            });

            currentPinned.forEach(appId => {
                if (!baseOrder.includes(appId)) {
                    baseOrder.push(appId);
                }
            });

            this.folders.forEach(f => {
                const fKey = `folder:${f.id}`;
                if (fKey !== newFolderKey && !baseOrder.includes(fKey)) {
                    baseOrder.push(fKey);
                }
            });

            baseOrder.push(newFolderKey);
            this.appManager.saveDockOrder(baseOrder);
        }

        this._saveFolders();
        if (this.dockUI && this.dockUI.queueRender) {
            this.dockUI.queueRender('incremental');
        }
        return newFolder.id;
    }

    addAppToFolder(folderId, appId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder && !folder.apps.includes(appId)) {
            folder.apps.push(appId);

            if (this.appManager) {
                if (this.appManager.isIndependent()) {
                    this.appManager.pinnedApps = (this.appManager.pinnedApps || []).filter(id => id !== appId);
                }
                this.appManager.dockOrder = (this.appManager.dockOrder || []).filter(id => id !== appId);
            }

            this._saveFolders();
            if (this.dockUI && this.dockUI.queueRender) {
                this.dockUI.queueRender('incremental');
            }
            return true;
        }
        return false;
    }

    removeAppFromFolder(folderId, appId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder) {
            folder.apps = folder.apps.filter(id => id !== appId);

            if (folder.apps.length === 0) {
                this.deleteFolder(folderId);
            } else {
                this._saveFolders();
                if (this.dockUI && this.dockUI.queueRender) {
                    this.dockUI.queueRender('incremental');
                }
            }
            return true;
        }
        return false;
    }

    updateFolder(folderId, newName, newIcon) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder) {
            if (newName !== undefined) folder.name = newName;
            if (newIcon !== undefined) folder.icon = newIcon;
            this._saveFolders();
            if (this.dockUI && this.dockUI.queueRender) {
                this.dockUI.queueRender('incremental');
            }
            return true;
        }
        return false;
    }

    deleteFolder(folderId) {
        this.folders = this.folders.filter(f => f.id !== folderId);

        if (this.appManager) {
            const order = this.appManager.getDockOrder().filter(k => k !== `folder:${folderId}`);
            this.appManager.saveDockOrder(order);
        }

        this._saveFolders();
        if (this.dockUI && this.dockUI.queueRender) {
            this.dockUI.queueRender('incremental');
        }
    }

    getFolders() {
        return this.folders || [];
    }

    destroy() {
        if (this.settings) {
            this.settings.disconnectObject(this);
        }
        this.folders = [];
        this.appManager = null;
        this.dockUI = null;
        this._stateListeners.clear();
    }
}