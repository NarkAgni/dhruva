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
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { PRESET_BASE, presetList } from './PresetData.js';


const BASE = PRESET_BASE;
const DOUBLE_TOLERANCE = 0.001;

const ACTIVE_PRESET_KEY = 'active-preset';

export const PRESETS = () => presetList(_);

export const PRESET_KEYS = Object.keys(BASE);

function keyType(settings, key) {
    return settings.settings_schema.get_key(key).get_value_type().dup_string();
}

export function presetValues(settings, preset) {
    const values = {};
    for (const [key, value] of Object.entries({ ...BASE, ...preset.values })) {
        if (settings.settings_schema.has_key(key)) values[key] = value;
    }
    return values;
}

export function readValue(settings, key) {
    switch (keyType(settings, key)) {
        case 'b': return settings.get_boolean(key);
        case 'i': return settings.get_int(key);
        case 'd': return settings.get_double(key);
        default: return settings.get_string(key);
    }
}

function writeValue(settings, key, value) {
    switch (keyType(settings, key)) {
        case 'b': settings.set_boolean(key, value); break;
        case 'i': settings.set_int(key, value); break;
        case 'd': settings.set_double(key, value); break;
        default: settings.set_string(key, value);
    }
}

function sameValue(a, b) {
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) < DOUBLE_TOLERANCE : a === b;
}

export function applyValues(settings, values, presetId) {
    const batch = new Gio.Settings({ settings_schema: settings.settings_schema });
    batch.delay();
    for (const [key, value] of Object.entries(values)) {
        if (!sameValue(readValue(settings, key), value)) writeValue(batch, key, value);
    }
    batch.set_string(ACTIVE_PRESET_KEY, presetId);
    batch.apply();
}

export function activePresetId(settings) {
    return settings.get_string(ACTIVE_PRESET_KEY);
}

export function savedPreset(settings) {
    const presets = PRESETS();
    return presets.find(preset => preset.id === activePresetId(settings)) || presets[0];
}

export function isCustomized(settings, preset) {
    return !Object.entries(presetValues(settings, preset)).every(([key, value]) => sameValue(readValue(settings, key), value));
}
