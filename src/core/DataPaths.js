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
    return GLib.rename(from, to) === 0;
}

function rewrite(text, replacements) {
    return replacements.reduce((result, [from, to]) => result.split(from).join(to), text);
}

function rewriteFileAsync(file, replacements, cancellable) {
    file.load_contents_async(cancellable, (obj, res) => {
        try {
            const [success, contents] = obj.load_contents_finish(res);
            if (!success || !contents) return;

            const text = new TextDecoder('utf-8').decode(contents);
            const updated = rewrite(text, replacements);
            if (updated === text) return;

            const bytes = new GLib.Bytes(new TextEncoder().encode(updated));
            obj.replace_contents_bytes_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                cancellable,
                (writeObj, writeRes) => {
                    try {
                        writeObj.replace_contents_finish(writeRes);
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            console.error(`[Dhruva] Failed to write migrated config: ${e.message}`);
                        }
                    }
                }
            );
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
                !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.error(`[Dhruva] Failed to read config for migration: ${e.message}`);
            }
        }
    });
}

function rewriteConfigFiles(configDir, replacements, cancellable = null) {
    const dir = Gio.File.new_for_path(configDir);

    dir.enumerate_children_async(
        'standard::name',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        cancellable,
        (dirObj, res) => {
            let enumerator;
            try {
                enumerator = dirObj.enumerate_children_finish(res);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
                    !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    console.error(`[Dhruva] Failed to enumerate config dir: ${e.message}`);
                }
                return;
            }

            const processNextBatch = () => {
                enumerator.next_files_async(20, GLib.PRIORITY_DEFAULT, cancellable, (enumObj, nextRes) => {
                    let infos;
                    try {
                        infos = enumObj.next_files_finish(nextRes);
                    } catch (e) {
                        enumObj.close_async(GLib.PRIORITY_DEFAULT, null, null);
                        return;
                    }

                    if (!infos || infos.length === 0) {
                        enumObj.close_async(GLib.PRIORITY_DEFAULT, null, null);
                        return;
                    }

                    for (const info of infos) {
                        const name = info.get_name();
                        if (!name.endsWith('.json')) continue;

                        const path = GLib.build_filenamev([configDir, name]);
                        rewriteFileAsync(Gio.File.new_for_path(path), replacements, cancellable);
                    }

                    processNextBatch();
                });
            };

            processNextBatch();
        }
    );
}

export function migrateLegacyPaths(settings, cancellable = null) {
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

    rewriteConfigFiles(configDir, replacements, cancellable);
}