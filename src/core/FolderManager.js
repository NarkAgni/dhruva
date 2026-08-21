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


export default class FolderManager {
    constructor(settings, uuid) {
        this.settings = settings;
        this.uuid = uuid || 'dhruva@narkagni'; 
        
        this.extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), this.uuid]);
        this.dbPath = GLib.build_filenamev([this.extConfigDir, 'dhruva-folders.json']);

        this.folders = [];
        this._loadFoldersAsync();

        this.settings.connectObject('changed::app-folders', () => {
            if (!this.isIndependent()) {
                this._loadFoldersAsync();
            }
        }, this);

        this.settings.connectObject('changed::independent-dock', () => {
            this._loadFoldersAsync();
        }, this);
    }

    isIndependent() {
        return this.settings.get_boolean('independent-dock');
    }

    onStateChanged(callback) {
        this._onStateChangedCallback = callback;
    }

    _loadFoldersAsync() {
        if (this.isIndependent()) {
            const file = Gio.File.new_for_path(this.dbPath);
            file.load_contents_async(null, (obj, res) => {
                try {
                    let [success, contents] = obj.load_contents_finish(res);
                    if (success) {
                        const decoder = new TextDecoder('utf-8');
                        const parsed = JSON.parse(decoder.decode(contents));
                        this.folders = Array.isArray(parsed) ? parsed : [];
                    } else {
                        this.folders = [];
                    }
                } catch (e) {
                    this.folders = [];
                }
                
                if (this._onStateChangedCallback) {
                    this._onStateChangedCallback();
                }
            });
        } else {
            const data = this.settings.get_string('app-folders');
            try {
                this.folders = JSON.parse(data || '[]');
            } catch (e) {
                this.folders = [];
            }
            if (this._onStateChangedCallback) {
                this._onStateChangedCallback();
            }
        }
    }

    _saveFolders() {
        if (this.isIndependent()) {
            GLib.mkdir_with_parents(this.extConfigDir, 0o755);
            const dataStr = JSON.stringify(this.folders, null, 2);
            
            const file = Gio.File.new_for_path(this.dbPath);
            const bytes = new GLib.Bytes(new TextEncoder().encode(dataStr));
            
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (obj, res) => {
                obj.replace_contents_finish(res);
            });
        } else {
            this.settings.set_string('app-folders', JSON.stringify(this.folders));
        }
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
        if (this.settings) {
            this.settings.disconnectObject(this);
        }
    }
}