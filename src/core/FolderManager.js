/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


export default class FolderManager {
    constructor(settings) {
        this.settings = settings;
        this.folders = this._loadFolders();


        this._settingsSignal = this.settings.connect('changed::app-folders', () => {
            this.folders = this._loadFolders();
        });
    }

    _loadFolders() {
        try {
            const data = this.settings.get_string('app-folders');
            return JSON.parse(data || '[]');
        } catch (e) {
            console.error('[Dhruva] Failed to parse app folders:', e);
            return [];
        }
    }

    _saveFolders() {
        this.settings.set_string('app-folders', JSON.stringify(this.folders));
    }


    createFolder(name = "New Folder", icon = "folder-symbolic") {
        const newFolder = {
            id: 'dhruva-folder-' + Date.now(),
            name: name,
            icon: icon,
            apps: []
        };
        this.folders.push(newFolder);
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
            if (newName) folder.name = newName;
            if (newIcon) folder.icon = newIcon;
            this._saveFolders();
            return true;
        }
        return false;
    }


    deleteFolder(folderId) {
        this.folders = this.folders.filter(f => f.id !== folderId);
        this._saveFolders();
    }

    getFolders() {
        return this.folders;
    }

    destroy() {
        if (this._settingsSignal) {
            this.settings.disconnect(this._settingsSignal);
            this._settingsSignal = null;
        }
    }
}