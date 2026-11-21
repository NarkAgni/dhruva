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

/**
 * Preset data, kept free of GObject-Introspection and gettext imports so it
 * stays unit-testable with plain GJS. Presets.js wraps this list with
 * gettext for the localized names and descriptions.
 */

export const PRESET_BASE = {
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
    'minimized-thumbnails': false,
    'hide-mode': 'none',
    'show-apps-preview': false,
    'peek-effect': false,
    'show-grid-button': true,
    'grid-button-position': 'START',
    'show-desktop-button': false,
    'show-music-pill': false,
    'start-menu': true,
};

export const presetList = (translate = s => s) => [
    {
        id: 'fresh',
        name: translate('Fresh Start'),
        description: translate('A plain dock with only running dots. Set it up your own way'),
        values: {},
    },
    {
        id: 'gnome',
        name: translate('GNOME Classic+'),
        description: translate('Looks like the GNOME dash, with nothing extra'),
        values: {
            'icon-size': 44,
            'dock-margin': 8,
            'border-radius': 22,
            'grid-button-position': 'END',
        },
    },
    {
        id: 'macos',
        name: translate('macOS Dock'),
        description: translate('A light dock that magnifies under the pointer and bounces on click'),
        values: {
            'icon-size': 48,
            'dock-margin': 6,
            'border-radius': 20,
            'dock-theme': 'ash',
            'hover-zoom': true,
            'hover-zoom-factor': 1.6,
            'click-effect': 'bounce',
            'minimize-effect': 'magic-lamp',
            'minimized-thumbnails': true,
            'hide-mode': 'intelligent',
            'indicator-color-mode': 'dominant',
        },
    },
    {
        id: 'windows11',
        name: translate('Windows 11 Taskbar'),
        description: translate('One dark bar with centered apps, start menu, tray and clock'),
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
        name: translate('Classic Taskbar'),
        description: translate('A solid edge-to-edge bar with apps starting on the left'),
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
        name: translate('Floating Island'),
        description: translate('A compact panel that floats in the middle above your windows'),
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
        name: translate('Ubuntu Dock'),
        description: translate('A full-height dock fixed to the left side of the screen'),
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
        name: translate('Minimal'),
        description: translate('Small icons and nothing else'),
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
        name: translate('Showcase'),
        description: translate('Every effect turned up, with colours from your wallpaper'),
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
