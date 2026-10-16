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


const UUID = 'dhruva@narkagni';
const USER_DIRS = ['icon', 'folder_icons', 'blur_bg'];
const PATH_KEYS = ['custom-grid-icon', 'blur-custom-photo', 'custom-folders', 'app-folders'];
const LEGACY_CACHE_NAME = 'dhruva-music-art';
const LYRICS_FILE = 'lyrics_cache.json';

export function userDataDir(name) {
    return GLib.build_filenamev([GLib.get_user_data_dir(), UUID, name]);
}

export function userCacheDir(name = '') {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), UUID, name]);
}

export function lyricsCachePath() {
    return GLib.build_filenamev([userCacheDir(), LYRICS_FILE]);
}

function move(from, to) {
    if (!GLib.file_test(from, GLib.FileTest.EXISTS) || GLib.file_test(to, GLib.FileTest.EXISTS)) return false;

    GLib.mkdir_with_parents(GLib.path_get_dirname(to), 0o755);
    try {
        return Gio.File.new_for_path(from).move(Gio.File.new_for_path(to), Gio.FileCopyFlags.NONE, null, null);
    } catch (e) {
        console.warn(`[Dhruva] Could not move ${from}:`, e);
        return false;
    }
}

function rewrite(text, replacements) {
    return replacements.reduce((result, [from, to]) => result.split(from).join(to), text);
}

function rewriteConfigFiles(configDir, replacements) {
    const dir = Gio.File.new_for_path(configDir);
    if (!dir.query_exists(null)) return;

    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        const name = info.get_name();
        if (!name.endsWith('.json')) continue;

        const path = GLib.build_filenamev([configDir, name]);
        const [, contents] = GLib.file_get_contents(path);
        const text = new TextDecoder().decode(contents);
        const updated = rewrite(text, replacements);
        if (updated !== text) GLib.file_set_contents(path, updated);
    }
    enumerator.close(null);
}

export function migrateLegacyPaths(settings) {
    const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), UUID]);
    const replacements = [];

    for (const name of USER_DIRS) {
        const from = GLib.build_filenamev([configDir, name]);
        const to = userDataDir(name);
        if (move(from, to)) replacements.push([`${from}/`, `${to}/`]);
    }

    const legacyCache = GLib.build_filenamev([GLib.get_user_cache_dir(), LEGACY_CACHE_NAME]);
    if (move(legacyCache, userCacheDir('music-art')))
        move(GLib.build_filenamev([userCacheDir('music-art'), LYRICS_FILE]), lyricsCachePath());

    if (replacements.length === 0) return;

    for (const key of PATH_KEYS) {
        const value = settings.get_string(key);
        const updated = rewrite(value, replacements);
        if (updated !== value) settings.set_string(key, updated);
    }

    try {
        rewriteConfigFiles(configDir, replacements);
    } catch (e) {
        console.warn('[Dhruva] Could not update saved icon paths:', e);
    }
}