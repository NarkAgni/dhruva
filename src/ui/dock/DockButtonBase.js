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

import { Settings } from '../../core/SettingsManager.js';
import { hexToRgba, setBoxVertical, isActorAlive } from '../../core/Utils.js';


const DEFAULT_HOVER_DURATION_MS = 200;
const INDICATOR_EASE_MS = 160;
const HOVER_BG_SCALE = 1.12;
const INDICATOR_SIZE_RE = /width:\s*\d+px;\s*height:\s*\d+px;\s*/i;

export function hoverBgStyle(color, radius) {
    const duration = Settings.hoverAnimation ? 150 : 0;
    return 'background-color: ' + color + '; border-radius: ' + radius + 'px; transition-duration: ' + duration + 'ms;';
}

export function setHoverBgLength(hoverBg, isVerticalDock, length) {
    const prop = isVerticalDock ? 'height' : 'width';
    hoverBg.remove_transition(prop);
    if (Settings.hoverAnimation) {
        hoverBg.ease({ [prop]: length, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    } else {
        hoverBg[prop] = length;
    }
}

export function scaleHoverBg(hoverBg) {
    hoverBg.set_scale(HOVER_BG_SCALE, HOVER_BG_SCALE);
    hoverBg._baseScaleX = HOVER_BG_SCALE;
    hoverBg._baseScaleY = HOVER_BG_SCALE;
}

export function getHoverBgRadius(iconSize) {
    return Math.max(6, Math.min(10, Math.round(iconSize * 0.18)));
}

function safeHexToRgba(color, alpha) {
    const safeAlpha = (alpha !== undefined && alpha !== null && !Number.isNaN(alpha)) ? Math.max(0.0, Math.min(1.0, alpha)) : 0.25;
    const safeColor = color || '#ffffff';
    return hexToRgba(safeColor, safeAlpha);
}

export function stripIndicatorSize(style) {
    return (style || '').replace(INDICATOR_SIZE_RE, '');
}

export function getDynamicIndicatorLength(isFocused) {
    const iconSize = Settings.iconSize || 48;
    const activeLen = Math.min(iconSize - 4, Math.max(22, Math.floor(iconSize * 0.52)));
    const inactiveLen = Math.max(12, Math.floor(activeLen * 0.45));
    return isFocused ? activeLen : inactiveLen;
}

export function syncDynamicIndicator(dotBox, indProps, isVerticalDock, isFocused) {
    const length = getDynamicIndicatorLength(isFocused);
    const style = stripIndicatorSize(indProps.style);
    dotBox.get_children().forEach(dot => {
        dot.set_style(style);
        dot.remove_all_transitions();
        if (isVerticalDock) {
            dot.width = indProps.dw;
            dot.ease({ height: length, duration: INDICATOR_EASE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            dot.height = indProps.dh;
            dot.ease({ width: length, duration: INDICATOR_EASE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }
    });
}

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

export function createIndicatorBox(dockPosition, isVerticalDock, indProps, count, expandedDim, isFocused = false) {
    let dotX = Clutter.ActorAlign.CENTER;
    let dotY = Clutter.ActorAlign.CENTER;
    if (dockPosition === 'BOTTOM') dotY = Clutter.ActorAlign.END;
    else if (dockPosition === 'TOP') dotY = Clutter.ActorAlign.START;
    else if (dockPosition === 'LEFT') dotX = Clutter.ActorAlign.START;
    else if (dockPosition === 'RIGHT') dotX = Clutter.ActorAlign.END;

    const indStyle = Settings.indicatorStyle || 'dot';
    let dw = indProps.dw;
    let dh = indProps.dh;

    if (indStyle === 'windows') {
        const len = getDynamicIndicatorLength(isFocused);
        if (isVerticalDock) {
            dh = len;
        } else {
            dw = len;
        }
    }

    const dotSize = isVerticalDock ? dh : dw;
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
    dotBox._baseTx = indProps.tx;
    dotBox._baseTy = indProps.ty;
    dotBox.translation_x = indProps.tx;
    dotBox.translation_y = indProps.ty;
    dotBox.set_style('spacing: 4px;');

    const cleanStyle = stripIndicatorSize(indProps.style);
    for (let i = 0; i < numDots; i++) {
        const dot = new St.Widget({ reactive: false });
        dot.set_size(dw, dh);
        dot.set_style(cleanStyle);
        dotBox.add_child(dot);
    }
    return dotBox;
}

export function attachHoverBackground(dockUI, btn, appBox, isIndicatorActive, indProps, dims) {
    const { iconSize, isVerticalDock } = dims;

    const compactExpanded = iconSize + 4;
    const compactCollapsed = iconSize;
    const tightCross = iconSize + 4;

    const rawOp = Settings.tooltipOpacity;
    const boxOp = (rawOp !== undefined && rawOp !== null && !Number.isNaN(rawOp)) ? rawOp : 25;
    const baseAlpha = Math.max(0.20, Math.min(0.80, boxOp / 100.0));
    const hoverAlpha = Math.min(1.0, baseAlpha + 0.20);
    const hoverZoom = Boolean(Settings.hoverZoom);
    const radius = getHoverBgRadius(iconSize);

    let baseBg = 'transparent';
    if (isIndicatorActive && !hoverZoom) {
        baseBg = safeHexToRgba(indProps ? indProps.indColor : '#ffffff', baseAlpha);
    }

    const isExpanded = isIndicatorActive && !hoverZoom;
    const currentDim = isExpanded ? compactExpanded : compactCollapsed;

    const targetW = isVerticalDock ? tightCross : currentDim;
    const targetH = isVerticalDock ? currentDim : tightCross;

    const hoverBg = new St.Widget({
        style_class: 'dock-hover-bg',
        reactive: false,
        clip_to_allocation: false
    });

    hoverBg._isHoverBg = true;
    hoverBg.set_pivot_point(0.5, 0.5);
    scaleHoverBg(hoverBg);
    hoverBg.set_size(targetW, targetH);
    hoverBg.set_x_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_y_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_style(hoverBgStyle(baseBg, radius));

    appBox.insert_child_at_index(hoverBg, 0);

    btn._baseBg = baseBg;
    btn._hoverBg = hoverBg;
    btn._indProps = indProps;
    btn._compactExpanded = compactExpanded;
    btn._compactCollapsed = compactCollapsed;
    btn._tightCross = tightCross;

    btn.connectObject('notify::hover', () => {
        if (btn.hover) dockUI._hoveredAppButton = btn;
        else if (dockUI._hoveredAppButton === btn) dockUI._hoveredAppButton = null;

        if (Settings.hoverZoom) return;

        if (Settings.hoverAnimation) {
            setHoverBgLength(hoverBg, isVerticalDock, (btn._hasRunningIndicator || btn.hover) ? btn._compactExpanded : btn._compactCollapsed);
        }

        const activeIndProps = btn._indProps || indProps;
        const curRadius = getHoverBgRadius(iconSize);

        if (btn.hover) {
            const activeColor = btn._hasRunningIndicator
                ? safeHexToRgba(activeIndProps ? activeIndProps.indColor : '#ffffff', hoverAlpha)
                : 'rgba(255, 255, 255, ' + Math.max(0.18, baseAlpha * 0.70) + ')';
            hoverBg.set_style(hoverBgStyle(activeColor, curRadius));
        } else {
            hoverBg.set_style(hoverBgStyle(btn._baseBg, curRadius));
        }
    }, btn);
}

attachHoverBackground.updateState = function (btn, isRunning, windows = [], indProps, dockUI, isFocused = false) {
    if (!btn || !isActorAlive(btn)) return;

    const showIndicators = Settings.showRunningIndicators;
    const hoverZoom = Boolean(Settings.hoverZoom);
    const isIndicatorActive = isRunning && showIndicators;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const indStyle = Settings.indicatorStyle || 'dot';

    btn._hasRunningIndicator = isIndicatorActive;
    btn._indProps = indProps;

    const appBox = btn._appBox || btn.get_child();
    if (!appBox || !isActorAlive(appBox)) return;

    const dims = btn._dims || {
        iconSize: Settings.iconSize,
        pad: Math.max(Settings.dockHeight || 6, 4),
        expandedDim: (Settings.iconSize || 48) + 4,
        collapsedDim: Settings.iconSize || 48,
        isVerticalDock
    };

    const compactExpanded = dims.iconSize + 4;
    const compactCollapsed = dims.iconSize;
    const tightCross = dims.iconSize + 4;

    btn._compactExpanded = compactExpanded;
    btn._compactCollapsed = compactCollapsed;
    btn._tightCross = tightCross;

    if (isIndicatorActive && indStyle === 'windows' && btn._indicatorActor && isActorAlive(btn._indicatorActor)) {
        syncDynamicIndicator(btn._indicatorActor, indProps, isVerticalDock, isFocused);
    } else {
        if (btn._indicatorActor && isActorAlive(btn._indicatorActor)) {
            appBox.remove_child(btn._indicatorActor);
            btn._indicatorActor.destroy();
            btn._indicatorActor = null;
        }

        if (isIndicatorActive) {
            const count = (indStyle === 'line' || indStyle === 'windows') ? 1 : Math.max(1, windows.length);
            const dotBox = createIndicatorBox(dockUI.dockPosition, isVerticalDock, indProps, count, compactExpanded, isFocused);
            appBox.add_child(dotBox);
            btn._indicatorActor = dotBox;
        }
    }

    const rawOp = Settings.tooltipOpacity;
    const boxOp = (rawOp !== undefined && rawOp !== null && !Number.isNaN(rawOp)) ? rawOp : 25;
    const baseAlpha = Math.max(0.20, Math.min(0.80, boxOp / 100.0));
    let baseBg = 'transparent';
    if (isIndicatorActive && !hoverZoom) {
        baseBg = safeHexToRgba(indProps ? indProps.indColor : '#ffffff', baseAlpha);
    }
    btn._baseBg = baseBg;

    if (btn._hoverBg && isActorAlive(btn._hoverBg)) {
        const curRadius = getHoverBgRadius(dims.iconSize);

        if (isVerticalDock) {
            btn._hoverBg.width = tightCross;
        } else {
            btn._hoverBg.height = tightCross;
        }

        if (!btn.hover) {
            btn._hoverBg.set_style(hoverBgStyle(baseBg, curRadius));
        }
        if (!hoverZoom) {
            const isHoverExpanded = btn.hover && Settings.hoverAnimation;
            setHoverBgLength(btn._hoverBg, isVerticalDock, (isIndicatorActive || isHoverExpanded) ? compactExpanded : compactCollapsed);
        }
    }
};