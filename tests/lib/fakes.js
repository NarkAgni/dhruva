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


import GLib from 'gi://GLib';


const SCHEMA_FILE = 'org.gnome.shell.extensions.dhruva.gschema.xml';
const TYPE_BY_METHOD = {
    boolean: 'b',
    int: 'i',
    double: 'd',
    string: 's',
    strv: 'as',
};

export function projectPath(...parts) {
    const [helperFile] = GLib.filename_from_uri(import.meta.url);
    const testsDir = GLib.path_get_dirname(GLib.path_get_dirname(helperFile));
    return GLib.build_filenamev([GLib.path_get_dirname(testsDir), ...parts]);
}

export function readSchemaKeys() {
    const [, bytes] = GLib.file_get_contents(projectPath('schemas', SCHEMA_FILE));
    const xml = new TextDecoder().decode(bytes);
    const keys = new Map();
    for (const match of xml.matchAll(/<key name="([^"]+)" type="([^"]+)"/g))
        keys.set(match[1], match[2]);
    return keys;
}

export function createFakeSettings(values = {}) {
    const reads = [];
    const settings = { values, reads };

    for (const method of Object.keys(TYPE_BY_METHOD)) {
        settings[`get_${method}`] = key => {
            reads.push({ key, type: TYPE_BY_METHOD[method] });
            if (!(key in values)) throw new Error(`unexpected read of '${key}'`);
            return values[key];
        };
        settings[`set_${method}`] = (key, value) => {
            values[key] = value;
        };
    }

    return settings;
}

export function createRecordingSettings() {
    const reads = [];
    const settings = { reads };
    const sample = { boolean: false, int: 0, double: 0, string: '', strv: [] };

    for (const method of Object.keys(TYPE_BY_METHOD)) {
        settings[`get_${method}`] = key => {
            reads.push({ key, type: TYPE_BY_METHOD[method] });
            return sample[method];
        };
        settings[`set_${method}`] = () => {};
    }

    return settings;
}