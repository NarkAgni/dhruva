/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import St from 'gi://St';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import cairo from 'gi://cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import PeekManager from '../core/PeekManager.js';
import WorkspaceFilter from '../core/WorkspaceFilter.js';
import {
    animateRestore
} from './effects/WindowEffects.js';


const FLIP_DURATION = 300;
const TOOLTIP_DELAY_MS = 600;


function traceMenuPath(cr, w, h, r, ah, aw, dockPos, ax, ay) {
    ax = Math.max(r + aw / 2, Math.min(ax, w - r - aw / 2));
    ay = Math.max(r + aw / 2, Math.min(ay, h - r - aw / 2));

    cr.newPath();
    if (dockPos === 'BOTTOM') {
        cr.moveTo(r, 0);
        cr.lineTo(w - r, 0);
        cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - ah - r);
        cr.arc(w - r, h - ah - r, r, 0, Math.PI / 2);
        cr.lineTo(ax + aw / 2, h - ah);
        cr.lineTo(ax + 2, h - 2);
        cr.curveTo(ax, h, ax, h, ax - 2, h - 2);
        cr.lineTo(ax - aw / 2, h - ah);
        cr.lineTo(r, h - ah);
        cr.arc(r, h - ah - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, r);
        cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'TOP') {
        cr.moveTo(r, ah);
        cr.lineTo(ax - aw / 2, ah);
        cr.lineTo(ax - 2, 2);
        cr.curveTo(ax, 0, ax, 0, ax + 2, 2);
        cr.lineTo(ax + aw / 2, ah);
        cr.lineTo(w - r, ah);
        cr.arc(w - r, ah + r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r);
        cr.arc(w - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(r, h);
        cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, ah + r);
        cr.arc(r, ah + r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'RIGHT') {
        cr.moveTo(r, 0);
        cr.lineTo(w - ah - r, 0);
        cr.arc(w - ah - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w - ah, ay - aw / 2);
        cr.lineTo(w - 2, ay - 2);
        cr.curveTo(w, ay, w, ay, w - 2, ay + 2);
        cr.lineTo(w - ah, ay + aw / 2);
        cr.lineTo(w - ah, h - r);
        cr.arc(w - ah - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(r, h);
        cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, r);
        cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'LEFT') {
        cr.moveTo(ah + r, 0);
        cr.lineTo(w - r, 0);
        cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r);
        cr.arc(w - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(ah + r, h);
        cr.arc(ah + r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(ah, ay + aw / 2);
        cr.lineTo(2, ay + 2);
        cr.curveTo(0, ay, 0, ay, 2, ay - 2);
        cr.lineTo(ah, ay - aw / 2);
        cr.lineTo(ah, r);
        cr.arc(ah + r, r, r, Math.PI, 3 * Math.PI / 2);
    }
    cr.closePath();
}

function _setDefaultCursor() {
    try {
        if (typeof Meta.CursorShape !== 'undefined') {
            global.display.set_cursor(Meta.CursorShape.DEFAULT);
        } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DEFAULT !== undefined) {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        }
    } catch (e) {}
}

export function getDockButtons(dockActor) {
    try {
        if (!dockActor || dockActor.__destroyed || (typeof dockActor.is_destroyed === 'function' && dockActor.is_destroyed())) return [];
        
        const box = dockActor.boxActor || dockActor;
        
        if (!box || box.__destroyed || (typeof box.is_destroyed === 'function' && box.is_destroyed())) return [];

        return box.get_children().filter(c => {
            if (!c || c.__destroyed) return false;
            if (typeof c.is_destroyed === 'function' && c.is_destroyed()) return false;
            if (typeof c.get_parent === 'function' && c.get_parent() === null) return false;
            
            if (c._isExternal) return true;
            const sClass = typeof c.get_style_class_name === 'function' ? c.get_style_class_name() : (c.style_class || '');
            return sClass.includes('dock-app-button') || sClass.includes('dock-separator') || sClass.includes('dock-drag-handle') || sClass.includes('clock-module');
        });
    } catch (e) {
        return [];
    }
}

export function getFixedSlots(dockActor, isVertical, btns) {
    const cached = dockActor ? dockActor._fixedSlots : null;
    const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
    const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;

    if (cached && cached.count === btns.length) {
        let sameButtons = true;
        for (let i = 0; i < btns.length; i++) {
            if (cached.buttons[i] !== btns[i]) {
                sameButtons = false;
                break;
            }

            const b = btns[i];
            const livePos = isVertical ? (b.y + boxY) + b.height / 2 : (b.x + boxX) + b.width / 2;
            if (Math.abs(livePos - cached.centersByBtn[i]) > 2) {
                sameButtons = false;
                break;
            }
        }
        if (sameButtons)
            return cached;
    }

    const centersByBtn = btns.map(b => {
        const localX = b.x + boxX;
        const localY = b.y + boxY;
        return isVertical ? localY + b.height / 2 : localX + b.width / 2;
    });

    const ordered = centersByBtn
        .map((center, btnIndex) => ({
            center,
            btnIndex
        }))
        .sort((a, b) => (a.center - b.center) || (a.btnIndex - b.btnIndex));

    const orderToBtn = ordered.map(item => item.btnIndex);
    const orderedSlots = ordered.map(item => item.center);
    const btnToOrder = new Array(btns.length);

    for (let orderIndex = 0; orderIndex < orderToBtn.length; orderIndex++)
        btnToOrder[orderToBtn[orderIndex]] = orderIndex;

    const model = {
        count: btns.length,
        buttons: btns.slice(),
        centersByBtn,
        orderedSlots,
        orderToBtn,
        btnToOrder,
    };

    dockActor._fixedSlots = model;
    return model;
}

function isActorAlive(actor) {
    if (!actor) return false;
    if (actor.__destroyed) return false;
    try {
        if (typeof actor.is_destroyed === 'function' && actor.is_destroyed()) return false;
        let _dummy = actor.visible;
    } catch (_e) {
        return false;
    }
    return true;
}

export function stopDragLoop(dockActor) {
    if (dockActor && dockActor._dragLoopId) {
        GLib.source_remove(dockActor._dragLoopId);
        dockActor._dragLoopId = null;
    }
}

export function startDragLoop(dockActor, isVertical, settings) {
    stopDragLoop(dockActor);
    let _dragWasOutside = false;

    dockActor._dragLoopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
        try {
            if (!dockActor || dockActor._isDestroyed || !dockActor._isDragging) {
                dockActor._dragLoopId = null;
                return GLib.SOURCE_REMOVE;
            }

            const [cx, cy] = global.get_pointer();
            const [dx, dy] = dockActor.get_transformed_position();
            const [dw, dh] = dockActor.get_transformed_size();

            let boundsLeft = dx,
                boundsRight = dx + dw,
                boundsTop = dy,
                boundsBottom = dy + dh;
            if (dockActor.bgActor) {
                const [bx, by] = dockActor.bgActor.get_transformed_position();
                const [bw, bh] = dockActor.bgActor.get_transformed_size();
                boundsLeft = Math.min(boundsLeft, bx);
                boundsRight = Math.max(boundsRight, bx + bw);
                boundsTop = Math.min(boundsTop, by);
                boundsBottom = Math.max(boundsBottom, by + bh);
            }
            const padX = isVertical ? 24 : 10;
            const padY = isVertical ? 10 : 24;
            const isInsideDock = cx >= boundsLeft - padX && cx <= boundsRight + padX && cy >= boundsTop - padY && cy <= boundsBottom + padY;

            if (!isInsideDock) {
                if (!_dragWasOutside) {
                    getDockButtons(dockActor).forEach(btn => {
                        btn.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            translation_x: 0,
                            translation_y: 0,
                            duration: 200,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    });
                    if (dockActor.bgActor) dockActor.bgActor.set_pivot_point(0.5, 0.5);
                    _dragWasOutside = true;
                }
                return GLib.SOURCE_CONTINUE;
            }

            if (_dragWasOutside) {
                dockActor._fixedSlots = null;
                _dragWasOutside = false;
            }

            applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, Date.now());
            return GLib.SOURCE_CONTINUE;
        } catch (e) {
            return GLib.SOURCE_REMOVE;
        }
    });
}

function _clearTooltipDelay(dockActor) {
    if (!dockActor) return;
    if (dockActor._tooltipDelayId) {
        GLib.source_remove(dockActor._tooltipDelayId);
        dockActor._tooltipDelayId = null;
    }
    dockActor._tooltipReady = false;
}

