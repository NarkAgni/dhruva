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


let folderIdCounter = 0;

export default class FolderManager {
    constructor(appManager) {
        this.appManager = appManager;
    }

    addStateListener(callback) {
        this.appManager.addStateListener(callback);
    }

    removeStateListener(callback) {
        this.appManager.removeStateListener(callback);
    }

    getFolders() {
        return this.appManager.getFolders();
    }

    saveFolders() {
        this._save(this.getFolders());
    }

    _save(folders) {
        this.appManager.saveFolders(folders);
        this.appManager.notifyStateChanged();
    }

    _findFolder(folderId) {
        return this.getFolders().find(f => f.id === folderId);
    }

    _getUniqueFolderName(requestedName) {
        const baseName = (requestedName && requestedName.trim()) ? requestedName.trim() : _('New Folder');
        const existingNames = new Set(this.getFolders().map(f => {
            if (!f.name) return '';
            return (f.name === 'New Folder' || f.name === 'Новая папка') ? _('New Folder') : f.name.trim();
        }));

        if (!existingNames.has(baseName)) return baseName;

        let counter = 2;
        while (existingNames.has(`${baseName} ${counter}`)) counter++;
        return `${baseName} ${counter}`;
    }

    createFolder(name = _('New Folder'), icon = 'folder', anchorAppId = null) {
        folderIdCounter += 1;
        const id = `dhruva-folder-${Date.now()}-${folderIdCounter}`;
        const folderKey = `folder:${id}`;

        const order = this.appManager.getDockOrder().filter(key => key !== folderKey);
        const anchorIndex = anchorAppId ? order.indexOf(anchorAppId) : -1;
        if (anchorIndex !== -1) order.splice(anchorIndex, 0, folderKey);
        else order.push(folderKey);
        this.appManager.saveDockOrder(order);

        this._save([...this.getFolders(), {
            id,
            name: this._getUniqueFolderName(name),
            icon,
            apps: []
        }]);
        return id;
    }

    addAppToFolder(folderId, appId) {
        const folder = this._findFolder(folderId);
        if (!folder || folder.apps.includes(appId)) return false;

        folder.apps.push(appId);

        const folderKey = `folder:${folderId}`;
        const prevOrder = this.appManager.dockOrder;
        const nextOrder = prevOrder.filter(key => key !== appId);
        if (!nextOrder.includes(folderKey)) {
            const prevIdx = prevOrder.indexOf(appId);
            if (prevIdx !== -1) nextOrder.splice(prevIdx, 0, folderKey);
            else nextOrder.push(folderKey);
        }
        this.appManager.saveDockOrder(nextOrder);

        this._save(this.getFolders());
        return true;
    }

    removeAppFromFolder(folderId, appId) {
        const folders = this.getFolders();
        const folder = folders.find(f => f.id === folderId);
        if (!folder) return false;

        const folderKey = `folder:${folderId}`;
        const currentOrder = [...this.appManager.getDockOrder()];
        const folderIdx = currentOrder.indexOf(folderKey);

        folder.apps = folder.apps.filter(id => id !== appId);

        if (folder.apps.length <= 1) {
            const restored = [folder.apps[0], appId].filter(Boolean);
            const nextOrder = currentOrder.filter(key => key !== folderKey && !restored.includes(key));
            const insertAt = folderIdx !== -1 ? Math.min(folderIdx, nextOrder.length) : nextOrder.length;
            nextOrder.splice(insertAt, 0, ...restored);

            this._save(folders.filter(f => f.id !== folderId));
            restored.forEach(id => this.appManager.addApp(id));
            this.appManager.saveDockOrder(nextOrder);
        } else {
            this._save(folders);
            this.appManager.addApp(appId);

            const nextOrder = currentOrder.filter(key => key !== appId);
            const newFolderIdx = nextOrder.indexOf(folderKey);
            if (newFolderIdx !== -1) nextOrder.splice(newFolderIdx + 1, 0, appId);
            else nextOrder.push(appId);
            this.appManager.saveDockOrder(nextOrder);
        }

        this.appManager.queueRender('full', true);
        return true;
    }

    updateFolder(folderId, newName, newIcon) {
        const folder = this._findFolder(folderId);
        if (!folder) return false;

        if (newName !== undefined) folder.name = newName;
        if (newIcon !== undefined) folder.icon = newIcon === 'folder-symbolic' ? 'folder' : newIcon;

        this._save(this.getFolders());
        this.appManager.queueRender('full', true);
        return true;
    }

    deleteFolder(folderId) {
        const folders = this.getFolders();
        const target = folders.find(f => f.id === folderId);
        const appsToRestore = target ? [...target.apps] : [];

        const folderKey = `folder:${folderId}`;
        const prevOrder = [...this.appManager.getDockOrder()];
        const folderIdx = prevOrder.indexOf(folderKey);
        const nextOrder = prevOrder.filter(key => key !== folderKey && !appsToRestore.includes(key));
        const insertAt = folderIdx !== -1 ? Math.min(folderIdx, nextOrder.length) : nextOrder.length;
        nextOrder.splice(insertAt, 0, ...appsToRestore);

        this._save(folders.filter(f => f.id !== folderId));
        appsToRestore.forEach(appId => this.appManager.addApp(appId));
        this.appManager.saveDockOrder(nextOrder);
    }
}