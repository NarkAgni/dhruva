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
        const activeLen = Math.min(expandedDim - 8, Math.max(22, Math.floor((Settings.iconSize || 48) * 0.52)));
        const inactiveLen = Math.max(12, Math.floor(activeLen * 0.45));
        const len = isFocused ? activeLen : inactiveLen;
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

    for (let i = 0; i < numDots; i++) {
        const dot = new St.Widget({ reactive: false });
        dot.set_size(dw, dh);
        dot.set_style(indProps.style);
        dotBox.add_child(dot);
    }
    return dotBox;
}

export function attachHoverBackground(dockUI, btn, appBox, isIndicatorActive, indProps, dims) {
    const { iconSize, pad, expandedDim, collapsedDim, isVerticalDock } = dims;
    const boxOp = Settings.tooltipOpacity;
    const baseAlpha = Math.max(0.02, boxOp / 100.0);
    const hoverAlpha = Math.min(1.0, baseAlpha + 0.15);
    const hoverZoom = Settings.hoverZoom;

    let baseBg = 'transparent';
    if (isIndicatorActive && !hoverZoom) {
        baseBg = hexToRgba(indProps.indColor, baseAlpha);
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
    btn._hoverBg = hoverBg;
    btn._indProps = indProps;

    btn.connectObject('notify::hover', () => {
        if (btn.hover) dockUI._hoveredAppButton = btn;
        else if (dockUI._hoveredAppButton === btn) dockUI._hoveredAppButton = null;

        if (Settings.hoverZoom) return;

        const expanded = btn._hasRunningIndicator || btn.hover;
        const currentDim = expanded ? expandedDim : collapsedDim;

        if (isVerticalDock) {
            hoverBg.ease({ height: currentDim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            hoverBg.ease({ width: currentDim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }

        const activeIndProps = btn._indProps || indProps;

        if (btn.hover) {
            const activeColor = btn._hasRunningIndicator
                ? hexToRgba(activeIndProps.indColor, hoverAlpha)
                : `rgba(255, 255, 255, ${Math.max(0.05, baseAlpha * 0.4)})`;
            hoverBg.set_style(`background-color: ${activeColor}; border-radius: 0px; transition-duration: 150ms;`);
        } else {
            hoverBg.set_style(`background-color: ${btn._baseBg}; border-radius: 0px; transition-duration: 150ms;`);
        }
    }, btn);
}

attachHoverBackground.updateState = function (btn, isRunning, windows = [], indProps, dockUI, isFocused = false) {
    if (!btn || !isActorAlive(btn)) return;

    const showIndicators = Settings.showRunningIndicators;
    const hoverZoom = Settings.hoverZoom;
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
        expandedDim: (Settings.iconSize || 48) + (Math.max(Settings.dockHeight || 6, 4) * 2),
        collapsedDim: (Settings.iconSize || 48) + 2,
        isVerticalDock
    };

    if (isIndicatorActive && btn._indicatorActor && isActorAlive(btn._indicatorActor) && indStyle === 'windows') {
        const activeLen = Math.min(dims.expandedDim - 8, Math.max(22, Math.floor((Settings.iconSize || 48) * 0.52)));
        const inactiveLen = Math.max(12, Math.floor(activeLen * 0.45));
        const targetLen = isFocused ? activeLen : inactiveLen;

        const dots = btn._indicatorActor.get_children();
        dots.forEach(dot => {
            if (isActorAlive(dot)) {
                dot.set_style(indProps.style);
                dot.remove_all_transitions();
                if (isVerticalDock) {
                    dot.ease({ height: targetLen, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
                } else {
                    dot.ease({ width: targetLen, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
                }
            }
        });
    } else {
        if (btn._indicatorActor && isActorAlive(btn._indicatorActor)) {
            appBox.remove_child(btn._indicatorActor);
            btn._indicatorActor.destroy();
            btn._indicatorActor = null;
        }

        if (isIndicatorActive) {
            const count = (indStyle === 'line' || indStyle === 'windows') ? 1 : Math.max(1, windows.length);
            const dotBox = createIndicatorBox(dockUI.dockPosition, isVerticalDock, indProps, count, dims.expandedDim, isFocused);
            appBox.add_child(dotBox);
            btn._indicatorActor = dotBox;
        }
    }

    const boxOp = Settings.tooltipOpacity;
    const baseAlpha = Math.max(0.02, boxOp / 100.0);
    let baseBg = 'transparent';
    if (isIndicatorActive && !hoverZoom) {
        baseBg = hexToRgba(indProps.indColor, baseAlpha);
    }
    btn._baseBg = baseBg;

    if (btn._hoverBg && isActorAlive(btn._hoverBg)) {
        if (!btn.hover) {
            btn._hoverBg.set_style(`background-color: ${baseBg}; border-radius: 0px; transition-duration: 150ms;`);
        }
        if (!hoverZoom) {
            const currentDim = (isIndicatorActive || btn.hover) ? dims.expandedDim : dims.collapsedDim;
            if (isVerticalDock) {
                btn._hoverBg.ease({ height: currentDim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            } else {
                btn._hoverBg.ease({ width: currentDim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            }
        }
    }
};