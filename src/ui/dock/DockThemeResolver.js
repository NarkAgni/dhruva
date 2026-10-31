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

import { Settings } from '../../core/SettingsManager.js';
import { isFullBarLayout } from '../../core/LayoutMode.js';
import { hexToRgba, isActorAlive } from '../../core/Utils.js';
import { DockThemes, applyDockTheme, extractWallpaperDominantColor, getChameleonAccentColor } from '../Themes.js';


const DEFAULT_CHAMELEON_BG = { r: 30, g: 30, b: 45 };
const DEFAULT_CHAMELEON_RAW = { r: 80, g: 90, b: 120 };
const DEFAULT_CHAMELEON_ACCENT = '#a0c8ff';

export function cancelChameleonColor(dockUI) {
    if (dockUI._chameleonCancellable) {
        dockUI._chameleonCancellable.cancel();
        dockUI._chameleonCancellable = null;
    }
}

export function refreshChameleonColor(dockUI) {
    cancelChameleonColor(dockUI);
    const cancellable = new Gio.Cancellable();
    dockUI._chameleonCancellable = cancellable;

    extractWallpaperDominantColor(cancellable, extracted => {
        dockUI._chameleonCancellable = null;
        if (!extracted || Settings.dockTheme !== 'chameleon' || !isActorAlive(dockUI.actor)) return;

        dockUI.chameleonColor = extracted;
        dockUI._chameleonAccent = getChameleonAccentColor(extracted.raw.r, extracted.raw.g, extracted.raw.b);
        dockUI.queueRender('full', true);
    });
}

export function resolveTooltipColors(dockUI, themeId, customOpacityPct = null) {
    const rawPct = customOpacityPct !== null ? customOpacityPct : Settings.contextMenuOpacity;
    const opacity = Math.min(1.0, Math.max(0.0, rawPct / 100.0));
    const sColor = Settings.strokeColor || '#ffffff';

    if (themeId === 'chameleon') {
        const bg = (dockUI.chameleonColor && dockUI.chameleonColor.bg) ? dockUI.chameleonColor.bg : DEFAULT_CHAMELEON_BG;
        return {
            css: `background-color: rgba(${bg.r}, ${bg.g}, ${bg.b}, ${opacity}); background-gradient-direction: none;`,
            fg: dockUI._chameleonAccent || sColor
        };
    }

    const config = {
        opacity,
        color1: hexToRgba(Settings.backgroundColor || '#000000', opacity),
        color2: hexToRgba(Settings.backgroundGradientColor || '#000000', opacity),
        useGradient: Settings.useGradient,
        direction: Settings.gradientDirection || 'vertical',
        chameleonColor: dockUI.chameleonColor,
    };

    let tooltipCss = (DockThemes && DockThemes[themeId]) 
        ? DockThemes[themeId].css(config) 
        : DockThemes['default'].css(config);

    return { css: tooltipCss, fg: dockUI._chameleonAccent || sColor };
}

const TRANSPARENT_FILL = 'rgba(0, 0, 0, 0)';

function _firstThemeColor(css) {
    const match = css.match(/background-gradient-start:\s*([^;!]+)/i) || css.match(/background-color:\s*([^;!]+)/i);
    if (!match) return null;
    const color = match[1].trim();
    return color === 'transparent' || color === TRANSPARENT_FILL ? null : color;
}

export function resolvePopupBubbleColors(dockUI) {
    const popupOpacityPct = Settings.contextMenuOpacity;
    const fallbackAlpha = Math.min(1.0, Math.max(0.0, popupOpacityPct / 100.0));

    const fill = Settings.blurEnabled
        ? TRANSPARENT_FILL
        : (_firstThemeColor(resolveTooltipColors(dockUI, Settings.dockTheme, popupOpacityPct).css) ||
           `rgba(24, 24, 31, ${fallbackAlpha})`);

    return {
        fill,
        stroke: hexToRgba(Settings.strokeColor, Settings.strokeOpacity / 100.0),
        strokeWidth: Math.max(1, Settings.strokeWidth),
    };
}

