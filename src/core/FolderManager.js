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


export default class FolderManager {
    constructor(settings, uuid, appManager = null, dockUI = null) {
        this.settings = settings;
        this.uuid = uuid || 'dhruva@narkagni';
        this.appManager = appManager;
        this.dockUI = dockUI;

        this.folders = [];
        this._stateListeners = new Set();
        if (this.appManager) {
            this._loadFolders();
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
        this._stateListeners.delete(callback);
    }

    _notifyStateChanged() {
        this._stateListeners.forEach(cb => {
            if (cb) cb();
        });
    }

    _loadFolders() {
        this.folders = [];

        if (this.appManager) {
            this.folders = [...(this.appManager.getFolders() || [])];
        } else if (this.settings) {
            try {
                const raw = this.settings.get_string('app-folders');
                this.folders = raw ? JSON.parse(raw) : [];
            } catch (_e) {
                this.folders = [];
            }
        }

        if (!Array.isArray(this.folders)) {
            this.folders = [];
        }

        let updated = false;
        this.folders.forEach(f => {
            if (!f.icon || f.icon === 'folder-symbolic') {
                f.icon = 'folder';
                updated = true;
            }
        });

        if (updated) {
            this._saveFolders();
        }

        this._notifyStateChanged();
    }

    _saveFolders() {
        if (!Array.isArray(this.folders)) this.folders = [];

        if (this.appManager) {
            this.appManager.saveFolders(this.folders);
        }

        this._notifyStateChanged();
    }

    saveFolders() {
        this._saveFolders();
    }

    createFolder(name = _('New Folder'), icon = 'folder') {
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
                } else {
                    if (this.appManager.favManager.isFavorite(appId)) {
                        this.appManager.favManager.removeFavorite(appId);
                    }
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
        const folderList = this.appManager ? this.appManager.getFolders() : this.folders;
        const folder = (folderList || []).find(f => f.id === folderId);

        if (folder) {
            if (newName !== undefined) folder.name = newName;
            if (newIcon !== undefined) {
                folder.icon = (newIcon === 'folder-symbolic') ? 'folder' : newIcon;
            }

            this.folders = folderList;
            this._saveFolders();

            if (this.dockUI && this.dockUI.queueRender) {
                this.dockUI.queueRender('full', true);
            }
            return true;
        }
        return false;
    }

    deleteFolder(folderId) {
        const targetFolder = (this.getFolders() || []).find(f => f.id === folderId);
        const appsToRestore = targetFolder && Array.isArray(targetFolder.apps) ? [...targetFolder.apps] : [];

        this.folders = (this.getFolders() || []).filter(f => f.id !== folderId);

        if (this.appManager) {
            let currentOrder = (this.appManager.dockOrder || []).filter(k => k !== `folder:${folderId}`);

            if (this.appManager.isIndependent()) {
                if (!Array.isArray(this.appManager.pinnedApps)) this.appManager.pinnedApps = [];
                
                appsToRestore.forEach(appId => {
                    if (!this.appManager.pinnedApps.includes(appId)) {
                        this.appManager.pinnedApps.push(appId);
                    }
                    if (!currentOrder.includes(appId)) {
                        currentOrder.push(appId);
                    }
                });

                this.appManager.dockOrder = currentOrder;
                this.appManager.independentFolders = [...this.folders];
                this.appManager.saveDockState();
            } else {
                appsToRestore.forEach(appId => {
                    this.appManager.addApp(appId);
                });
                this.appManager.dockOrder = currentOrder;
                this._saveFolders();
            }
        } else {
            this._saveFolders();
        }

        if (this.dockUI && this.dockUI.queueRender) {
            this.dockUI.queueRender('incremental');
        }
    }

    getFolders() {
        if (this.appManager) {
            return this.appManager.getFolders() || [];
        }
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