function _hideTooltip(dockActor) {
    _clearTooltipDelay(dockActor);
    if (!dockActor) return;
    dockActor._tooltipHoveredIndex = -1;
    dockActor._tooltipBridgeActive = false;
    if (dockActor._magPeekManager) dockActor._magPeekManager.stopPeek();
    if (dockActor._magTooltip && dockActor._magTooltip.visible) {
        try {
            dockActor._magTooltip.remove_all_transitions();
            dockActor._magTooltip.ease({
                opacity: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    try {
                        if (dockActor._magTooltip) dockActor._magTooltip.hide();
                    } catch (e) {}
                }
            });
        } catch (e) {}
    }
}

function _isInsideTooltip(dockActor, px, py, pad = 20) {
    if (!dockActor || !dockActor._magTooltip || !dockActor._magTooltip.visible) return false;
    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
    const [tw, th] = dockActor._magTooltip.get_transformed_size();
    if (tw <= 0 || th <= 0) return false;
    return (px >= tx - pad && px <= tx + tw + pad && py >= ty - pad && py <= ty + th + pad);
}

function _isPointerInDockTooltipBridge(dockActor, px, py, settings) {
    if (!dockActor || !dockActor._magTooltip || !dockActor._magTooltip.visible) return false;

    let lateralPad = 18;
    let bridgePad = 12;
    try {
        const iconSize = settings.get_int('icon-size');
        lateralPad = Math.max(14, Math.min(26, Math.round(iconSize * 0.28)));
        bridgePad = Math.max(8, Math.min(18, Math.round(iconSize * 0.18)));
    } catch (_e) {}

    const dockPos = settings.get_string('dock-position') || 'BOTTOM';
    const [dax, day] = dockActor.get_transformed_position();
    const [daw, dah] = dockActor.get_transformed_size();
    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
    const [tw, th] = dockActor._magTooltip.get_transformed_size();
    if (daw <= 0 || dah <= 0 || tw <= 0 || th <= 0) return false;

    const dockLeft = dax;
    const dockRight = dax + daw;
    const dockTop = day;
    const dockBottom = day + dah;

    const tipLeft = tx;
    const tipRight = tx + tw;
    const tipTop = ty;
    const tipBottom = ty + th;

    let left = 0,
        right = 0,
        top = 0,
        bottom = 0;

    if (dockPos === 'BOTTOM') {
        left = tipLeft - lateralPad;
        right = tipRight + lateralPad;
        top = tipBottom - bridgePad;
        bottom = dockTop - 2;
    } else if (dockPos === 'TOP') {
        left = tipLeft - lateralPad;
        right = tipRight + lateralPad;
        top = dockBottom + 2;
        bottom = tipTop + bridgePad;
    } else if (dockPos === 'LEFT') {
        left = dockRight - bridgePad;
        right = tipLeft + bridgePad;
        top = tipTop - lateralPad;
        bottom = tipBottom + lateralPad;
    } else {
        left = tipRight - bridgePad;
        right = dockLeft + bridgePad;
        top = tipTop - lateralPad;
        bottom = tipBottom + lateralPad;
    }

    return (px >= left && px <= right && py >= top && py <= bottom);
}

