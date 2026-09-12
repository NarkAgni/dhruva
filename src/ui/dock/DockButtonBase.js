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


import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { hexToRgba, setBoxVertical } from '../../core/Utils.js';


const DEFAULT_HOVER_DURATION_MS = 200;

export function createBaseButtonContainer(appBox) {
    const btn = new St.Bin({
        child: appBox,
        style_class: 'dock-app-button',
        reactive: true,
        track_hover: true,
        can_focus: false,
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL
    });
    btn.set_pivot_point(0.5, 0.5);
    btn.set_style('background-color: transparent;');
    return btn;
}

export function createIndicatorBox(dockPosition, isVerticalDock, indPropsGlobal, count, expandedDim) {
    let dotX = Clutter.ActorAlign.CENTER;
    let dotY = Clutter.ActorAlign.CENTER;
    if (dockPosition === 'BOTTOM') dotY = Clutter.ActorAlign.END;
    else if (dockPosition === 'TOP') dotY = Clutter.ActorAlign.START;
    else if (dockPosition === 'LEFT') dotX = Clutter.ActorAlign.START;
    else if (dockPosition === 'RIGHT') dotX = Clutter.ActorAlign.END;

    const dotSize = isVerticalDock ? indPropsGlobal.dh : indPropsGlobal.dw;
    const maxDots = Math.max(1, Math.floor((expandedDim + 4) / (dotSize + 4)));
    const numDots = Math.max(1, Math.min(count, maxDots));

    const dotBox = new St.BoxLayout({
        x_align: dotX,
        y_align: dotY,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: false,
        reactive: false
    });
    setBoxVertical(dotBox, isVerticalDock);
    dotBox._isIndicator = true;
    dotBox._baseTx = indPropsGlobal.tx;
    dotBox._baseTy = indPropsGlobal.ty;
    dotBox.translation_x = indPropsGlobal.tx;
    dotBox.translation_y = indPropsGlobal.ty;
    dotBox.set_style('spacing: 4px;');

    for (let i = 0; i < numDots; i++) {
        const dot = new St.Widget({ reactive: false });
        dot.set_size(indPropsGlobal.dw, indPropsGlobal.dh);
        dot.set_style(indPropsGlobal.style);
        dotBox.add_child(dot);
    }
    return dotBox;
}

export function attachHoverBackground(dockUI, btn, appBox, isIndicatorActive, indPropsGlobal, dims) {
    const { iconSize, pad, expandedDim, collapsedDim, isVerticalDock } = dims;
    const boxOp = dockUI.settings.get_int('tooltip-opacity');
    const baseAlpha = Math.max(0.02, boxOp / 100.0);
    const hoverAlpha = Math.min(1.0, baseAlpha + 0.15);
    const hoverZoom = dockUI.settings.get_boolean('hover-zoom');

    let baseBg = 'transparent';
    if (isIndicatorActive && !hoverZoom) {
        baseBg = hexToRgba(indPropsGlobal.indColor, baseAlpha);
    }

    const isExpanded = isIndicatorActive && !hoverZoom;
    const targetW = isVerticalDock ? iconSize : (isExpanded ? expandedDim : collapsedDim);
    const targetH = isVerticalDock ? (isExpanded ? expandedDim : collapsedDim) : iconSize;

    const hoverBg = new St.Widget({
        reactive: false,
        style: `background-color: ${baseBg}; border-radius: 0px; transition-duration: 150ms;`,
        x_expand: true,
        y_expand: true
    });

    hoverBg.set_pivot_point(0.5, 0.5);
    hoverBg.scale_x = isVerticalDock ? (iconSize + pad * 2) / iconSize : 1.0;
    hoverBg.scale_y = isVerticalDock ? 1.0 : (iconSize + pad * 2) / iconSize;
    hoverBg.set_size(targetW, targetH);
    hoverBg.set_x_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_y_align(Clutter.ActorAlign.CENTER);

    appBox.insert_child_at_index(hoverBg, 0);
    btn._baseBg = baseBg;

    btn.connectObject('notify::hover', () => {
        if (btn.hover) dockUI._hoveredAppButton = btn;
        else if (dockUI._hoveredAppButton === btn) dockUI._hoveredAppButton = null;

        if (dockUI.settings.get_boolean('hover-zoom')) return;

        const expanded = isIndicatorActive || btn.hover;
        const currentDim = expanded ? expandedDim : collapsedDim;

        if (isVerticalDock) {
            hoverBg.ease({ height: currentDim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            hoverBg.ease({ width: currentDim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }

        if (btn.hover) {
            const activeColor = isIndicatorActive
                ? hexToRgba(indPropsGlobal.indColor, hoverAlpha)
                : `rgba(255, 255, 255, ${Math.max(0.05, baseAlpha * 0.4)})`;
            hoverBg.set_style(`background-color: ${activeColor}; border-radius: 0px; transition-duration: 150ms;`);
        } else {
            hoverBg.set_style(`background-color: ${btn._baseBg}; border-radius: 0px; transition-duration: 150ms;`);
        }
    }, btn);
}