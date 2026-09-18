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
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Settings } from '../../core/SettingsManager.js';


export function buildSystemFoldersModule(dockUI, createBtn, toggleAppWindow) {
    const systemModules = [];
    const settings = dockUI.settings;

    if (Settings.showHome) {
        const homeDir = GLib.get_home_dir();
        systemModules.push(createBtn('user-home', _('Home'), (btn) => toggleAppWindow(`file://${homeDir}`, homeDir, _('Home'), btn), homeDir));
    }

    const addHomeFolder = (setting, icon, dirEnum, localizedName, fallback) => {
        if (settings.get_boolean(setting)) {
            const dirPath = GLib.get_user_special_dir(dirEnum) || `${GLib.get_home_dir()}/${fallback}`;
            const file = Gio.File.new_for_path(dirPath);
            const uri = file.get_uri();
            systemModules.push(createBtn(icon, localizedName, (btn) => toggleAppWindow(uri, dirPath, localizedName, btn), dirPath));
        }
    };

    addHomeFolder('show-downloads', 'folder-download', GLib.UserDirectory.DIRECTORY_DOWNLOAD, _('Downloads'), 'Downloads');
    addHomeFolder('show-documents', 'folder-documents', GLib.UserDirectory.DIRECTORY_DOCUMENTS, _('Documents'), 'Documents');
    addHomeFolder('show-pictures', 'folder-pictures', GLib.UserDirectory.DIRECTORY_PICTURES, _('Pictures'), 'Pictures');
    addHomeFolder('show-videos', 'folder-videos', GLib.UserDirectory.DIRECTORY_VIDEOS, _('Videos'), 'Videos');
    addHomeFolder('show-music', 'folder-music', GLib.UserDirectory.DIRECTORY_MUSIC, _('Music'), 'Music');

    if (Settings.showMounts) {
        const volumeMonitor = Gio.VolumeMonitor.get();
        const mounts = volumeMonitor.get_mounts();
        mounts.forEach(mount => {
            const name = mount.get_name();
            const uri = mount.get_root().get_uri();
            const gicon = mount.get_icon() || Gio.ThemedIcon.new('drive-harddisk-symbolic');
            const rootPath = mount.get_root().get_path() || '';

            systemModules.push(createBtn(gicon, name, (btn) => toggleAppWindow(uri, rootPath, name, btn), rootPath));
        });
    }

    const customFoldersRaw = Settings.customFolders;
    if (customFoldersRaw) {
        try {
            const parsedData = JSON.parse(customFoldersRaw);
            if (Array.isArray(parsedData)) {
                parsedData.forEach(f => {
                    const fPath = f.path || '/';
                    let fName = f.name || _('Custom Folder');
                    if (fName === 'New Folder' || fName === 'Новая папка') {
                        fName = _('New Folder');
                    }
                    const fIcon = f.icon || 'folder';
                    const uri = fPath.startsWith('file://') || fPath.includes('://') ? fPath : Gio.File.new_for_path(fPath).get_uri();

                    systemModules.push(createBtn(fIcon, fName, (btn) => toggleAppWindow(uri, fPath, fName, btn), fPath));
                });
            }
        } catch (_e) { }
    }

    return systemModules;
}