export function applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, now = null) {
    try {
        if (!dockActor || dockActor._isDestroyed || dockActor._isHidden || !dockActor.visible || dockActor._suppressZoom) {
            _hideTooltip(dockActor);
            return;
        }

        const btns = getDockButtons(dockActor);
        const n = btns.length;
        if (!n || btns[0].width === 0) return;
        if (n > 1 && btns[0].x === btns[n - 1].x && btns[0].y === btns[n - 1].y) return;

        const isAppGrid = isAppGridOpen();
        const isMenu = isContextMenuOpen();

        if (isAppGrid || isMenu) {
            _hideTooltip(dockActor);
            if (isAppGrid) return;
        }



        const hoverZoom = settings.get_boolean('hover-zoom') && !isAppGrid;
        const maxZoom = hoverZoom ? settings.get_double('hover-zoom-factor') : 1.0;
        const actualMaxZoom = 1.0 + (maxZoom - 1.0) * 2.0;
        const iconSize = settings.get_int('icon-size');

        const RADIUS = iconSize * 3.5;
        const piOverRadius = Math.PI / RADIUS;
        const zoomRange = actualMaxZoom - 1.0;
        const zoomEnabled = actualMaxZoom > 1.0;

        const [dx, dy] = dockActor.get_transformed_position();
        const scaleFactor = isVertical ? dockActor.scale_y : dockActor.scale_x;
        const localCursor = (isVertical ? cy - dy : cx - dx) / scaleFactor;

        const cached = dockActor._fixedSlots;
        if (cached && cached.count === n) {
            const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
            const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;
            let stale = false;

            for (let i = 0; i < n; i++) {
                if (cached.buttons[i] !== btns[i]) {
                    stale = true;
                    break;
                }

                const b = btns[i];
                const livePos = isVertical ? (b.y + boxY) + b.height / 2 : (b.x + boxX) + b.width / 2;
                if (Math.abs(livePos - cached.centersByBtn[i]) > 2) {
                    stale = true;
                    break;
                }
            }

            if (stale)
                dockActor._fixedSlots = null;
        }

        const slotModel = getFixedSlots(dockActor, isVertical, btns);
        if (!slotModel || !slotModel.orderedSlots || slotModel.orderedSlots.length !== n)
            return;

        const orderedSlots = slotModel.orderedSlots;
        const centersByBtn = slotModel.centersByBtn;
        const orderToBtn = slotModel.orderToBtn;
        const btnToOrder = slotModel.btnToOrder;

        if (!dockActor._scalesCache || dockActor._scalesCache.length !== n) {
            dockActor._scalesCache = new Array(n).fill(1.0);
            dockActor._scaledCentersCache = new Array(n).fill(0);
        }
        if (!dockActor._orderedScalesCache || dockActor._orderedScalesCache.length !== n)
            dockActor._orderedScalesCache = new Array(n).fill(1.0);
        if (!dockActor._orderedCentersCache || dockActor._orderedCentersCache.length !== n)
            dockActor._orderedCentersCache = new Array(n).fill(0);

        const scales = dockActor._scalesCache;
        const scaledCenters = dockActor._scaledCentersCache;
        const orderedScales = dockActor._orderedScalesCache;
        const orderedCenters = dockActor._orderedCentersCache;

        for (let orderIndex = 0; orderIndex < n; orderIndex++) {
            const btnIndex = orderToBtn[orderIndex];
            const b = btns[btnIndex];
            const sClass = typeof b.get_style_class_name === 'function' ? b.get_style_class_name() : (b.style_class || '');
            const isStaticEdge = b._isStatic || sClass.includes('dock-separator') || sClass.includes('clock-module') || sClass.includes('dock-drag-handle');

            if (!zoomEnabled || isStaticEdge) {
                orderedScales[orderIndex] = 1.0;
                continue;
            }
            const dist = Math.abs(localCursor - orderedSlots[orderIndex]);
            if (dist >= RADIUS) orderedScales[orderIndex] = 1.0;
            else orderedScales[orderIndex] = 1.0 + zoomRange * ((Math.cos(dist * piOverRadius) + 1) * 0.5);
        }

        orderedCenters[0] = orderedSlots[0];
        for (let orderIndex = 1; orderIndex < n; orderIndex++) {
            const prevBtn = btns[orderToBtn[orderIndex - 1]];
            const currBtn = btns[orderToBtn[orderIndex]];

            const prevW = isVertical ? prevBtn.height : prevBtn.width;
            const currW = isVertical ? currBtn.height : currBtn.width;

            const prevScale = orderedScales[orderIndex - 1];
            const currScale = orderedScales[orderIndex];

            const originalGap = orderedSlots[orderIndex] - orderedSlots[orderIndex - 1];

            const GAP_FACTOR = 2.0;

            let prevExtra = (prevW * prevScale - prevW) / GAP_FACTOR;
            let currExtra = (currW * currScale - currW) / GAP_FACTOR;

            const sClassP = typeof prevBtn.get_style_class_name === 'function' ? prevBtn.get_style_class_name() : (prevBtn.style_class || '');
            const sClassC = typeof currBtn.get_style_class_name === 'function' ? currBtn.get_style_class_name() : (currBtn.style_class || '');

            const prevIsStatic = prevBtn._isStatic || sClassP.includes('dock-separator') || sClassP.includes('clock-module');
            const currIsStatic = currBtn._isStatic || sClassC.includes('dock-separator') || sClassC.includes('clock-module');

            if (currIsStatic && prevScale > 1.0) {
                currExtra += (prevW * (prevScale - 1.0)) * 0.25;
            }
            if (prevIsStatic && currScale > 1.0) {
                prevExtra += (currW * (currScale - 1.0)) * 0.25;
            }

            orderedCenters[orderIndex] = orderedCenters[orderIndex - 1] + originalGap + prevExtra + currExtra;
        }

        for (let i = 0; i < n; i++) {
            const orderIndex = btnToOrder[i];
            scales[i] = orderedScales[orderIndex];
            scaledCenters[i] = orderedCenters[orderIndex];
        }

        let mappedCursor = orderedCenters[0];
        if (n > 1) {
            if (localCursor <= orderedSlots[0]) mappedCursor = orderedCenters[0] - (orderedSlots[0] - localCursor);
            else if (localCursor >= orderedSlots[n - 1]) mappedCursor = orderedCenters[n - 1] + (localCursor - orderedSlots[n - 1]);
            else {
                for (let orderIndex = 0; orderIndex < n - 1; orderIndex++) {
                    if (localCursor >= orderedSlots[orderIndex] && localCursor <= orderedSlots[orderIndex + 1]) {
                        const gap = orderedSlots[orderIndex + 1] - orderedSlots[orderIndex];
                        const t = gap > 0 ? (localCursor - orderedSlots[orderIndex]) / gap : 0;
                        mappedCursor = orderedCenters[orderIndex] + t * (orderedCenters[orderIndex + 1] - orderedCenters[orderIndex]);
                        break;
                    }
                }
            }
        }

        if (Number.isNaN(mappedCursor)) mappedCursor = orderedCenters[0] || 0;
        const zoomOffset = localCursor - mappedCursor;
        if (Number.isNaN(zoomOffset)) return;

        const axis = isVertical ? 'translation_y' : 'translation_x';
        const t = now || Date.now();
        const SMOOTH_FACTOR = dockActor._isDragging ? 0.30 : 0.24;
        let leftExp = 0,
            rightExp = 0,
            topExp = 0,
            botExp = 0;

        if (zoomEnabled) {
            let minVis = Infinity,
                maxVis = -Infinity,
                origMin = Infinity,
                origMax = -Infinity;
            for (let i = 0; i < n; i++) {
                if (btns[i].style_class?.includes('clock-module') || btns[i].style_class?.includes('dock-drag-handle')) continue;
                const c = scaledCenters[i] + zoomOffset;
                const half = (isVertical ? btns[i].height : btns[i].width) * scales[i] / 2;
                if (c - half < minVis) minVis = c - half;
                if (c + half > maxVis) maxVis = c + half;

                const origC = centersByBtn[i];
                const origHalf = (isVertical ? btns[i].height : btns[i].width) / 2;
                if (origC - origHalf < origMin) origMin = origC - origHalf;
                if (origC + origHalf > origMax) origMax = origC + origHalf;
            }
            if (minVis !== Infinity && origMin !== Infinity) {
                if (isVertical) {
                    topExp = Math.max(0, origMin - minVis);
                    botExp = Math.max(0, maxVis - origMax);
                } else {
                    leftExp = Math.max(0, origMin - minVis);
                    rightExp = Math.max(0, maxVis - origMax);
                }
            }
        }

        for (let i = 0; i < n; i++) {
            const b = btns[i];

            let zoomTrans = zoomEnabled ? (scaledCenters[i] + zoomOffset) - centersByBtn[i] : 0;

            let flipTrans = 0;
            if (b._flipOffset && b._flipStartTime) {
                const elapsed = t - b._flipStartTime;
                if (elapsed < FLIP_DURATION) flipTrans = b._flipOffset * (1.0 - easeOutCirc(elapsed / FLIP_DURATION));
                else {
                    b._flipOffset = 0;
                    b._flipStartTime = null;
                }
            }

            b.remove_transition('scale_x');
            b.remove_transition('scale_y');
            b.remove_transition('translation_x');
            b.remove_transition('translation_y');

            const targetScale = scales[i];
            const targetTrans = zoomTrans + flipTrans;
            const prevScale = Number.isFinite(b.scale_x) ? b.scale_x : 1.0;
            const prevTrans = Number.isFinite(b[axis]) ? b[axis] : 0.0;

            const smoothScale = prevScale + ((targetScale - prevScale) * SMOOTH_FACTOR);
            const smoothTrans = prevTrans + ((targetTrans - prevTrans) * SMOOTH_FACTOR);

            if (zoomEnabled) {
                b.scale_x = smoothScale;
                b.scale_y = smoothScale;
            }

            b[axis] = smoothTrans;
            const appBox = typeof b.get_child === 'function' ? b.get_child() : null;
            if (appBox && typeof appBox.get_children === 'function') {
                appBox.get_children().forEach(c => {
                    if (c._isIndicator) {
                        c.remove_transition('scale_x');
                        c.remove_transition('scale_y');
                        c.set_pivot_point(0.5, 0.5);
                        if (zoomEnabled) {
                            c.scale_x = 1.0 / smoothScale;
                            c.scale_y = 1.0 / smoothScale;
                        }
                    }
                });
            }
        }

        if (dockActor.bgActor && dockActor.boxActor && !settings.get_boolean('full-width') && zoomEnabled) {
            const baseW = dockActor.bgActor.width || dockActor.bgActor._baseW || dockActor.boxActor.width;
            const baseH = dockActor.bgActor.height || dockActor.bgActor._baseH || dockActor.boxActor.height;
            const BUFFER = 16;

            dockActor.bgActor.remove_transition('scale_x');
            dockActor.bgActor.remove_transition('scale_y');
            dockActor.bgActor.remove_transition('translation_x');
            dockActor.bgActor.remove_transition('translation_y');

            if (isVertical) {
                const newH = baseH + topExp + botExp + BUFFER;
                const targetScaleY = baseH > 0 ? newH / baseH : 1.0;
                const targetTransY = (botExp - topExp) / 2;
                const prevScaleY = Number.isFinite(dockActor.bgActor.scale_y) ? dockActor.bgActor.scale_y : 1.0;
                const prevTransY = Number.isFinite(dockActor.bgActor.translation_y) ? dockActor.bgActor.translation_y : 0.0;

                dockActor.bgActor.scale_y = prevScaleY + ((targetScaleY - prevScaleY) * SMOOTH_FACTOR);
                dockActor.bgActor.translation_y = prevTransY + ((targetTransY - prevTransY) * SMOOTH_FACTOR);
            } else {
                const newW = baseW + leftExp + rightExp + BUFFER;
                const targetScaleX = baseW > 0 ? newW / baseW : 1.0;
                const targetTransX = (rightExp - leftExp) / 2;
                const prevScaleX = Number.isFinite(dockActor.bgActor.scale_x) ? dockActor.bgActor.scale_x : 1.0;
                const prevTransX = Number.isFinite(dockActor.bgActor.translation_x) ? dockActor.bgActor.translation_x : 0.0;

                dockActor.bgActor.scale_x = prevScaleX + ((targetScaleX - prevScaleX) * SMOOTH_FACTOR);
                dockActor.bgActor.translation_x = prevTransX + ((targetTransX - prevTransX) * SMOOTH_FACTOR);
            }
            if (dockActor.floatManager && typeof dockActor.floatManager._alignHandlesToEdges === 'function') dockActor.floatManager._alignHandlesToEdges();
        }

        if (isAppGrid || isMenu) return;

        if (!settings.get_boolean('show-apps-preview')) {
            _hideTooltip(dockActor);
            return;
        }

        let closestIndex = -1,
            minDiff = Infinity;
        for (let i = 0; i < n; i++) {
            const visualCenter = zoomEnabled ? (scaledCenters[i] + zoomOffset) : centersByBtn[i];
            const diff = Math.abs(localCursor - visualCenter);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }

        let isHovering = false;
        if (closestIndex !== -1) {
            const visualRadius = (iconSize * scales[closestIndex]) / 2;
            isHovering = minDiff <= visualRadius;
        }

        if (isHovering) {
            const btn = btns[closestIndex];
            let appName = '';

            if (btn._delegate?.isFolder) appName = btn._delegate.folderData.name;
            else if (btn._delegate?.app) appName = btn._delegate.app.get_name();
            else if (typeof btn.get_child === 'function' && btn.get_child()?.has_style_class_name?.('dock-grid-icon')) appName = 'Applications';

            if (appName) {
                if (dockActor._tooltipHoveredIndex !== closestIndex) {
                    _clearTooltipDelay(dockActor);
                    if (dockActor._magTooltip) {
                        dockActor._magTooltip.remove_all_transitions();
                        dockActor._magTooltip.opacity = 0;
                        dockActor._magTooltip.hide();
                    }
                    dockActor._tooltipHoveredIndex = closestIndex;
                    dockActor._magTooltipAppId = null;

                    dockActor._tooltipDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
                        dockActor._tooltipDelayId = null;
                        dockActor._tooltipReady = true;
                        try {
                            const [pcx, pcy] = global.get_pointer();
                            applyRealtimeFrame(dockActor, pcx, pcy, isVertical, settings, Date.now());
                        } catch (e) {}
                        return GLib.SOURCE_REMOVE;
                    });
                }


                if (!dockActor._magTooltip) {
                    dockActor._magTooltip = new St.Widget({
                        layout_manager: new Clutter.BinLayout(),
                        visible: false,
                        reactive: true,
                        track_hover: true,
                        style: 'background-color: transparent;'
                    });

                    dockActor._magTooltipBg = new St.DrawingArea({
                        x_expand: true,
                        y_expand: true,
                        style: 'background-color: transparent;'
                    });
                    dockActor._magTooltipBox = new St.BoxLayout({
                        vertical: true,
                        style_class: 'dhruva-tooltip',
                        style: 'background-color: transparent; border: none; box-shadow: none;'
                    });

                    dockActor._magTooltip.add_child(dockActor._magTooltipBg);
                    dockActor._magTooltip.add_child(dockActor._magTooltipBox);

                    dockActor._magTooltip.connect('enter-event', () => {
                        if (dockActor._leaveCheckId) {
                            GLib.source_remove(dockActor._leaveCheckId);
                            dockActor._leaveCheckId = null;
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });

                    dockActor._magTooltip.connect('leave-event', () => {
                        _checkPointerLeave(dockActor, settings);
                        return Clutter.EVENT_PROPAGATE;
                    });

                    Main.layoutManager.uiGroup.add_child(dockActor._magTooltip);
                    if (!dockActor._magDestroyHandlerId) {
                        dockActor._magDestroyHandlerId = dockActor.connect('destroy', () => {
                            if (dockActor._magTooltip) {
                                try {
                                    dockActor._magTooltip.destroy();
                                } catch (e) {}
                                dockActor._magTooltip = null;
                            }
                            if (dockActor._magPeekManager) {
                                dockActor._magPeekManager.destroy();
                                dockActor._magPeekManager = null;
                            }
                            dockActor._magDestroyHandlerId = null;
                        });
                    }
                }

                if (!dockActor._magPeekManager && dockActor._dockUI) {
                    dockActor._magPeekManager = new PeekManager(dockActor._dockUI, Main.layoutManager.uiGroup);
                }

                let appId = btn._delegate?.app ? (typeof btn._delegate.app.get_id === 'function' ? btn._delegate.app.get_id() : btn._delegate.app.get_name()) : (btn._delegate?.isFolder ? btn._delegate.folderData.id : appName);

                if (dockActor._tooltipReady && dockActor._magTooltipAppId !== appId) {
                    dockActor._magTooltipAppId = appId;
                    dockActor._magTooltipBox.destroy_all_children();

                    const tBg = dockActor._tooltipBg || 'background-color: rgba(20, 20, 22, 0.92);';
                    const tFg = dockActor._tooltipFg || '#ffffff';

                    let sWidth = 1,
                        sOpacity = 0.2;
                    try {
                        sWidth = settings.get_int('stroke-width');
                        sOpacity = settings.get_int('stroke-opacity') / 100.0;
                    } catch (e) {}

                    let borderRgba = 'rgba(255,255,255,0.2)';
                    if (tFg.startsWith('#')) {
                        const r = parseInt(tFg.slice(1, 3), 16) || 255;
                        const g = parseInt(tFg.slice(3, 5), 16) || 255;
                        const b = parseInt(tFg.slice(5, 7), 16) || 255;
                        borderRgba = `rgba(${r}, ${g}, ${b}, ${sOpacity})`;
                    }


                    let bgRgba = 'rgba(20, 20, 22, 0.92)';
                    let match = tBg.match(/background-gradient-start:\s*(rgba?\([^)]+\))/);
                    if (!match) match = tBg.match(/background-color:\s*(rgba?\([^)]+\))/);

                    if (match) {
                        let color = match[1];
                        if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
                            let allColors = tBg.match(/rgba?\([^)]+\)/g);
                            if (allColors) {
                                bgRgba = allColors.find(c => c !== 'rgba(0, 0, 0, 0)' && c.replace(/\s/g, '') !== 'rgba(0,0,0,0)') || bgRgba;
                            }
                        } else {
                            bgRgba = color;
                        }
                    } else if (tBg.startsWith('#')) {
                        bgRgba = tBg;
                    }

                    dockActor._magTooltipBg._bgRgba = bgRgba;
                    dockActor._magTooltipBg._strokeRgba = borderRgba;
                    dockActor._magTooltipBg._sWidth = sWidth;

                    if (!dockActor._magTooltipBg._repaintConnected) {
                        dockActor._magTooltipBg._repaintConnected = true;
                        dockActor._magTooltipBg.connect('repaint', (area) => {
                            const dockPos = settings.get_string('dock-position') || 'BOTTOM';
                            const cr = area.get_context();
                            const [fullW, fullH] = area.get_surface_size();
                            const r = 12;
                            const ah = 8;
                            const aw = 16;

                            const sw = area._sWidth || 0;
                            const half = sw / 2;
                            const w = fullW - sw;
                            const h = fullH - sw;

                            let ax = (area._arrowCenter || fullW / 2) - half;
                            let ay = (area._arrowCenter || fullH / 2) - half;

                            const parseRgba = (str) => {
                                let m = (str || '').match(/[\d.]+/g);
                                return m ? m.map(Number) : [0, 0, 0, 0];
                            };

                            cr.save();
                            cr.setOperator(cairo.Operator.CLEAR);
                            cr.paint();
                            cr.restore();

                            cr.translate(half, half);
                            traceMenuPath(cr, w, h, r, ah, aw, dockPos, ax, ay);

                            const [br, bg, bb, ba] = parseRgba(area._bgRgba);
                            cr.setSourceRGBA(br / 255, bg / 255, bb / 255, ba);
                            cr.fillPreserve();

                            if (sw > 0) {
                                const [sr, sg, sb, sa] = parseRgba(area._strokeRgba);
                                cr.setSourceRGBA(sr / 255, sg / 255, sb / 255, sa);
                                cr.setLineWidth(sw);
                                cr.setLineJoin(cairo.LineJoin.ROUND);
                                cr.stroke();
                            } else {
                                cr.newPath();
                            }
                            cr.$dispose();
                        });
                    }


                    const ah = 8;
                    let padBottom = 10,
                        padTop = 10,
                        padLeft = 14,
                        padRight = 14;
                    const dockPos = settings.get_string('dock-position') || 'BOTTOM';
                    if (dockPos === 'BOTTOM') padBottom += ah;
                    else if (dockPos === 'TOP') padTop += ah;
                    else if (dockPos === 'LEFT') padLeft += ah;
                    else if (dockPos === 'RIGHT') padRight += ah;

                    dockActor._magTooltipBox.set_style(`color: ${tFg}; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px; background-color: transparent; border: none; box-shadow: none;`);

                    const titleLbl = new St.Label({
                        text: appName,
                        style: `font-weight: bold; text-align: center; color: ${tFg};`
                    });
                    dockActor._magTooltipBox.add_child(titleLbl);

                    let windows = [];
                    if (btn._delegate?.app && typeof btn._delegate.app.get_windows === 'function') {
                        windows = btn._delegate.app.get_windows();
                        if (settings.get_boolean('isolate-monitors') && dockActor._dockUI) {
                            const currentMonitorIndex = dockActor._dockUI.monitorManager.getCurrentMonitor().index;
                            windows = windows.filter(w => w.get_monitor() === currentMonitorIndex);
                        }
                        windows = WorkspaceFilter.filterWindows(windows, settings);
                    }

                    if (windows.length > 0) {
                        const thumbBox = new St.BoxLayout({
                            vertical: false,
                            style: 'spacing: 10px; margin-top: 10px;'
                        });
                        const customSize = settings.get_int('context-menu-size') || 200;

                        windows.forEach(win => {
                            const thumbBtn = new St.Button({
                                reactive: true,
                                style_class: 'context-menu-thumb-btn'
                            });
                            thumbBtn.set_style('border-radius: 8px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms;');

                            const compPrivate = win.get_compositor_private();
                            if (compPrivate) {
                                const clone = new Clutter.Clone({
                                    source: compPrivate,
                                    reactive: false
                                });
                                const rect = win.get_frame_rect();
                                const w = Math.max(1, rect.width || 1);
                                const h = Math.max(1, rect.height || 1);

                                let thumbW = customSize;
                                let thumbH = (h / w) * thumbW;
                                if (thumbH > customSize * 0.8) {
                                    thumbH = customSize * 0.8;
                                    thumbW = (w / h) * thumbH;
                                }

                                clone.set_size(thumbW, thumbH);
                                const padBin = new St.Bin({
                                    child: clone,
                                    style: 'border-radius: 6px; overflow: hidden;'
                                });
                                thumbBtn.set_child(padBin);
                            } else {
                                thumbBtn.set_size(customSize, customSize * 0.6);
                            }

                            thumbBtn.connect('enter-event', () => {
                                thumbBtn.set_style('border-radius: 8px; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.6); transition-duration: 150ms; box-shadow: 0 4px 12px rgba(0,0,0,0.4);');
                                if (dockActor._magPeekManager) dockActor._magPeekManager.startPeek(win);
                                return Clutter.EVENT_PROPAGATE;
                            });

                            thumbBtn.connect('leave-event', () => {
                                thumbBtn.set_style('border-radius: 8px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms;');
                                if (dockActor._magPeekManager) dockActor._magPeekManager.stopPeek();
                                return Clutter.EVENT_PROPAGATE;
                            });

                            thumbBtn.connect('clicked', () => {
                                if (win.minimized) animateRestore(win, btn, settings.get_string('dock-position') || 'BOTTOM');
                                Main.activateWindow(win);
                                _hideTooltip(dockActor);
                            });

                            thumbBox.add_child(thumbBtn);
                        });

                        if (windows.length > 2) {
                            const scroll = new St.ScrollView({
                                vscrollbar_policy: St.PolicyType.NEVER,
                                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                                enable_mouse_scrolling: true,
                                style: `max-width: ${(customSize * 2.5) + 20}px;`
                            });
                            scroll.connect('scroll-event', (_actor, event) => {
                                let dx = 0,
                                    dy = 0;
                                const direction = event.get_scroll_direction();

                                if (direction === Clutter.ScrollDirection.SMOOTH) {
                                    [dx, dy] = event.get_scroll_delta();
                                } else if (direction === Clutter.ScrollDirection.UP) dy = -1;
                                else if (direction === Clutter.ScrollDirection.DOWN) dy = 1;
                                else if (direction === Clutter.ScrollDirection.LEFT) dx = -1;
                                else if (direction === Clutter.ScrollDirection.RIGHT) dx = 1;

                                if (Math.abs(dy) > Math.abs(dx) && dy !== 0) {
                                    dx = dy;
                                    dy = 0;
                                }

                                if (dx !== 0) {
                                    const adjustment = typeof scroll.get_hadjustment === 'function' ?
                                        scroll.get_hadjustment() :
                                        scroll.get_hscroll_bar().get_adjustment();

                                    if (adjustment) {
                                        const step = direction === Clutter.ScrollDirection.SMOOTH ? dx * 40 : dx * 50;
                                        let newVal = adjustment.get_value() + step;
                                        const min = adjustment.get_lower();
                                        const max = adjustment.get_upper() - adjustment.get_page_size();

                                        if (newVal > max) newVal = max;
                                        if (newVal < min) newVal = min;

                                        adjustment.set_value(newVal);
                                        return Clutter.EVENT_STOP;
                                    }
                                }
                                return Clutter.EVENT_PROPAGATE;
                            });
                            scroll.add_child(thumbBox);
                            dockActor._magTooltipBox.add_child(scroll);
                        } else {
                            dockActor._magTooltipBox.add_child(thumbBox);
                        }
                    }
                }

                if (dockActor._tooltipReady && (!dockActor._magTooltip.visible || dockActor._magTooltip.opacity === 0)) {
                    dockActor._magTooltipBox.queue_relayout();
                    let [, tw] = dockActor._magTooltipBox.get_preferred_width(-1);
                    let [, th] = dockActor._magTooltipBox.get_preferred_height(-1);
                    if (tw < 48 || th < 28) {
                        tw = dockActor._lastTooltipW || Math.max(120, settings.get_int('icon-size') * 2);
                        th = dockActor._lastTooltipH || 56;
                    }
                    dockActor._lastTooltipW = tw;
                    dockActor._lastTooltipH = th;
                    const [bx, by] = btn.get_transformed_position();
                    const [bw, bh] = btn.get_transformed_size();
                    const dockPos = settings.get_string('dock-position') || 'BOTTOM';

                    let tx = 0,
                        ty = 0;
                    const gap = 8;

                    const iconCenterX = bx + bw / 2;
                    const iconCenterY = by + bh / 2;

                    if (dockPos === 'BOTTOM') {
                        tx = iconCenterX - tw / 2;
                        ty = by - th - gap;
                        dockActor._magTooltip.set_pivot_point(0.5, 1.0);
                    } else if (dockPos === 'TOP') {
                        tx = iconCenterX - tw / 2;
                        ty = by + bh + gap;
                        dockActor._magTooltip.set_pivot_point(0.5, 0.0);
                    } else if (dockPos === 'LEFT') {
                        tx = bx + bw + gap;
                        ty = iconCenterY - th / 2;
                        dockActor._magTooltip.set_pivot_point(0.0, 0.5);
                    } else if (dockPos === 'RIGHT') {
                        tx = bx - tw - gap;
                        ty = iconCenterY - th / 2;
                        dockActor._magTooltip.set_pivot_point(1.0, 0.5);
                    }

                    if (tx < 10) tx = 10;
                    if (tx + tw > global.stage.width - 10) tx = global.stage.width - tw - 10;
                    if (ty < 10) ty = 10;
                    if (ty + th > global.stage.height - 10) ty = global.stage.height - th - 10;

                    const minArrowPad = 18;
                    if (dockPos === 'BOTTOM' || dockPos === 'TOP') {
                        dockActor._magTooltipBg._arrowCenter = Math.max(minArrowPad, Math.min(iconCenterX - tx, tw - minArrowPad));
                    } else {
                        dockActor._magTooltipBg._arrowCenter = Math.max(minArrowPad, Math.min(iconCenterY - ty, th - minArrowPad));
                    }
                    dockActor._magTooltip.set_size(tw, th);
                    dockActor._magTooltipBg.queue_repaint();
                    dockActor._magTooltip.set_position(tx, ty);
                    dockActor._magTooltip.show();

                    const parent = dockActor._magTooltip.get_parent();
                    if (parent && dockActor._dockUI && dockActor._dockUI.actor) {
                        try {
                            const sibling = dockActor._dockUI.actor;
                            const siblingParent = sibling?.get_parent?.();
                            if (sibling && siblingParent === parent)
                                parent.set_child_below_sibling(dockActor._magTooltip, sibling);
                        } catch (_e) {}
                    }

                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.ease({
                        opacity: 255,
                        duration: 220,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                } else if (dockActor._tooltipReady && dockActor._magTooltip.visible && dockActor._magTooltipBg) {
                    const [bx, by] = btn.get_transformed_position();
                    const [bw, bh] = btn.get_transformed_size();
                    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
                    const [tw, th] = dockActor._magTooltip.get_transformed_size();
                    const dockPos = settings.get_string('dock-position') || 'BOTTOM';
                    const minArrowPad = 18;

                    if (tw > 0 && th > 0) {
                        if (dockPos === 'BOTTOM' || dockPos === 'TOP') {
                            const iconCenterX = bx + bw / 2;
                            dockActor._magTooltipBg._arrowCenter = Math.max(minArrowPad, Math.min(iconCenterX - tx, tw - minArrowPad));
                        } else {
                            const iconCenterY = by + bh / 2;
                            dockActor._magTooltipBg._arrowCenter = Math.max(minArrowPad, Math.min(iconCenterY - ty, th - minArrowPad));
                        }
                        dockActor._magTooltipBg.queue_repaint();
                    }
                }
            }
        } else {
            const keepTooltipAlive = _isInsideTooltip(dockActor, cx, cy, 24) ||
                _isPointerInDockTooltipBridge(dockActor, cx, cy, settings);
            if (!keepTooltipAlive) _hideTooltip(dockActor);
        }
    } catch (e) {
        _hideTooltip(dockActor);
    }
}

