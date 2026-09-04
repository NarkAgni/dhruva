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


export default class FolderManager {
    constructor(settings, uuid, appManager = null) {
        this.settings = settings;
        this.uuid = uuid || 'dhruva@narkagni';
        this.appManager = appManager;

        this.folders = [];
        this._loadFolders();
    }

    setAppManager(appManager) {
        this.appManager = appManager;
        this._loadFolders();
    }

    onStateChanged(callback) {
        this._onStateChangedCallback = callback;
    }

    _notifyStateChanged() {
        if (this._onStateChangedCallback) {
            this._onStateChangedCallback();
        }
    }

    _loadFolders() {
        if (this.appManager) {
            this.folders = this.appManager.getFolders();
        } else {
            this.folders = [];
        }
        this._notifyStateChanged();
    }

    _saveFolders() {
        if (this.appManager) {
            this.appManager.saveFolders(this.folders);
        }
        this._notifyStateChanged();
    }

    saveFolders() {
        this._saveFolders();
    }

    createFolder(name = 'New Folder', icon = 'folder-symbolic') {
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
        return newFolder.id;
    }

    addAppToFolder(folderId, appId) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder && !folder.apps.includes(appId)) {
            folder.apps.push(appId);
            this._saveFolders();
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
    }

    getFolders() {
        return this.folders || [];
    }

    destroy() {
        this.folders = [];
        this.appManager = null;
        this._onStateChangedCallback = null;
    }
}