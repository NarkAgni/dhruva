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


import { hexToRgba } from '../../core/Utils.js';
import { isActorAlive } from './DockLayoutEngine.js';
import { DockThemes, applyDockTheme, extractWallpaperDominantColor, getChameleonAccentColor } from '../Themes.js';


export function resolveTooltipColors(dockUI, themeId) {
    const settings = dockUI.settings;
    const opacity = Math.min(1.0, (settings.get_int('background-opacity') / 100.0) + 0.05);
    const sColor = settings.get_string('stroke-color') || '#ffffff';

    if (themeId === 'chameleon') {
        const { r, g, b } = dockUI._chameleonColor?.bg || { r: 30, g: 30, b: 45 };
        return {
            css: `background-color: rgba(${r}, ${g}, ${b}, ${opacity}); background-gradient-direction: none;`,
            fg: dockUI._chameleonAccent || sColor
        };
    }

    const config = {
        opacity,
        color1: hexToRgba(settings.get_string('background-color') || '#000000', opacity),
        color2: hexToRgba(settings.get_string('background-gradient-color') || '#000000', opacity),
        useGradient: settings.get_boolean('use-gradient'),
        direction: settings.get_string('gradient-direction') || 'vertical',
    };

    const tooltipCss = (DockThemes && DockThemes[themeId]) 
        ? DockThemes[themeId].css(config) 
        : DockThemes['default'].css(config);

    return { css: tooltipCss, fg: sColor };
}

export function applyDynamicStyles(dockUI) {
    if (dockUI._isDestroyed || !isActorAlive(dockUI.actor) || !dockUI.actor.is_mapped()) return;

    const isFullWidth = dockUI.settings.get_boolean('full-width');
    const radius = isFullWidth ? 0 : dockUI.settings.get_int('border-radius');
    const sWidth = dockUI.settings.get_int('stroke-width');
    const borderStyle = sWidth > 0 && !isFullWidth 
        ? `border: ${sWidth}px solid ${hexToRgba(dockUI.settings.get_string('stroke-color'), dockUI.settings.get_int('stroke-opacity') / 100.0)};` 
        : '';

    const baseLayoutCss = `border-radius: ${radius}px; ${borderStyle}`;
    const opacity = dockUI.settings.get_int('background-opacity') / 100.0;
    const currentTheme = dockUI.settings.get_string('dock-theme') || 'default';

    if (currentTheme === 'chameleon' && !dockUI._chameleonColor) {
        const extracted = extractWallpaperDominantColor();
        dockUI._chameleonColor = extracted || { bg: { r: 30, g: 30, b: 45 }, raw: { r: 80, g: 90, b: 120 } };
        dockUI._chameleonAccent = extracted 
            ? getChameleonAccentColor(extracted.raw.r, extracted.raw.g, extracted.raw.b) 
            : '#a0c8ff';
    } else if (currentTheme !== 'chameleon') {
        dockUI._chameleonColor = null;
        dockUI._chameleonAccent = null;
    }

    const customConfig = {
        opacity,
        color1: hexToRgba(dockUI.settings.get_string('background-color'), opacity),
        color2: hexToRgba(dockUI.settings.get_string('background-gradient-color'), opacity),
        useGradient: dockUI.settings.get_boolean('use-gradient'),
        direction: dockUI.settings.get_string('gradient-direction'),
        chameleonColor: dockUI._chameleonColor,
    };

    applyDockTheme(dockUI.bgActor, currentTheme, baseLayoutCss, customConfig);

    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const sidePad = dockUI.settings.get_int('dock-padding');
    const heightPad = dockUI.settings.get_int('dock-height') || 6;
    const safeSidePad = isFullWidth ? sidePad : Math.max(sidePad, Math.ceil(radius * 0.45));
    const safeHeightPad = Math.max(heightPad, 4);

    const boxPad = isFullWidth
        ? (isVertical ? `4px ${safeHeightPad}px` : `${safeHeightPad}px 4px`)
        : (isVertical ? `${safeSidePad}px ${safeHeightPad}px` : `${safeHeightPad}px ${safeSidePad}px`);

    const gap = dockUI.settings.get_int('icon-spacing');
    dockUI.boxActor.set_style(`background-color: transparent; padding: ${boxPad}; spacing: ${gap}px;`);

    const tooltipColors = resolveTooltipColors(dockUI, currentTheme);
    dockUI.actor._tooltipBg = tooltipColors.css;
    dockUI.actor._tooltipFg = tooltipColors.fg;
    dockUI.actor._clockFg = tooltipColors.fg;

    if (isActorAlive(dockUI.boxActor)) {
        dockUI.boxActor.get_children().forEach(c => {
            if (!isActorAlive(c)) return;
            if (typeof c.has_style_class_name === 'function' && c.has_style_class_name('clock-module')) {
                const label = c.get_child?.();
                if (isActorAlive(label)) {
                    const fontSize = dockUI.settings.get_int('clock-font-size') || 15;
                    label.set_style(`color: ${dockUI.actor._clockFg}; font-size: ${fontSize}px; font-weight: 700; text-shadow: 0px 1px 3px rgba(0,0,0,0.7); padding: 0 2px;`);
                }
            }
        });
    }
}