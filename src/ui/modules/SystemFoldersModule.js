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


export function buildSystemFoldersModule(dockUI, _iconSize, createBtn, toggleAppWindow) {
    const systemModules = [];
    const settings = dockUI.settings;

    if (settings.get_boolean('show-home')) {
        const homeDir = GLib.get_home_dir();
        const homeName = homeDir.split('/').pop();
        const realName = GLib.get_real_name() || '';
        const titles = ['Home', homeName, realName];
        systemModules.push(createBtn('user-home', 'Home', (btn) => toggleAppWindow(`file://${homeDir}`, titles, btn), titles));
    }

    const addHomeFolder = (setting, icon, dirEnum, fallback) => {
        if (settings.get_boolean(setting)) {
            const dirPath = GLib.get_user_special_dir(dirEnum);
            if (dirPath) {
                const file = Gio.File.new_for_path(dirPath);
                const name = file.get_basename();
                const uri = file.get_uri();
                systemModules.push(createBtn(icon, name, (btn) => toggleAppWindow(uri, [name, fallback], btn), [name, fallback]));
            } else {
                const fallbackPath = `${GLib.get_home_dir()}/${fallback}`;
                systemModules.push(createBtn(icon, fallback, (btn) => toggleAppWindow(`file://${fallbackPath}`, [fallback], btn), [fallback]));
            }
        }
    };

    addHomeFolder('show-downloads', 'folder-download', GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'Downloads');
    addHomeFolder('show-documents', 'folder-documents', GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'Documents');
    addHomeFolder('show-pictures', 'folder-pictures', GLib.UserDirectory.DIRECTORY_PICTURES, 'Pictures');
    addHomeFolder('show-videos', 'folder-videos', GLib.UserDirectory.DIRECTORY_VIDEOS, 'Videos');
    addHomeFolder('show-music', 'folder-music', GLib.UserDirectory.DIRECTORY_MUSIC, 'Music');

    if (settings.get_boolean('show-mounts')) {
        const volumeMonitor = Gio.VolumeMonitor.get();
        const mounts = volumeMonitor.get_mounts();
        mounts.forEach(mount => {
            const name = mount.get_name();
            const uri = mount.get_root().get_uri();
            const gicon = mount.get_icon() || Gio.ThemedIcon.new('drive-harddisk-symbolic');

            systemModules.push(createBtn(gicon, name, (btn) => toggleAppWindow(uri, [name], btn), [name]));
        });
    }

    try {
        const customFoldersRaw = settings.get_string('custom-folders');
        if (customFoldersRaw) {
            JSON.parse(customFoldersRaw).forEach(f => {
                const fPath = f.path || '/';
                const fName = f.name || 'Custom Folder';
                const fIcon = f.icon || 'folder-symbolic';
                const uri = fPath.startsWith('file://') || fPath.includes('://') ? fPath : Gio.File.new_for_path(fPath).get_uri();
                systemModules.push(createBtn(fIcon, fName, (btn) => toggleAppWindow(uri, [fName], btn), [fName]));
            });
        }
    } catch (_e) { }

    return systemModules;
}