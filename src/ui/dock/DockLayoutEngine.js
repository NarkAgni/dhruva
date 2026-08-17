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


export function isActorAlive(actor) {
    if (!actor || actor.__destroyed) return false;
    try {
        if (typeof actor.is_destroyed === 'function' && actor.is_destroyed()) return false;
        return actor.visible !== undefined;
    } catch (_e) {
        return false;
    }
}

export function captureActorRect(dockUI, actor, fallbackWin = null) {
    if (isActorAlive(actor)) {
        try {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
                return { x, y, w, h };
        } catch (_e) {}
    }

    if (fallbackWin) {
        try {
            const frameRect = fallbackWin.get_frame_rect();
            if (frameRect) {
                return { x: frameRect.x + frameRect.width / 2 - 0.5, y: frameRect.y + frameRect.height / 2 - 0.5, w: 1, h: 1 };
            }
        } catch (_e) {}
    }

    return { x: 0, y: 0, w: 1, h: 1 };
}

export function updateLayout(dockUI) {
    if (dockUI._isDestroyed || !isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor) || !dockUI.actor.is_mapped()) return;

    if (dockUI._wasDragging && !dockUI.actor._isDragging) {
        dockUI._wasDragging = false;
        if (dockUI.actor._wasRealDrag) {
            dockUI.actor._wasRealDrag = false;
            dockUI.triggerPostDragSettle();
        }
    }
    if (dockUI.actor._isDragging) dockUI._wasDragging = true;

    const isFullWidth = dockUI.settings.get_boolean('full-width');
    const pos = dockUI.settings.get_string('dock-position');
    const isVertical = pos === 'LEFT' || pos === 'RIGHT';
    const gridPos = dockUI.settings.get_string('grid-button-position') || 'END';
    const alignment = dockUI.settings.get_string('icon-alignment') || 'CENTER';
    const monitorResult = dockUI.monitorManager.getCurrentMonitor();
    if (!monitorResult?.monitor) return;

    const actualMonitor = monitorResult.monitor;
    const topOffset = (monitorResult.index === Main.layoutManager.primaryIndex && Main.panel?.visible) 
        ? (Main.panel.height || 27) 
        : 0;

    const monitor = {
        x: actualMonitor.x,
        y: actualMonitor.y + topOffset,
        width: actualMonitor.width,
        height: actualMonitor.height - topOffset
    };

    let [, boxW] = dockUI.boxActor.get_preferred_width(-1);
    let [, boxH] = dockUI.boxActor.get_preferred_height(-1);
    boxW = boxW || 10;
    boxH = boxH || 10;

    let gridW = 0, gridH = 0;
    if (dockUI.gridBtn && dockUI.gridBtn.visible && isFullWidth) {
        [, gridW] = dockUI.gridBtn.get_preferred_width(-1);
        [, gridH] = dockUI.gridBtn.get_preferred_height(-1);
    }

    let clockW = 0, clockH = 0;
    if (dockUI.extractedClock && dockUI.extractedClock.visible && isFullWidth) {
        [, clockW] = dockUI.extractedClock.get_preferred_width(-1);
        [, clockH] = dockUI.extractedClock.get_preferred_height(-1);
    }

    const sWidth = !isFullWidth ? dockUI.settings.get_int('stroke-width') : 0;
    const hoverZoom = dockUI.settings.get_boolean('hover-zoom');
    const maxZoom = hoverZoom ? dockUI.settings.get_double('hover-zoom-factor') : 1.0;
    const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
    const iconSize = dockUI.settings.get_int('icon-size');
    const maxExpansion = hoverZoom ? (iconSize * 3.5 * (actualMax - 1.0)) : 0;

    const hideMode = dockUI.settings.get_string('hide-mode');
    const forceEdgeSize = isFullWidth || (hideMode === 'never' || hideMode === 'none');

    const actorW = forceEdgeSize ? (isVertical ? Math.max(boxW, gridW) + (sWidth * 2) : monitor.width) : boxW + (sWidth * 2);
    const actorH = forceEdgeSize ? (isVertical ? monitor.height : Math.max(boxH, gridH) + (sWidth * 2)) : boxH + (sWidth * 2);

    dockUI.actor.set_size(actorW, actorH);

    let contentW = boxW;
    let contentH = boxH;
    if (isFullWidth && dockUI.gridBtn && dockUI.gridBtn.visible) {
        contentW += gridW + 80;
        contentH += gridH + 80;
    }

    const totalW = contentW + maxExpansion + (sWidth * 2);
    const totalH = contentH + maxExpansion + (sWidth * 2);

    let scale = 1.0;
    const paddingBuffer = 20;

    if (isVertical && totalH > monitor.height - paddingBuffer) {
        scale = (monitor.height - paddingBuffer) / totalH;
    } else if (!isVertical && totalW > monitor.width - paddingBuffer) {
        scale = (monitor.width - paddingBuffer) / totalW;
    }

    let pivotX = 0.5, pivotY = 0.5;
    if (pos === 'LEFT') pivotX = 0.0;
    else if (pos === 'RIGHT') pivotX = 1.0;
    else if (pos === 'TOP') pivotY = 0.0;
    else if (pos === 'BOTTOM') pivotY = 1.0;

    if (isFullWidth) {
        if (!isVertical) {
            if (alignment === 'START') pivotX = 0.0;
            else if (alignment === 'END') pivotX = 1.0;
        } else {
            if (alignment === 'START') pivotY = 0.0;
            else if (alignment === 'END') pivotY = 1.0;
        }
    }

    dockUI.actor.set_pivot_point(pivotX, pivotY);
    dockUI.actor.set_scale(scale, scale);

    let bgX, bgY, bgW, bgH;
    if (isFullWidth) {
        bgW = isVertical ? boxW + (sWidth * 2) : monitor.width / scale;
        bgH = isVertical ? monitor.height / scale : boxH + (sWidth * 2);

        if (!isVertical) {
            bgX = -pivotX * monitor.width * ((1.0 / scale) - 1.0);
            bgY = pos === 'BOTTOM' ? actorH - bgH : (pos === 'TOP' ? 0 : (actorH - bgH) / 2);
        } else {
            bgY = -pivotY * monitor.height * ((1.0 / scale) - 1.0);
            bgX = pos === 'RIGHT' ? actorW - bgW : (pos === 'LEFT' ? 0 : (actorW - bgW) / 2);
        }
    } else {
        bgW = boxW + (sWidth * 2);
        bgH = boxH + (sWidth * 2);
        bgX = (actorW - bgW) / 2;
        bgY = (actorH - bgH) / 2;

        if (pos === 'BOTTOM') bgY = actorH - bgH;
        else if (pos === 'TOP') bgY = 0;
        else if (pos === 'LEFT') bgX = 0;
        else if (pos === 'RIGHT') bgX = actorW - bgW;
    }

    const padScale = 10 / scale;
    let gx = 0, gy = 0;
    let actualGridPos = gridPos;

    if (isFullWidth && dockUI.gridBtn && dockUI.gridBtn.visible) {
        gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + padScale;
        gy = isVertical ? bgY + padScale : bgY + (bgH - gridH) / 2;
        dockUI.gridBtn.set_position(gx, gy);
    }

    let cx = 0, cy = 0;
    let rightOffset = padScale;
    
    if (isFullWidth && dockUI.extractedDesktop && dockUI.extractedDesktop.visible) {
        let deskBtnWidth = 14;
        try { deskBtnWidth = dockUI.settings.get_int('desktop-btn-width'); } catch(e) {}
        
        const dWidth = isVertical ? bgW : deskBtnWidth;
        const dHeight = isVertical ? deskBtnWidth : bgH;
        
        dockUI.extractedDesktop.set_size(dWidth, dHeight);
        
        const dx = isVertical ? bgX : bgX + bgW - dWidth;
        const dy = isVertical ? bgY + bgH - dHeight : bgY;
        
        dockUI.extractedDesktop.set_position(dx, dy);
        rightOffset += isVertical ? 0 : dWidth;
    }

    if (isFullWidth && dockUI.extractedClock && dockUI.extractedClock.visible) {
        cx = isVertical ? bgX + (bgW - clockW) / 2 : bgX + bgW - clockW - rightOffset;
        cy = isVertical ? bgY + bgH - clockH - padScale : bgY + (bgH - clockH) / 2;
        dockUI.extractedClock.set_position(cx, cy);
    }

    let contentX = sWidth, contentY = sWidth;
    const halfExp = maxExpansion / 2;
    const safetyGap = 40 / scale;

    if (!isVertical) {
        if (isFullWidth) {
            if (alignment === 'START') contentX = bgX + padScale + halfExp;
            else if (alignment === 'END') contentX = bgX + bgW - boxW - padScale - halfExp;
            else contentX = bgX + (bgW - boxW) / 2;
        } else {
            contentX = bgX + (bgW - boxW) / 2;
        }
        contentY = bgY + (bgH - boxH) / 2;
    } else {
        if (isFullWidth) {
            if (alignment === 'START') contentY = bgY + padScale + halfExp;
            else if (alignment === 'END') contentY = bgY + bgH - boxH - padScale - halfExp;
            else contentY = bgY + (bgH - boxH) / 2;
        } else {
            contentY = bgY + (bgH - boxH) / 2;
        }
        contentX = bgX + (bgW - boxW) / 2;
    }

    if (isFullWidth && dockUI.gridBtn && dockUI.gridBtn.visible) {
        if (!isVertical) {
            const gridRight = (bgX + padScale) + gridW + safetyGap;
            const boxLeft = contentX - halfExp;
            if (boxLeft < gridRight) contentX += (gridRight - boxLeft);
        } else {
            const gridBottom = (bgY + padScale) + gridH + safetyGap;
            const boxTop = contentY - halfExp;
            if (boxTop < gridBottom) contentY += (gridBottom - boxTop);
        }
    }

    if (isFullWidth && dockUI.extractedClock && dockUI.extractedClock.visible) {
        if (!isVertical) {
            const clockLeft = cx - safetyGap;
            const boxRight = contentX + boxW + halfExp;
            if (boxRight > clockLeft) contentX -= (boxRight - clockLeft);
        } else {
            const clockTop = cy - safetyGap;
            const boxBottom = contentY + boxH + halfExp;
            if (boxBottom > clockTop) contentY -= (boxBottom - clockTop);
        }
    }

    dockUI.boxActor.set_position(contentX, contentY);
    dockUI.actor._isFullWidth = isFullWidth;
    dockUI.bgActor._baseW = bgW;
    dockUI.bgActor._baseH = bgH;
    dockUI.bgActor.set_position(bgX, bgY);
    dockUI.bgActor.set_size(bgW, bgH);

    if (dockUI.dockManager) {
        dockUI.dockManager.updatePosition();
    }

    if (dockUI.actor._fixedSlots && !dockUI.actor._isDragging) {
        dockUI.actor._fixedSlots = null;
    }

    dockUI.actor._cachedW = actorW;
    dockUI.actor._cachedH = actorH;

    if (dockUI.autoHideManager) {
        dockUI.autoHideManager._updateEdgeTrigger();
        dockUI.autoHideManager._scheduleUpdate(10);
    }
}