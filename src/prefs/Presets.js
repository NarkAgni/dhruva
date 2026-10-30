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


const DOUBLE_TOLERANCE = 0.001;

const BASE = {
    'dock-position': 'BOTTOM',
    'full-width': false,
    'icon-alignment': 'CENTER',
    'hybrid-panel-mode': false,
    'dynamic-panel': false,
    'dynamic-panel-position': 'CENTER',
    'icon-size': 32,
    'icon-spacing': 6,
    'dock-height': 8,
    'dock-margin': 0,
    'dock-padding': 0,
    'border-radius': 18,
    'dock-theme': 'default',
    'background-opacity': 75,
    'blur-enabled': false,
    'show-running-indicators': true,
    'indicator-style': 'dot',
    'indicator-glow': false,
    'hover-zoom': false,
    'hover-zoom-style': 'fluid',
    'hover-zoom-factor': 2.0,
    'hover-animation': false,
    'click-effect': 'none',
    'minimize-effect': 'none',
    'hide-mode': 'none',
    'show-apps-preview': false,
    'peek-effect': false,
    'show-grid-button': true,
    'grid-button-position': 'START',
    'show-desktop-button': false,
    'show-music-pill': false,
    'start-menu': true,
};

const ACTIVE_PRESET_KEY = 'active-preset';

export const PRESETS = () => [
    {
        id: 'fresh',
        name: _('Fresh Start'),
        description: _('A plain dock with only running dots. Set it up your own way'),
        values: {},
    },
    {
        id: 'gnome',
        name: _('GNOME Classic+'),
        description: _('Looks like the GNOME dash, with nothing extra'),
        values: {
            'icon-size': 44,
            'dock-margin': 8,
            'border-radius': 22,
            'grid-button-position': 'END',
        },
    },
    {
        id: 'macos',
        name: _('macOS Dock'),
        description: _('A light dock that magnifies under the pointer and bounces on click'),
        values: {
            'icon-size': 48,
            'dock-margin': 6,
            'border-radius': 20,
            'dock-theme': 'ash',
            'hover-zoom': true,
            'hover-zoom-factor': 1.6,
            'click-effect': 'bounce',
            'minimize-effect': 'magic-lamp',
            'hide-mode': 'intelligent',
        },
    },
    {
        id: 'windows11',
        name: _('Windows 11 Taskbar'),
        description: _('One dark bar with centered apps, start menu, tray and clock'),
        values: {
            'hybrid-panel-mode': true,
            'icon-size': 28,
            'dock-theme': 'carbon',
            'background-opacity': 90,
            'indicator-style': 'windows',
            'show-apps-preview': true,
            'peek-effect': true,
            'show-desktop-button': true,
        },
    },
    {
        id: 'classic',
        name: _('Classic Taskbar'),
        description: _('A solid edge-to-edge bar with apps starting on the left'),
        values: {
            'full-width': true,
            'icon-alignment': 'START',
            'icon-size': 30,
            'border-radius': 0,
            'dock-theme': 'carbon',
            'background-opacity': 95,
            'indicator-style': 'line',
            'show-apps-preview': true,
        },
    },
    {
        id: 'island',
        name: _('Floating Island'),
        description: _('A compact panel that floats in the middle above your windows'),
        values: {
            'hybrid-panel-mode': true,
            'dynamic-panel': true,
            'icon-size': 28,
            'border-radius': 22,
            'dock-theme': 'carbon',
            'background-opacity': 85,
            'indicator-style': 'dash',
            'show-music-pill': true,
        },
    },
    {
        id: 'ubuntu',
        name: _('Ubuntu Dock'),
        description: _('A full-height dock fixed to the left side of the screen'),
        values: {
            'dock-position': 'LEFT',
            'full-width': true,
            'icon-size': 44,
            'border-radius': 0,
            'dock-theme': 'carbon',
            'background-opacity': 70,
            'grid-button-position': 'END',
        },
    },
    {
        id: 'minimal',
        name: _('Minimal'),
        description: _('Small icons and nothing else'),
        values: {
            'icon-size': 28,
            'icon-spacing': 4,
            'dock-height': 6,
            'dock-margin': 8,
            'border-radius': 14,
            'show-grid-button': false,
        },
    },
    {
        id: 'showcase',
        name: _('Showcase'),
        description: _('Every effect turned up, with colours from your wallpaper'),
        values: {
            'icon-size': 46,
            'dock-margin': 10,
            'border-radius': 24,
            'dock-theme': 'chameleon',
            'indicator-glow': true,
            'hover-zoom': true,
            'hover-zoom-style': 'coverflow',
            'click-effect': 'jelly',
            'minimize-effect': 'jelly',
            'show-apps-preview': true,
            'peek-effect': true,
            'show-music-pill': true,
        },
    },
];

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