export function resetMagnification(dockActor, suppressForMs = 0) {
    if (!dockActor || dockActor.__destroyed || (typeof dockActor.is_destroyed === 'function' && dockActor.is_destroyed())) return;
    try {
        if (suppressForMs > 0) {
            dockActor._suppressZoom = true;
            if (dockActor._suppressTimeoutId) {
                GLib.source_remove(dockActor._suppressTimeoutId);
            }
            dockActor._suppressTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, suppressForMs, () => {
                dockActor._suppressZoom = false;
                dockActor._suppressTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        stopDragLoop(dockActor);
        dockActor._lastMagMotionFrameTs = 0;
        dockActor._fixedSlots = null;
        _hideTooltip(dockActor);

        if (dockActor._postClickTimerId) {
            GLib.source_remove(dockActor._postClickTimerId);
            dockActor._postClickTimerId = null;
        }

        getDockButtons(dockActor).forEach(btn => {
            btn._flipOffset = 0;
            btn._flipStartTime = null;
            
            if (isActorAlive(btn)) {
                btn.remove_all_transitions();
                btn.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    translation_x: 0,
                    translation_y: 0,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            }

            if (isActorAlive(btn)) {
                const appBox = typeof btn.get_child === 'function' ? btn.get_child() : null;
                if (isActorAlive(appBox) && typeof appBox.get_children === 'function') {
                    appBox.get_children().forEach(c => {
                        if (c._isIndicator && isActorAlive(c)) {
                            c.ease({
                                scale_x: 1.0,
                                scale_y: 1.0,
                                duration: 180,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD
                            });
                        }
                    });
                }
            }
        });

        if (isActorAlive(dockActor.bgActor)) {
            dockActor.bgActor._baseW = null;
            dockActor.bgActor._baseH = null;
            dockActor.bgActor.remove_all_transitions();
            dockActor.bgActor.ease({
                translation_x: 0,
                translation_y: 0,
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 280,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        }
    } catch (e) {}
}

function _checkPointerLeave(dockActor, settings) {
    if (dockActor._leaveCheckId) return;
    dockActor._leaveCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
        try {
            if (dockActor._isDestroyed || isContextMenuOpen() || dockActor._isDragging || dockActor._launchingApp) {
                dockActor._leaveCheckId = null;
                return GLib.SOURCE_REMOVE;
            }

            const [px, py] = global.get_pointer();
            const [dax, day] = dockActor.get_transformed_position();

            const daw = dockActor._cachedW || dockActor.width || 0;
            const dah = dockActor._cachedH || dockActor.height || 0;

            const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;
            const hoverZoom = settings.get_boolean('hover-zoom');
            const maxZoom = hoverZoom ? settings.get_double('hover-zoom-factor') : 1.0;
            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
            const overflow = settings.get_int('icon-size') * actualMax;

            let boundsLeft = dax,
                boundsRight = dax + daw,
                boundsTop = day,
                boundsBottom = day + dah;
            if (dockActor.bgActor) {
                const [bx, by] = dockActor.bgActor.get_transformed_position();
                const [bw, bh] = dockActor.bgActor.get_transformed_size();
                boundsLeft = Math.min(boundsLeft, bx);
                boundsRight = Math.max(boundsRight, bx + bw);
                boundsTop = Math.min(boundsTop, by);
                boundsBottom = Math.max(boundsBottom, by + bh);
            }
            const padX = isVertical ? Math.max(20, overflow) : 10;
            const padY = isVertical ? 10 : Math.max(20, overflow);

            const inside = (px >= boundsLeft - padX && px <= boundsRight + padX && py >= boundsTop - padY && py <= boundsBottom + padY);

            const insideTooltip = _isInsideTooltip(dockActor, px, py, 24);
            const insideBridge = _isPointerInDockTooltipBridge(dockActor, px, py, settings);

            if (!inside && !insideTooltip && !insideBridge) {
                resetMagnification(dockActor);
                dockActor._leaveCheckId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        } catch (e) {
            return GLib.SOURCE_REMOVE;
        }
    });
}

export function isContextMenuOpen() {
    for (const child of Main.layoutManager.uiGroup.get_children()) {
        if (!child.mapped) continue;
        if (child.style_class && child.style_class.includes('context-menu-overlay') && child.visible) return true;
    }
    return false;
}

export function isAppGridOpen() {
    for (const child of Main.layoutManager.uiGroup.get_children()) {
        if (child.style_class && child.style_class.includes('app-list-overlay') && child.visible) return true;
    }
    return false;
}
export function setupMagnification(dockActor, settings, dockPositionGetter) {
    if (!isActorAlive(dockActor)) return;
    teardownMagnification(dockActor);
    if (!isActorAlive(dockActor)) return;
    dockActor._lastMagMotionFrameTs = 0;
    const dockPos = dockPositionGetter();

    getDockButtons(dockActor).forEach(btn => {
        if (!isActorAlive(btn)) return;
        if (dockPos === 'BOTTOM') btn.set_pivot_point(0.5, 1.0);
        else if (dockPos === 'TOP') btn.set_pivot_point(0.5, 0.0);
        else if (dockPos === 'LEFT') btn.set_pivot_point(0.0, 0.5);
        else if (dockPos === 'RIGHT') btn.set_pivot_point(1.0, 0.5);
    });
    if (isActorAlive(dockActor.bgActor)) {
        if (dockPos === 'BOTTOM') dockActor.bgActor.set_pivot_point(0.5, 1.0);
        else if (dockPos === 'TOP') dockActor.bgActor.set_pivot_point(0.5, 0.0);
        else if (dockPos === 'LEFT') dockActor.bgActor.set_pivot_point(0.0, 0.5);
        else if (dockPos === 'RIGHT') dockActor.bgActor.set_pivot_point(1.0, 0.5);
    }

    if (!isActorAlive(dockActor)) return;
    try {
        dockActor._magEnterId = dockActor.connect('enter-event', () => {
            if (!isActorAlive(dockActor)) return;
            if (dockActor._leaveCheckId) {
                GLib.source_remove(dockActor._leaveCheckId);
                dockActor._leaveCheckId = null;
            }
            if (!dockActor._isDragging) {
                dockActor._fixedSlots = null;
                _setDefaultCursor();
            }
        });
    } catch (e) { dockActor._magEnterId = null; }

    dockActor._magMotionId = null;

    if (!isActorAlive(dockActor)) return;
    try {
        dockActor._magLeaveId = dockActor.connect('leave-event', () => {
            if (!isActorAlive(dockActor) || dockActor._isDestroyed || isContextMenuOpen() || dockActor._isDragging) return;
            _checkPointerLeave(dockActor, settings);
        });
    } catch (e) { dockActor._magLeaveId = null; }

    if (!isActorAlive(dockActor)) return;
    dockActor._stageClickId = global.stage.connect('captured-event', (_stage, event) => {
        try {
            if (!dockActor || dockActor._isDestroyed || dockActor._isHidden) return Clutter.EVENT_PROPAGATE;
            const evType = event.type();

            if (evType === Clutter.EventType.MOTION) {
                if (dockActor._isDragging) return Clutter.EVENT_PROPAGATE;
                if ((event.get_state() & Clutter.ModifierType.BUTTON1_MASK) !== 0) return Clutter.EVENT_PROPAGATE;
                const frameNow = Date.now();
                const minFrameGap = dockActor._isDragging ? 8 : 16;
                if (dockActor._lastMagMotionFrameTs && (frameNow - dockActor._lastMagMotionFrameTs) < minFrameGap) {
                    return Clutter.EVENT_PROPAGATE;
                }
                dockActor._lastMagMotionFrameTs = frameNow;

                const [ex, ey] = event.get_coords();
                const [dax, day] = dockActor.get_transformed_position();
                const daw = dockActor._cachedW || dockActor.width || 0;
                const dah = dockActor._cachedH || dockActor.height || 0;

                let boundsLeft = dax,
                    boundsRight = dax + daw,
                    boundsTop = day,
                    boundsBottom = day + dah;
                if (dockActor.bgActor) {
                    const [bx, by] = dockActor.bgActor.get_transformed_position();
                    const [bw, bh] = dockActor.bgActor.get_transformed_size();
                    boundsLeft = Math.min(boundsLeft, bx);
                    boundsRight = Math.max(boundsRight, bx + bw);
                    boundsTop = Math.min(boundsTop, by);
                    boundsBottom = Math.max(boundsBottom, by + bh);
                }

                const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;
                const actualMax = 1.0 + ((settings.get_boolean('hover-zoom') ? settings.get_double('hover-zoom-factor') : 1.0) - 1.0) * 2.0;
                const overflow = settings.get_int('icon-size') * actualMax;

                const padX = isVertical ? Math.max(20, overflow) : 10;
                const padY = isVertical ? 10 : Math.max(20, overflow);

                const onDock = ex >= boundsLeft - padX && ex <= boundsRight + padX && ey >= boundsTop - padY && ey <= boundsBottom + padY;
                const insideTooltip = _isInsideTooltip(dockActor, ex, ey, 24);
                const insideBridge = _isPointerInDockTooltipBridge(dockActor, ex, ey, settings);
                const dockPos = settings.get_string('dock-position') || 'BOTTOM';

                if (!onDock && !insideTooltip && !insideBridge) return Clutter.EVENT_PROPAGATE;
                if (insideTooltip || insideBridge) {
                    dockActor._tooltipBridgeActive = true;
                    return Clutter.EVENT_PROPAGATE;
                }

                if (dockPos === 'BOTTOM' && onDock && dockActor._tooltipBridgeActive && dockActor._magTooltip?.visible) {
                    _hideTooltip(dockActor);
                    return Clutter.EVENT_PROPAGATE;
                }
                dockActor._tooltipBridgeActive = false;

                _setDefaultCursor();

                if (isContextMenuOpen() || isAppGridOpen()) {
                    _clearTooltipDelay(dockActor);
                    if (dockActor._magTooltip) {
                        dockActor._magTooltip.remove_all_transitions();
                        dockActor._magTooltip.opacity = 0;
                        dockActor._magTooltip.hide();
                    }
                    return Clutter.EVENT_PROPAGATE;
                }

                applyRealtimeFrame(dockActor, ex, ey, isVertical, settings, Date.now());
                return Clutter.EVENT_PROPAGATE;
            }

            if (evType === Clutter.EventType.BUTTON_PRESS) {
                const [px, py] = event.get_coords();
                dockActor._globalPressX = px;
                dockActor._globalPressY = py;
                dockActor._lastIconClickTime = Date.now();

                const insideTooltip = _isInsideTooltip(dockActor, px, py, 20);
                if (!insideTooltip) {
                    _clearTooltipDelay(dockActor);
                    dockActor._tooltipHoveredIndex = -1;
                    if (dockActor._magTooltip) {
                        dockActor._magTooltip.remove_all_transitions();
                        dockActor._magTooltip.opacity = 0;
                        dockActor._magTooltip.hide();
                    }
                }

                return Clutter.EVENT_PROPAGATE;
            }

            if (evType !== Clutter.EventType.BUTTON_RELEASE) return Clutter.EVENT_PROPAGATE;
            if (dockActor._isDragging || isAppGridOpen() || isContextMenuOpen()) return Clutter.EVENT_PROPAGATE;

            if (!settings.get_boolean('hover-zoom')) return Clutter.EVENT_PROPAGATE;

            const [ex, ey] = event.get_coords();
            const buttonNum = event.get_button();
            const [dax, day] = dockActor.get_transformed_position();
            const [daw, dah] = dockActor.get_transformed_size();

            const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;
            const actualMaxZoom = 1.0 + (settings.get_double('hover-zoom-factor') - 1.0) * 2.0;
            const maxOverflow = settings.get_int('icon-size') * actualMaxZoom;

            let boundsLeft = dax,
                boundsRight = dax + daw,
                boundsTop = day,
                boundsBottom = day + dah;
            if (dockActor.bgActor) {
                const [bx, by] = dockActor.bgActor.get_transformed_position();
                const [bw, bh] = dockActor.bgActor.get_transformed_size();
                boundsLeft = Math.min(boundsLeft, bx);
                boundsRight = Math.max(boundsRight, bx + bw);
                boundsTop = Math.min(boundsTop, by);
                boundsBottom = Math.max(boundsBottom, by + bh);
            }
            const padX = isVertical ? Math.max(20, maxOverflow) : 10;
            const padY = isVertical ? 10 : Math.max(20, maxOverflow);

            if (ex < boundsLeft - padX || ex > boundsRight + padX || ey < boundsTop - padY || ey > boundsBottom + padY) return Clutter.EVENT_PROPAGATE;

            const invokeButton = (targetBtn) => {
                if (!targetBtn || typeof targetBtn._activateCallback !== 'function')
                    return false;

                if (targetBtn._wasDragged) {
                    targetBtn._wasDragged = false;
                    return true;
                }

                if (settings.get_boolean('lock-icons')) {
                    const dx = Math.abs(ex - (dockActor._globalPressX || ex));
                    const dy = Math.abs(ey - (dockActor._globalPressY || ey));
                    if (dx > 15 || dy > 15) return true;
                }

                dockActor._lastIconClickTime = Date.now();
                _clearTooltipDelay(dockActor);
                if (dockActor._magTooltip) {
                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.opacity = 0;
                    dockActor._magTooltip.hide();
                }

                targetBtn._activateCallback(buttonNum, event.get_state());
                if (buttonNum === 1) resetMagnification(dockActor, 800);

                if (dockActor._postClickTimerId) GLib.source_remove(dockActor._postClickTimerId);
                dockActor._postClickTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    dockActor._postClickTimerId = null;
                    if (isAppGridOpen()) resetMagnification(dockActor);
                    return GLib.SOURCE_REMOVE;
                });
                return true;
            };

            const btns = getDockButtons(dockActor);
            const n = btns.length;
            if (!n) return Clutter.EVENT_PROPAGATE;


            for (let i = n - 1; i >= 0; i--) {
                const btn = btns[i];
                if (!btn || typeof btn._activateCallback !== 'function') continue;
                const [bx, by] = btn.get_transformed_position();
                const [bw, bh] = btn.get_transformed_size();
                if (bw <= 0 || bh <= 0) continue;
                if (ex >= bx && ex <= bx + bw && ey >= by && ey <= by + bh) {
                    if (invokeButton(btn)) return Clutter.EVENT_STOP;
                }
            }


            try {
                const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, ex, ey);
                let cur = picked;
                let hops = 0;
                while (cur && hops < 12) {
                    if (typeof cur._activateCallback === 'function') {
                        if (invokeButton(cur)) return Clutter.EVENT_STOP;
                    }
                    cur = typeof cur.get_parent === 'function' ? cur.get_parent() : null;
                    hops++;
                }
            } catch (_e) {}

            if (!n || actualMaxZoom <= 1.0) return Clutter.EVENT_PROPAGATE;

            const RADIUS = settings.get_int('icon-size') * 3.5;
            const scaleFactor = isVertical ? dockActor.scale_y : dockActor.scale_x;
            const localEx = (isVertical ? ey - day : ex - dax) / scaleFactor;
            const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
            const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;
            const slotModel = getFixedSlots(dockActor, isVertical, btns);
            if (!slotModel || !slotModel.orderedSlots || slotModel.orderedSlots.length !== n)
                return Clutter.EVENT_PROPAGATE;

            const orderedSlots = slotModel.orderedSlots;
            const orderToBtn = slotModel.orderToBtn;
            const btnToOrder = slotModel.btnToOrder;
            const orderedScales = new Array(n).fill(1.0);
            const orderedCenters = new Array(n).fill(0);
            const scales = new Array(n).fill(1.0);
            const scaledCenters = new Array(n).fill(0);

            for (let orderIndex = 0; orderIndex < n; orderIndex++) {
                const btnIndex = orderToBtn[orderIndex];
                const b = btns[btnIndex];
                const sClass = typeof b.get_style_class_name === 'function' ? b.get_style_class_name() : (b.style_class || '');
                const isStaticEdge = b._isStatic || sClass.includes('dock-separator') || sClass.includes('clock-module') || sClass.includes('dock-drag-handle');

                if (isStaticEdge) {
                    orderedScales[orderIndex] = 1.0;
                    continue;
                }

                const dist = Math.abs(localEx - orderedSlots[orderIndex]);
                if (dist >= RADIUS) orderedScales[orderIndex] = 1.0;
                else orderedScales[orderIndex] = 1.0 + (actualMaxZoom - 1.0) * ((Math.cos((dist / RADIUS) * Math.PI) + 1) / 2);
            }

            orderedCenters[0] = orderedSlots[0];
            for (let orderIndex = 1; orderIndex < n; orderIndex++) {
                const prevBtn = btns[orderToBtn[orderIndex - 1]];
                const currBtn = btns[orderToBtn[orderIndex]];

                const prevW = isVertical ? prevBtn.height : prevBtn.width;
                const currW = isVertical ? currBtn.height : currBtn.width;

                const prevScale = orderedScales[orderIndex - 1];
                const currScale = orderedScales[orderIndex];

                const originalGap = orderedSlots[orderIndex] - orderedSlots[orderIndex - 1];

                const GAP_FACTOR = 2.0;

                let prevExtra = (prevW * prevScale - prevW) / GAP_FACTOR;
                let currExtra = (currW * currScale - currW) / GAP_FACTOR;

                const sClassP = typeof prevBtn.get_style_class_name === 'function' ? prevBtn.get_style_class_name() : (prevBtn.style_class || '');
                const sClassC = typeof currBtn.get_style_class_name === 'function' ? currBtn.get_style_class_name() : (currBtn.style_class || '');

                const prevIsStatic = prevBtn._isStatic || sClassP.includes('dock-separator') || sClassP.includes('clock-module');
                const currIsStatic = currBtn._isStatic || sClassC.includes('dock-separator') || sClassC.includes('clock-module');

                if (currIsStatic && prevScale > 1.0) {
                    currExtra += (prevW * (prevScale - 1.0)) * 0.25;
                }
                if (prevIsStatic && currScale > 1.0) {
                    prevExtra += (currW * (currScale - 1.0)) * 0.25;
                }

                orderedCenters[orderIndex] = orderedCenters[orderIndex - 1] + originalGap + prevExtra + currExtra;
            }

            for (let i = 0; i < n; i++) {
                const orderIndex = btnToOrder[i];
                scales[i] = orderedScales[orderIndex];
                scaledCenters[i] = orderedCenters[orderIndex];
            }

            let mappedCursor = orderedCenters[0];
            if (n > 1) {
                if (localEx <= orderedSlots[0]) mappedCursor = orderedCenters[0] - (orderedSlots[0] - localEx);
                else if (localEx >= orderedSlots[n - 1]) mappedCursor = orderedCenters[n - 1] + (localEx - orderedSlots[n - 1]);
                else {
                    for (let orderIndex = 0; orderIndex < n - 1; orderIndex++) {
                        if (localEx >= orderedSlots[orderIndex] && localEx <= orderedSlots[orderIndex + 1]) {
                            mappedCursor = orderedCenters[orderIndex] +
                                ((localEx - orderedSlots[orderIndex]) / (orderedSlots[orderIndex + 1] - orderedSlots[orderIndex])) *
                                (orderedCenters[orderIndex + 1] - orderedCenters[orderIndex]);
                            break;
                        }
                    }
                }
            }

            const zoomOffset = localEx - mappedCursor;
            const dockPos = settings.get_string('dock-position') || 'BOTTOM';

            for (let i = 0; i < n; i++) {
                const btn = btns[i];
                if (!btn._activateCallback) continue;

                const scale = scales[i];
                let px = 0.5,
                    py = 0.5;
                if (dockPos === 'BOTTOM') py = 1.0;
                else if (dockPos === 'TOP') py = 0.0;
                else if (dockPos === 'LEFT') px = 0.0;
                else if (dockPos === 'RIGHT') px = 1.0;

                const visCenterX = isVertical ? dax + (boxX + btn.x + btn.width * px) * dockActor.scale_x : dax + (scaledCenters[i] + zoomOffset) * dockActor.scale_x;
                const visCenterY = isVertical ? day + (scaledCenters[i] + zoomOffset) * dockActor.scale_y : day + (boxY + btn.y + btn.height * py) * dockActor.scale_y;

                const visLeft = visCenterX - btn.width * scale * px * dockActor.scale_x;
                const visRight = visCenterX + btn.width * scale * (1.0 - px) * dockActor.scale_x;
                const visTop = visCenterY - btn.height * scale * py * dockActor.scale_y;
                const visBottom = visCenterY + btn.height * scale * (1.0 - py) * dockActor.scale_y;

                if (ex >= visLeft && ex <= visRight && ey >= visTop && ey <= visBottom) {
                    if (invokeButton(btn)) return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        } catch (e) {
            return Clutter.EVENT_PROPAGATE;
        }
    });
}



export function setMagnifierPauseState(dockActor, reason, isPaused) {
    if (!dockActor) return;

    if (!dockActor._magPauseReasons) {
        dockActor._magPauseReasons = new Set();
    }

    if (isPaused) {
        dockActor._magPauseReasons.add(reason);
        dockActor._suppressZoom = true;
        resetMagnification(dockActor);
    } else {
        dockActor._magPauseReasons.delete(reason);

        if (dockActor._magPauseReasons.size === 0) {
            dockActor._suppressZoom = false;
        }
    }
}

export function teardownMagnification(dockActor, skipReset = false) {
    if (!dockActor) return;

    function _alive() {
        if (dockActor.__destroyed) return false;
        try {
            if (typeof dockActor.is_destroyed === 'function' && dockActor.is_destroyed()) return false;
            void dockActor.visible;
            return true;
        } catch (_e) {
            return false;
        }
    }

    if (!_alive()) return;

    stopDragLoop(dockActor);

    try { dockActor._lastMagMotionFrameTs = 0; } catch (_e) {}

    try {
        if (dockActor._leaveCheckId) {
            GLib.source_remove(dockActor._leaveCheckId);
            dockActor._leaveCheckId = null;
        }
    } catch (_e) {}

    try {
        if (dockActor._postClickTimerId) {
            GLib.source_remove(dockActor._postClickTimerId);
            dockActor._postClickTimerId = null;
        }
    } catch (_e) {}

    if (_alive()) {
        try {
            if (dockActor._magMotionId) {
                dockActor.disconnect(dockActor._magMotionId);
            }
        } catch (_e) {}
        dockActor._magMotionId = null;

        try {
            if (dockActor._magLeaveId) {
                dockActor.disconnect(dockActor._magLeaveId);
            }
        } catch (_e) {}
        dockActor._magLeaveId = null;

        try {
            if (dockActor._magEnterId) {
                dockActor.disconnect(dockActor._magEnterId);
            }
        } catch (_e) {}
        dockActor._magEnterId = null;
    } else {
        dockActor._magMotionId = null;
        dockActor._magLeaveId = null;
        dockActor._magEnterId = null;
    }

    try {
        if (dockActor._stageClickId) {
            global.stage.disconnect(dockActor._stageClickId);
            dockActor._stageClickId = null;
        }
    } catch (_e) { dockActor._stageClickId = null; }

    _clearTooltipDelay(dockActor);
    try { dockActor._tooltipHoveredIndex = -1; } catch (_e) {}

    if (_alive()) {
        try {
            if (dockActor._magDestroyHandlerId) {
                dockActor.disconnect(dockActor._magDestroyHandlerId);
            }
        } catch (_e) {}
    }
    dockActor._magDestroyHandlerId = null;

    try {
        if (dockActor._magTooltip) {
            dockActor._magTooltip.destroy();
            dockActor._magTooltip = null;
        }
    } catch (_e) { dockActor._magTooltip = null; }

    try {
        if (dockActor._magPeekManager) {
            dockActor._magPeekManager.destroy();
            dockActor._magPeekManager = null;
        }
    } catch (_e) { dockActor._magPeekManager = null; }

    if (!skipReset && _alive()) {
        resetMagnification(dockActor);
    }

    try { dockActor._fixedSlots = null; } catch (_e) {}
    try { dockActor._lastIconClickTime = null; } catch (_e) {}
}

function easeOutCirc(t) {
    return Math.sqrt(1 - Math.pow(t - 1, 2));
}