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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const FLIP_DURATION = 300;
const TOOLTIP_DELAY_MS = 1000;

function _setDefaultCursor() {
    try {
        if (typeof Meta.CursorShape !== 'undefined') {
            global.display.set_cursor(Meta.CursorShape.DEFAULT);
        } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DEFAULT !== undefined) {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        }
    } catch (e) { }
}

export function getDockButtons(dockActor) {
    try {
        const box = dockActor.boxActor || dockActor;
        return box.get_children().filter(c =>
            c.style_class?.includes('dock-app-button') ||
            c.style_class?.includes('dock-separator') ||
            c.style_class?.includes('dock-drag-handle')
        );
    } catch (e) { return []; }
}

export function getFixedSlots(dockActor, isVertical, btns) {
    if (dockActor._fixedSlots && dockActor._fixedSlots.length === btns.length)
        return dockActor._fixedSlots;

    const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
    const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;

    let rawSlots = btns.map(b => {
        let localX = b.x + boxX;
        let localY = b.y + boxY;
        return isVertical ? localY + b.height / 2 : localX + b.width / 2;
    });

    rawSlots.sort((a, b) => a - b);
    dockActor._fixedSlots = rawSlots;
    return rawSlots;
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

            const pad = 24;
            const isInsideDock = cx >= dx - pad && cx <= dx + dw + pad && cy >= dy - pad && cy <= dy + dh + pad;

            if (!isInsideDock) {
                if (!_dragWasOutside) {
                    getDockButtons(dockActor).forEach(btn => {
                        btn.ease({
                            scale_x: 1.0, scale_y: 1.0, translation_x: 0, translation_y: 0,
                            duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    });

                    if (dockActor.bgActor) {
                        dockActor.bgActor.set_pivot_point(0.5, 0.5);
                    }
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
    if (dockActor._magTooltip && dockActor._magTooltip.visible) {
        try {
            dockActor._magTooltip.remove_all_transitions();
            dockActor._magTooltip.ease({
                opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => { try { if (dockActor._magTooltip) dockActor._magTooltip.hide(); } catch (e) { } }
            });
        } catch (e) { }
    }
}

export function applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, now = null) {
    try {
        if (!dockActor || dockActor._isDestroyed || dockActor._isHidden || !dockActor.visible) {
            _hideTooltip(dockActor);
            return;
        }

        const tx = Math.abs(dockActor.translation_x || 0);
        const ty = Math.abs(dockActor.translation_y || 0);
        if (tx > 2 || ty > 2) return;

        const btns = getDockButtons(dockActor);
        const n = btns.length;
        if (!n || btns[0].width === 0) return;
        if (n > 1 && btns[0].x === btns[n - 1].x && btns[0].y === btns[n - 1].y) return;

        const isAppGrid = isAppGridOpen();
        const isMenu = isContextMenuOpen();

        if (isAppGrid || isMenu) {
            _clearTooltipDelay(dockActor);
            if (dockActor._magTooltip) {
                dockActor._magTooltip.remove_all_transitions();
                dockActor._magTooltip.opacity = 0;
                dockActor._magTooltip.hide();
            }
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
        if (cached && cached.length === n) {
            const b0 = btns[0];
            const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
            const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;
            const livePos = isVertical ? (b0.y + boxY) + b0.height / 2 : (b0.x + boxX) + b0.width / 2;
            if (Math.abs(livePos - cached[0]) > 2) dockActor._fixedSlots = null;
        }

        const slots = getFixedSlots(dockActor, isVertical, btns);

        if (!dockActor._scalesCache || dockActor._scalesCache.length !== n) {
            dockActor._scalesCache = new Array(n).fill(1.0);
            dockActor._scaledCentersCache = new Array(n).fill(0);
        }
        
        const scales = dockActor._scalesCache;
        const scaledCenters = dockActor._scaledCentersCache;

        for (let i = 0; i < n; i++) {
            const b = btns[i];
            
            const isStaticEdge = b._isStatic || b.style_class?.includes('dock-separator') || b.style_class?.includes('clock-module') || b.style_class?.includes('dock-drag-handle');
            
            if (!zoomEnabled || isStaticEdge) {
                scales[i] = 1.0;
                continue;
            }
            
            const dist = Math.abs(localCursor - slots[i]);
            if (dist >= RADIUS) {
                scales[i] = 1.0;
            } else {
                scales[i] = 1.0 + zoomRange * ((Math.cos(dist * piOverRadius) + 1) * 0.5);
            }
        }

        scaledCenters[0] = slots[0];
        for (let i = 1; i < n; i++) {
            const gap = slots[i] - slots[i - 1];
            scaledCenters[i] = scaledCenters[i - 1] + gap * (scales[i] + scales[i - 1]) * 0.5;
        }

        let mappedCursor = scaledCenters[0];
        if (n > 1) {
            if (localCursor <= slots[0]) {
                mappedCursor = scaledCenters[0] - (slots[0] - localCursor);
            } else if (localCursor >= slots[n - 1]) {
                mappedCursor = scaledCenters[n - 1] + (localCursor - slots[n - 1]);
            } else {
                for (let i = 0; i < n - 1; i++) {
                    if (localCursor >= slots[i] && localCursor <= slots[i + 1]) {
                        const gap = slots[i + 1] - slots[i];
                        const t = gap > 0 ? (localCursor - slots[i]) / gap : 0;
                        mappedCursor = scaledCenters[i] + t * (scaledCenters[i + 1] - scaledCenters[i]);
                        break;
                    }
                }
            }
        }

        if (Number.isNaN(mappedCursor)) mappedCursor = scaledCenters[0] || 0;
        const zoomOffset = localCursor - mappedCursor;
        if (Number.isNaN(zoomOffset)) return;

        const axis = isVertical ? 'translation_y' : 'translation_x';
        const t = now || Date.now();
        let leftExp = 0, rightExp = 0, topExp = 0, botExp = 0;

        if (zoomEnabled) {
            let minVis = Infinity, maxVis = -Infinity;
            let origMin = Infinity, origMax = -Infinity;

            for (let i = 0; i < n; i++) {
                if (btns[i].style_class?.includes('clock-module') || btns[i].style_class?.includes('dock-drag-handle')) continue;

                const c = scaledCenters[i] + zoomOffset;
                const half = (isVertical ? btns[i].height : btns[i].width) * scales[i] / 2;
                if (c - half < minVis) minVis = c - half;
                if (c + half > maxVis) maxVis = c + half;

                const origC = slots[i];
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

            let zoomTrans = zoomEnabled ? (scaledCenters[i] + zoomOffset) - slots[i] : 0;

            const isStaticEdge = b.style_class?.includes('clock-module') || b.style_class?.includes('dock-drag-handle');
            if (zoomEnabled && isStaticEdge) {
                const isStartGroup = i < (n / 2);
                zoomTrans = isVertical
                    ? (isStartGroup ? -topExp : botExp)
                    : (isStartGroup ? -leftExp : rightExp);
            }

            let flipTrans = 0;
            if (b._flipOffset && b._flipStartTime) {
                const elapsed = t - b._flipStartTime;
                if (elapsed < FLIP_DURATION) {
                    flipTrans = b._flipOffset * (1.0 - easeOutCirc(elapsed / FLIP_DURATION));
                } else {
                    b._flipOffset = 0;
                    b._flipStartTime = null;
                }
            }

            b.scale_x = scales[i];
            b.scale_y = scales[i];
            b.remove_transition(axis);
            b[axis] = zoomTrans + flipTrans;

            const appBox = typeof b.get_child === 'function' ? b.get_child() : null;
            if (appBox && typeof appBox.get_children === 'function') {
                appBox.get_children().forEach(c => {
                    if (c._isIndicator) {
                        c.set_pivot_point(0.5, 0.5);
                        c.scale_x = 1.0 / scales[i];
                        c.scale_y = 1.0 / scales[i];
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
                dockActor.bgActor.scale_y = baseH > 0 ? newH / baseH : 1.0;
                dockActor.bgActor.translation_y = (botExp - topExp) / 2;
            } else {
                const newW = baseW + leftExp + rightExp + BUFFER;
                dockActor.bgActor.scale_x = baseW > 0 ? newW / baseW : 1.0;
                dockActor.bgActor.translation_x = (rightExp - leftExp) / 2;
            }
        }

        if (isAppGrid || isMenu) return;

        if (!settings.get_boolean('show-tooltips')) {
            _hideTooltip(dockActor);
            return;
        }

        let closestIndex = -1, minDiff = Infinity;
        for (let i = 0; i < n; i++) {
            const visualCenter = zoomEnabled ? (scaledCenters[i] + zoomOffset) : slots[i];
            const diff = Math.abs(localCursor - visualCenter);
            if (diff < minDiff) { minDiff = diff; closestIndex = i; }
        }

        let isHovering = false;
        if (closestIndex !== -1) {
            const visualRadius = (iconSize * scales[closestIndex]) / 2;
            isHovering = minDiff <= visualRadius;
        }

        if (isHovering) {
            const btn = btns[closestIndex];
            let appName = '';

            if (btn._delegate?.app) {
                appName = btn._delegate.app.get_name();
            } else if (typeof btn.get_child === 'function' && btn.get_child()?.has_style_class_name?.('dock-grid-icon')) {
                appName = 'Applications';
            }

            if (appName) {
                if (dockActor._tooltipHoveredIndex !== closestIndex) {
                    _clearTooltipDelay(dockActor);
                    if (dockActor._magTooltip) {
                        dockActor._magTooltip.remove_all_transitions();
                        dockActor._magTooltip.opacity = 0;
                        dockActor._magTooltip.hide();
                    }
                    dockActor._tooltipHoveredIndex = closestIndex;
                    dockActor._tooltipDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
                        dockActor._tooltipDelayId = null;
                        dockActor._tooltipReady = true;
                        try {
                            const [pcx, pcy] = global.get_pointer();
                            applyRealtimeFrame(dockActor, pcx, pcy, isVertical, settings, Date.now());
                        } catch (e) { }
                        return GLib.SOURCE_REMOVE;
                    });
                }

                if (!dockActor._magTooltip) {
                    dockActor._magTooltip = new St.Label({
                        style_class: 'dhruva-tooltip',
                        visible: false, reactive: false, track_hover: false,
                    });
                    Main.layoutManager.uiGroup.add_child(dockActor._magTooltip);
                    dockActor.connect('destroy', () => {
                        if (dockActor._magTooltip) {
                            try { dockActor._magTooltip.destroy(); } catch(e) {}
                            dockActor._magTooltip = null;
                        }
                    });
                }

                const tBg = dockActor._tooltipBg || 'rgba(20, 20, 22, 0.92)';
                const tFg = dockActor._tooltipFg || 'rgba(255, 255, 255, 0.95)';
                dockActor._magTooltip.set_style(`background-color: ${tBg}; color: ${tFg};`);

                if (dockActor._magTooltip.get_text() !== appName) {
                    dockActor._magTooltip.set_text(appName);
                }

                const [, tw] = dockActor._magTooltip.get_preferred_width(-1);
                const [, th] = dockActor._magTooltip.get_preferred_height(-1);
                const [bx, by] = btn.get_transformed_position();
                const [bw, bh] = btn.get_transformed_size();
                const dockPos = settings.get_string('dock-position') || 'BOTTOM';

                let tooltipMargin = 14;
                try { tooltipMargin = settings.get_int('tooltip-margin'); } catch (e) { }

                let tx = 0, ty = 0;

                if (dockPos === 'BOTTOM') { tx = bx + bw / 2 - tw / 2; ty = by - th - tooltipMargin; }
                else if (dockPos === 'TOP') { tx = bx + bw / 2 - tw / 2; ty = by + bh + tooltipMargin; }
                else if (dockPos === 'LEFT') { tx = bx + bw + tooltipMargin; ty = by + bh / 2 - th / 2; }
                else if (dockPos === 'RIGHT') { tx = bx - tw - tooltipMargin; ty = by + bh / 2 - th / 2; }

                dockActor._magTooltip.set_position(tx, ty);

                if (dockActor._tooltipReady && (!dockActor._magTooltip.visible || dockActor._magTooltip.opacity === 0)) {
                    dockActor._magTooltip.show();
                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.ease({ opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                }
            }
        } else {
            _hideTooltip(dockActor);
        }
    } catch (e) {
        _hideTooltip(dockActor);
    }
}

export function resetMagnification(dockActor) {
    if (!dockActor || dockActor._isDestroyed) return;
    try {
        stopDragLoop(dockActor);
        dockActor._fixedSlots = null;
        _hideTooltip(dockActor);

        if (dockActor._postClickTimerId) {
            GLib.source_remove(dockActor._postClickTimerId);
            dockActor._postClickTimerId = null;
        }

        getDockButtons(dockActor).forEach(btn => {
            btn._flipOffset = 0;
            btn._flipStartTime = null;
            btn.remove_all_transitions();
            btn.ease({
                scale_x: 1.0, scale_y: 1.0, translation_x: 0, translation_y: 0,
                duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            const appBox = typeof btn.get_child === 'function' ? btn.get_child() : null;
            if (appBox && typeof appBox.get_children === 'function') {
                appBox.get_children().forEach(c => {
                    if (c._isIndicator) {
                        c.ease({
                            scale_x: 1.0, scale_y: 1.0,
                            duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
                    }
                });
            }
        });

        if (dockActor.bgActor) {
            dockActor.bgActor._baseW = null;
            dockActor.bgActor._baseH = null;
            dockActor.bgActor.remove_all_transitions();
            dockActor.bgActor.ease({
                translation_x: 0, translation_y: 0,
                scale_x: 1.0, scale_y: 1.0,
                duration: 280, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    } catch (e) { }
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
            const [daw, dah] = dockActor.get_transformed_size();

            const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;
            const hoverZoom = settings.get_boolean('hover-zoom');
            const maxZoom = hoverZoom ? settings.get_double('hover-zoom-factor') : 1.0;
            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
            const overflow = settings.get_int('icon-size') * actualMax;

            const padX = isVertical ? 25 : Math.max(25, overflow);
            const padY = isVertical ? Math.max(25, overflow) : 25;

            const inside = (px >= dax - padX && px <= dax + daw + padX && py >= day - padY && py <= day + dah + padY);

            if (!inside) {
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
        if (child.style_class && child.style_class.includes('context-menu-overlay') && child.visible)
            return true;
    }
    return false;
}

export function isAppGridOpen() {
    for (const child of Main.layoutManager.uiGroup.get_children()) {
        if (child.style_class && child.style_class.includes('app-list-overlay') && child.visible)
            return true;
    }
    return false;
}

export function setupMagnification(dockActor, settings, dockPositionGetter) {
    teardownMagnification(dockActor);
    const dockPos = dockPositionGetter();
    const isVertical = dockPos === 'LEFT' || dockPos === 'RIGHT';

    getDockButtons(dockActor).forEach(btn => {
        if (dockPos === 'BOTTOM') btn.set_pivot_point(0.5, 1.0);
        else if (dockPos === 'TOP') btn.set_pivot_point(0.5, 0.0);
        else if (dockPos === 'LEFT') btn.set_pivot_point(0.0, 0.5);
        else if (dockPos === 'RIGHT') btn.set_pivot_point(1.0, 0.5);
    });
    if (dockActor.bgActor) {
        if (dockPos === 'BOTTOM') dockActor.bgActor.set_pivot_point(0.5, 1.0);
        else if (dockPos === 'TOP') dockActor.bgActor.set_pivot_point(0.5, 0.0);
        else if (dockPos === 'LEFT') dockActor.bgActor.set_pivot_point(0.0, 0.5);
        else if (dockPos === 'RIGHT') dockActor.bgActor.set_pivot_point(1.0, 0.5);
    }

    dockActor._magEnterId = dockActor.connect('enter-event', () => {
        if (dockActor._leaveCheckId) {
            GLib.source_remove(dockActor._leaveCheckId);
            dockActor._leaveCheckId = null;
        }
        if (!dockActor._isDragging) {
            dockActor._fixedSlots = null;
            _setDefaultCursor();
        }
    });

    dockActor._magMotionId = dockActor.connect('motion-event', (_a, event) => {
        try {
            if (dockActor._isDestroyed) return Clutter.EVENT_PROPAGATE;
            if (isContextMenuOpen()) {
                _clearTooltipDelay(dockActor);
                if (dockActor._magTooltip) {
                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.opacity = 0;
                    dockActor._magTooltip.hide();
                }
                return Clutter.EVENT_STOP;
            }

            const state = event.get_state();
            if ((state & Clutter.ModifierType.BUTTON1_MASK) !== 0) {
                return Clutter.EVENT_PROPAGATE;
            }

            const [cx, cy] = event.get_coords();
            applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, Date.now());
            _setDefaultCursor();

            return Clutter.EVENT_PROPAGATE;
        } catch (e) { return Clutter.EVENT_PROPAGATE; }
    });

    dockActor._magLeaveId = dockActor.connect('leave-event', () => {
        if (dockActor._isDestroyed || isContextMenuOpen() || dockActor._isDragging) return;
        _checkPointerLeave(dockActor, settings);
    });

    dockActor._stageClickId = global.stage.connect('captured-event', (_stage, event) => {
        try {
            if (!dockActor || dockActor._isDestroyed || dockActor._isHidden) return Clutter.EVENT_PROPAGATE;

            const evType = event.type();

            if (evType === Clutter.EventType.MOTION) {
                if (dockActor._isDragging) return Clutter.EVENT_PROPAGATE;

                const state = event.get_state();
                if ((state & Clutter.ModifierType.BUTTON1_MASK) !== 0) {
                    return Clutter.EVENT_PROPAGATE;
                }

                const [ex, ey] = event.get_coords();
                const [dax, day] = dockActor.get_transformed_position();
                const [daw, dah] = dockActor.get_transformed_size();

                const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;
                const hoverZoom = settings.get_boolean('hover-zoom');
                const maxZoom = hoverZoom ? settings.get_double('hover-zoom-factor') : 1.0;
                const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
                const overflow = settings.get_int('icon-size') * actualMax;

                const padX = isVertical ? 25 : Math.max(25, overflow);
                const padY = isVertical ? Math.max(25, overflow) : 25;

                const onDock = ex >= dax - padX && ex <= dax + daw + padX && ey >= day - padY && ey <= day + dah + padY;

                if (!onDock) return Clutter.EVENT_PROPAGATE;

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
                _clearTooltipDelay(dockActor);
                dockActor._tooltipHoveredIndex = -1;
                if (dockActor._magTooltip) {
                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.opacity = 0;
                    dockActor._magTooltip.hide();
                }
                return Clutter.EVENT_PROPAGATE;
            }

            if (evType !== Clutter.EventType.BUTTON_RELEASE) return Clutter.EVENT_PROPAGATE;
            if (dockActor._isDragging) return Clutter.EVENT_PROPAGATE;
            if (isAppGridOpen() || isContextMenuOpen()) return Clutter.EVENT_PROPAGATE;

            const hoverZoom = settings.get_boolean('hover-zoom');
            if (!hoverZoom) return Clutter.EVENT_PROPAGATE;

            const [ex, ey] = event.get_coords();
            const [dax, day] = dockActor.get_transformed_position();
            const [daw, dah] = dockActor.get_transformed_size();

            const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;
            const maxZoom = settings.get_double('hover-zoom-factor');
            const actualMaxZoom = 1.0 + (maxZoom - 1.0) * 2.0;
            const iconSize = settings.get_int('icon-size');
            const maxOverflow = iconSize * actualMaxZoom;

            const padX = isVertical ? 25 : Math.max(25, maxOverflow);
            const padY = isVertical ? Math.max(25, maxOverflow) : 25;

            if (ex < dax - padX || ex > dax + daw + padX || ey < day - padY || ey > day + dah + padY)
                return Clutter.EVENT_PROPAGATE;

            const btns = getDockButtons(dockActor);
            const n = btns.length;
            if (!n || actualMaxZoom <= 1.0) return Clutter.EVENT_PROPAGATE;

            const RADIUS = iconSize * 3.5;
            const scaleFactor = isVertical ? dockActor.scale_y : dockActor.scale_x;
            const localEx = (isVertical ? ey - day : ex - dax) / scaleFactor;

            const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
            const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;

            const slots = btns.map(b => isVertical ? (b.y + boxY) + b.height / 2 : (b.x + boxX) + b.width / 2).sort((a, b) => a - b);

            const scales = btns.map((b, i) => {
                if (b.style_class?.includes('dock-separator') || b.style_class?.includes('clock-module') || b.style_class?.includes('dock-drag-handle')) return 1.0;
                const dist = Math.abs(localEx - slots[i]);
                if (dist >= RADIUS) return 1.0;
                return 1.0 + (actualMaxZoom - 1.0) * ((Math.cos((dist / RADIUS) * Math.PI) + 1) / 2);
            });

            const scaledCenters = new Array(n);
            scaledCenters[0] = slots[0];
            for (let i = 1; i < n; i++) scaledCenters[i] = scaledCenters[i - 1] + (slots[i] - slots[i - 1]) * (scales[i] + scales[i - 1]) / 2;

            let mappedCursor = scaledCenters[0];
            if (n > 1) {
                if (localEx <= slots[0]) mappedCursor = scaledCenters[0] - (slots[0] - localEx);
                else if (localEx >= slots[n - 1]) mappedCursor = scaledCenters[n - 1] + (localEx - slots[n - 1]);
                else {
                    for (let i = 0; i < n - 1; i++) {
                        if (localEx >= slots[i] && localEx <= slots[i + 1]) {
                            mappedCursor = scaledCenters[i] + ((localEx - slots[i]) / (slots[i + 1] - slots[i])) * (scaledCenters[i + 1] - scaledCenters[i]);
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
                const btnW = btn.width, btnH = btn.height;
                const visCenterLocal = scaledCenters[i] + zoomOffset;

                let px = 0.5, py = 0.5;
                if (dockPos === 'BOTTOM') py = 1.0;
                else if (dockPos === 'TOP') py = 0.0;
                else if (dockPos === 'LEFT') px = 0.0;
                else if (dockPos === 'RIGHT') px = 1.0;

                let visCenterX = isVertical
                    ? dax + (boxX + btn.x + btnW * px) * dockActor.scale_x
                    : dax + visCenterLocal * dockActor.scale_x;
                let visCenterY = isVertical
                    ? day + visCenterLocal * dockActor.scale_y
                    : day + (boxY + btn.y + btnH * py) * dockActor.scale_y;

                const visLeft = visCenterX - btnW * scale * px * dockActor.scale_x;
                const visRight = visCenterX + btnW * scale * (1.0 - px) * dockActor.scale_x;
                const visTop = visCenterY - btnH * scale * py * dockActor.scale_y;
                const visBottom = visCenterY + btnH * scale * (1.0 - py) * dockActor.scale_y;

                if (ex >= visLeft && ex <= visRight && ey >= visTop && ey <= visBottom) {
                    if (btn._wasDragged) {
                        btn._wasDragged = false;
                        return Clutter.EVENT_STOP;
                    }

                    if (settings.get_boolean('lock-icons')) {
                        const dx = Math.abs(ex - (dockActor._globalPressX || ex));
                        const dy = Math.abs(ey - (dockActor._globalPressY || ey));
                        if (dx > 15 || dy > 15) return Clutter.EVENT_STOP;
                    }

                    dockActor._lastIconClickTime = Date.now();
                    _clearTooltipDelay(dockActor);
                    if (dockActor._magTooltip) {
                        dockActor._magTooltip.remove_all_transitions();
                        dockActor._magTooltip.opacity = 0;
                        dockActor._magTooltip.hide();
                    }

                    btn._activateCallback(event.get_button(), event.get_state());

                    if (dockActor._postClickTimerId) GLib.source_remove(dockActor._postClickTimerId);
                    dockActor._postClickTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                        dockActor._postClickTimerId = null;
                        if (isAppGridOpen()) resetMagnification(dockActor);
                        return GLib.SOURCE_REMOVE;
                    });

                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        } catch (e) {
            return Clutter.EVENT_PROPAGATE;
        }
    });
}

export function teardownMagnification(dockActor) {
    if (!dockActor) return;
    try {
        stopDragLoop(dockActor);

        if (dockActor._leaveCheckId) {
            GLib.source_remove(dockActor._leaveCheckId);
            dockActor._leaveCheckId = null;
        }

        if (dockActor._postClickTimerId) {
            GLib.source_remove(dockActor._postClickTimerId);
            dockActor._postClickTimerId = null;
        }

        if (dockActor._magMotionId) { dockActor.disconnect(dockActor._magMotionId); dockActor._magMotionId = null; }
        if (dockActor._magLeaveId) { dockActor.disconnect(dockActor._magLeaveId); dockActor._magLeaveId = null; }
        if (dockActor._magEnterId) { dockActor.disconnect(dockActor._magEnterId); dockActor._magEnterId = null; }

        if (dockActor._stageClickId) {
            global.stage.disconnect(dockActor._stageClickId);
            dockActor._stageClickId = null;
        }

        _clearTooltipDelay(dockActor);
        dockActor._tooltipHoveredIndex = -1;
        if (dockActor._magTooltip) {
            dockActor._magTooltip.destroy();
            dockActor._magTooltip = null;
        }

        dockActor._fixedSlots = null;
        dockActor._lastIconClickTime = null;
    } catch (e) { }
}

function easeOutCirc(t) {
    return Math.sqrt(1 - Math.pow(t - 1, 2));
}