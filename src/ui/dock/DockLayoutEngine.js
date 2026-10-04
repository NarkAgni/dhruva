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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../../core/Utils.js';
import { Settings } from '../../core/SettingsManager.js';
import { _flipAnimateDockIcons } from './DockRenderer.js';
import { calculateScale, calculatePivot, calculateBackgroundBounds } from './DockGeometryCalculator.js';


const DEFAULT_BOX_SIZE = 10;
const FALLBACK_PANEL_HEIGHT = 27;

export function updateLayout(dockUI) {
    if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor) || !dockUI.actor.is_mapped()) return;

    if (dockUI._wasDragging && !dockUI.actor._isDragging) {
        dockUI._wasDragging = false;
        if (dockUI.actor._wasRealDrag) {
            dockUI.actor._wasRealDrag = false;
            dockUI.triggerPostDragSettle();
        }
    }
    if (dockUI.actor._isDragging) dockUI._wasDragging = true;

    const isFullWidth = Settings.fullWidth;
    const pos = dockUI.dockPosition;
    const isVertical = pos === 'LEFT' || pos === 'RIGHT';
    const alignment = Settings.iconAlignment || 'CENTER';
    const monitorResult = dockUI.monitorManager.getCurrentMonitor();

    if (!monitorResult || !monitorResult.monitor) return;

    const actualMonitor = monitorResult.monitor;
    const hasPanel = monitorResult.index === Main.layoutManager.primaryIndex && Main.panel && Main.panel.visible;
    const topOffset = hasPanel ? (Main.panel.height || FALLBACK_PANEL_HEIGHT) : 0;

    const stageWidth = global.stage ? global.stage.width : actualMonitor.width;
    const stageHeight = global.stage ? global.stage.height : actualMonitor.height;
    const activeMonWidth = Math.min(actualMonitor.width, stageWidth);
    const activeMonHeight = Math.min(actualMonitor.height, stageHeight);

    const monitor = {
        x: actualMonitor.x,
        y: actualMonitor.y + topOffset,
        width: activeMonWidth,
        height: Math.max(100, activeMonHeight - topOffset)
    };

    let [, boxW] = dockUI.boxActor.get_preferred_width(-1);
    let [, boxH] = dockUI.boxActor.get_preferred_height(-1);
    boxW = boxW || DEFAULT_BOX_SIZE;
    boxH = boxH || DEFAULT_BOX_SIZE;

    let gridW = 0;
    let gridH = 0;
    if (dockUI.gridBtn && dockUI.gridBtn.visible && isFullWidth) {
        [, gridW] = dockUI.gridBtn.get_preferred_width(-1);
        [, gridH] = dockUI.gridBtn.get_preferred_height(-1);
    }

    let clockW = 0;
    let clockH = 0;
    if (dockUI.extractedClock && dockUI.extractedClock.visible && isFullWidth) {
        [, clockW] = dockUI.extractedClock.get_preferred_width(-1);
        [, clockH] = dockUI.extractedClock.get_preferred_height(-1);
    }

    const sWidth = !isFullWidth ? Settings.strokeWidth : 0;
    const hoverZoom = Settings.hoverZoom;
    const iconSize = Settings.iconSize;
    const zoomFactor = hoverZoom ? (Settings.hoverZoomFactor || 1.8) : 1.0;

    const isNeverHide = Settings.hideMode === 'none';
    const edgeMargin = isNeverHide ? Math.max(0, Settings.dockMargin || 0) : 0;

    const baseActorW = isFullWidth ? (isVertical ? Math.max(boxW, gridW) + (sWidth * 2) : monitor.width) : boxW + (sWidth * 2);
    const baseActorH = isFullWidth ? (isVertical ? monitor.height : Math.max(boxH, gridH) + (sWidth * 2)) : boxH + (sWidth * 2);

    const actorW = isVertical ? (baseActorW + edgeMargin) : baseActorW;
    const actorH = isVertical ? baseActorH : (baseActorH + edgeMargin);

    dockUI.actor.set_size(actorW, actorH);

    let contentW = boxW + (sWidth * 2);
    let contentH = boxH + (sWidth * 2);

    if (isFullWidth) {
        if (dockUI.gridBtn && dockUI.gridBtn.visible) {
            contentW += gridW + 30;
            contentH += gridH + 30;
        }
        if (dockUI.extractedClock && dockUI.extractedClock.visible) {
            contentW += clockW + 30;
            contentH += clockH + 30;
        }
    }

    const availableSpace = isVertical ? monitor.height : monitor.width;
    const baseContentSize = isVertical ? contentH : contentW;

    const scale = calculateScale(isVertical, baseContentSize, zoomFactor, iconSize, availableSpace);
    const { pivotX, pivotY } = calculatePivot(pos, isFullWidth, isVertical, alignment);

    dockUI.actor.set_pivot_point(pivotX, pivotY);
    dockUI.actor.set_scale(scale, scale);

    let { bgX, bgY, bgW, bgH } = calculateBackgroundBounds(
        isFullWidth, isVertical, pos, scale, sWidth, boxW, boxH, monitor, pivotX, pivotY, baseActorW, baseActorH
    );

    if (isNeverHide && edgeMargin > 0) {
        if (pos === 'BOTTOM') {
            bgY = (actorH - bgH) - edgeMargin;
        } else if (pos === 'TOP') {
            bgY = edgeMargin;
        } else if (pos === 'LEFT') {
            bgX = edgeMargin;
        } else if (pos === 'RIGHT') {
            bgX = (actorW - bgW) - edgeMargin;
        }
    }

    const padScale = 10 / scale;

    if (isFullWidth && dockUI.gridBtn && dockUI.gridBtn.visible) {
        const gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + padScale;
        const gy = isVertical ? bgY + padScale : bgY + (bgH - gridH) / 2;
        dockUI.gridBtn.set_position(gx, gy);
    }

    let cx = 0;
    let cy = 0;
    let rightOffset = 0;
    let bottomOffset = 0;

    if (isFullWidth && dockUI.extractedDesktop && dockUI.extractedDesktop.visible) {
        const deskBtnWidth = Settings.desktopBtnWidth;
        const dWidth = isVertical ? bgW : deskBtnWidth;
        const dHeight = isVertical ? deskBtnWidth : bgH;

        dockUI.extractedDesktop.set_size(dWidth, dHeight);
        const dx = isVertical ? bgX : bgX + bgW - dWidth;
        const dy = isVertical ? bgY + bgH - dHeight : bgY;

        dockUI.extractedDesktop.set_position(dx, dy);
        rightOffset = isVertical ? 0 : dWidth;
        bottomOffset = isVertical ? dHeight : 0;
    }

    if (isFullWidth && dockUI.extractedClock && dockUI.extractedClock.visible) {
        cx = isVertical ? bgX + (bgW - clockW) / 2 : bgX + bgW - clockW - rightOffset - 4;
        cy = isVertical ? bgY + bgH - clockH - bottomOffset - 4 : bgY + (bgH - clockH) / 2;
        dockUI.extractedClock.set_position(cx, cy);
    }

    let contentX = sWidth;
    let contentY = sWidth;
    const safetyGap = 40 / scale;

    if (!isVertical) {
        if (isFullWidth) {
            if (alignment === 'START') contentX = bgX + padScale;
            else if (alignment === 'END') contentX = bgX + bgW - boxW - padScale;
            else contentX = bgX + (bgW - boxW) / 2;
        } else {
            contentX = bgX + (bgW - boxW) / 2;
        }
        contentY = bgY + (bgH - boxH) / 2;
    } else {
        if (isFullWidth) {
            if (alignment === 'START') contentY = bgY + padScale;
            else if (alignment === 'END') contentY = bgY + bgH - boxH - padScale;
            else contentY = bgY + (bgH - boxH) / 2;
        } else {
            contentY = bgY + (bgH - boxH) / 2;
        }
        contentX = bgX + (bgW - boxW) / 2;
    }

    if (isFullWidth && dockUI.gridBtn && dockUI.gridBtn.visible) {
        if (!isVertical) {
            const gridRight = (bgX + padScale) + gridW + safetyGap;
            const boxLeft = contentX;
            if (boxLeft < gridRight) contentX += (gridRight - boxLeft);
        } else {
            const gridBottom = (bgY + padScale) + gridH + safetyGap;
            const boxTop = contentY;
            if (boxTop < gridBottom) contentY += (gridBottom - boxTop);
        }
    }

    if (isFullWidth && dockUI.extractedClock && dockUI.extractedClock.visible) {
        if (!isVertical) {
            const clockLeft = cx - safetyGap;
            const boxRight = contentX + boxW;
            if (boxRight > clockLeft) contentX -= (boxRight - clockLeft);
        } else {
            const clockTop = cy - safetyGap;
            const boxBottom = contentY + boxH;
            if (boxBottom > clockTop) contentY -= (boxBottom - clockTop);
        }
    }

    dockUI.boxActor.set_position(contentX, contentY);
    dockUI.actor._isFullWidth = isFullWidth;
    dockUI.bgActor._baseW = bgW;
    dockUI.bgActor._baseH = bgH;
    dockUI.bgActor.set_position(bgX, bgY);
    dockUI.bgActor.set_size(bgW, bgH);

    if (dockUI._syncBlurGeometry) {
        dockUI._syncBlurGeometry();
    }

    if (dockUI.dockManager) {
        dockUI.dockManager.updatePosition();
    }

    if (dockUI.actor._fixedSlots && !dockUI.actor._isDragging) {
        dockUI.actor._fixedSlots = null;
    }

    dockUI.actor._cachedW = actorW;
    dockUI.actor._cachedH = actorH;

    if (dockUI._preRenderPositions && dockUI._preRenderPositions.size > 0) {
        _flipAnimateDockIcons(dockUI, dockUI._preRenderPositions);
        dockUI._preRenderPositions.clear();
    }
}