export function applyDynamicStyles(dockUI) {
    if (!isActorAlive(dockUI.actor) || !dockUI.actor.is_mapped()) return;

    const isFullWidth = isFullBarLayout();
    const radius = isFullWidth ? 0 : (dockUI.settings ? dockUI.settings.get_int('border-radius') : 20);
    const isBlurEnabled = dockUI.settings ? dockUI.settings.get_boolean('blur-enabled') : false;

    if (isBlurEnabled) {
        dockUI.bgActor.add_style_class_name('dhruva-blur-active');
        dockUI.bgActor.set_style(
            'border-radius: ' + radius + 'px !important; ' +
            'background-color: transparent !important; ' +
            'background-image: none !important; ' +
            'border: none !important; ' +
            'box-shadow: none !important;'
        );
    } else {
        dockUI.bgActor.remove_style_class_name('dhruva-blur-active');
    }

    const sWidth = Settings.strokeWidth;
    const borderStyle = sWidth > 0 && !isFullWidth 
        ? `border: ${sWidth}px solid ${hexToRgba(Settings.strokeColor, Settings.strokeOpacity / 100.0)};` 
        : '';

    const baseLayoutCss = `border-radius: ${radius}px; ${borderStyle}`;
    const opacity = Settings.backgroundOpacity / 100.0;
    const currentTheme = Settings.dockTheme || 'default';

    if (currentTheme === 'chameleon' && !dockUI.chameleonColor) {
        dockUI.chameleonColor = { bg: DEFAULT_CHAMELEON_BG, raw: DEFAULT_CHAMELEON_RAW };
        dockUI._chameleonAccent = DEFAULT_CHAMELEON_ACCENT;
        refreshChameleonColor(dockUI);
    } else if (currentTheme !== 'chameleon') {
        cancelChameleonColor(dockUI);
        dockUI.chameleonColor = null;
        dockUI._chameleonAccent = null;
    }

    if (!isBlurEnabled) {
        const customConfig = {
            opacity,
            color1: hexToRgba(Settings.backgroundColor, opacity),
            color2: hexToRgba(Settings.backgroundGradientColor, opacity),
            useGradient: Settings.useGradient,
            direction: Settings.gradientDirection,
            chameleonColor: dockUI.chameleonColor,
        };

        applyDockTheme(dockUI.bgActor, currentTheme, baseLayoutCss, customConfig);
    }

    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const sidePad = Settings.dockPadding;
    const heightPad = Settings.dockHeight || 6;
    const safeSidePad = isFullWidth ? sidePad : Math.max(sidePad, Math.ceil(radius * 0.45));
    const safeHeightPad = Math.max(heightPad, 4);

    const boxPad = isFullWidth
        ? (isVertical ? `4px ${safeHeightPad}px` : `${safeHeightPad}px 4px`)
        : (isVertical ? `${safeSidePad}px ${safeHeightPad}px` : `${safeHeightPad}px ${safeSidePad}px`);

    const gap = Settings.iconSpacing;
    dockUI.boxActor.set_style(`background-color: transparent; padding: ${boxPad}; spacing: ${gap}px;`);

    const tooltipColors = resolveTooltipColors(dockUI, currentTheme);
    dockUI.actor._tooltipBg = tooltipColors.css;
    dockUI.actor._tooltipFg = tooltipColors.fg;
    dockUI.actor._clockFg = tooltipColors.fg;

    if (isActorAlive(dockUI.boxActor)) {
        dockUI.boxActor.get_children().forEach(c => {
            if (!isActorAlive(c)) return;
            if (c.has_style_class_name && c.has_style_class_name('clock-module')) {
                const label = c.get_child ? c.get_child() : null;
                if (isActorAlive(label)) {
                    const fontSize = Settings.clockFontSize || 15;
                    label.set_style(`color: ${dockUI.actor._clockFg}; font-size: ${fontSize}px; font-weight: 700; text-shadow: 0px 1px 3px rgba(0,0,0,0.7); padding: 0 2px;`);
                }
            }
        });
    }

    if (isBlurEnabled && dockUI._syncBlurGeometry) {
        dockUI._syncBlurGeometry();
    }
}