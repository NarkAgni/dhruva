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


const VERSION_KEY = 'settings-version';
const DEFAULTS_KEY = 'settings-defaults';
const INTERNAL_KEYS = [VERSION_KEY, DEFAULTS_KEY];

function readCurrentDefaults(settings) {
    const defaults = {};
    for (const key of settings.settings_schema.list_keys()) {
        if (INTERNAL_KEYS.includes(key)) continue;
        defaults[key] = settings.get_default_value(key).print(true);
    }
    return defaults;
}

function readPreviousDefaults(settings) {
    try {
        return JSON.parse(settings.get_string(DEFAULTS_KEY));
    } catch (_e) {
        return {};
    }
}

function restorePreviousDefault(settings, key, previousValue) {
    const type = new GLib.VariantType(settings.get_default_value(key).get_type_string());
    try {
        settings.set_value(key, GLib.Variant.parse(type, previousValue, null, null));
    } catch (_e) {
        return;
    }
}

export function migrateSettings(settings, version) {
    if (settings.get_string(VERSION_KEY) === version) return;

    const previousDefaults = readPreviousDefaults(settings);
    const currentDefaults = readCurrentDefaults(settings);

    for (const [key, currentValue] of Object.entries(currentDefaults)) {
        if (!(key in previousDefaults) || previousDefaults[key] === currentValue) continue;
        if (settings.get_user_value(key) !== null) continue;
        restorePreviousDefault(settings, key, previousDefaults[key]);
    }

    settings.set_string(DEFAULTS_KEY, JSON.stringify(currentDefaults));
    settings.set_string(VERSION_KEY, version);
}