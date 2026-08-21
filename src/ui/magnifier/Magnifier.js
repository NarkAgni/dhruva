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


import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import PeekManager from '../../core/PeekManager.js';
import { stopDragLoop } from './MagnifierDragLoop.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { isContextMenuOpen, isAppGridOpen } from './MagnifierState.js';
import { getDockButtons, getFixedSlots, easeOutCirc } from './MagnifierMath.js';
import { createTooltipActor, populateTooltipContent } from './MagnifierTooltipRenderer.js';
import { clearTooltipDelay, hideTooltip, isInsideTooltip, isPointerInDockTooltipBridge } from './MagnifierTooltip.js';


const FLIP_DURATION = 300;
const TOOLTIP_DELAY_MS = 600;

function isActorAlive(actor) {
    if (!actor) return false;
    return actor.visible !== undefined;
}

export function applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, now = null) {
    if (!dockActor || dockActor._isHidden || !dockActor.visible || dockActor._suppressZoom) {
        hideTooltip(dockActor);
        return;
    }

    const btns = getDockButtons(dockActor);
    const n = btns.length;
    if (!n || btns[0].width === 0) return;
    if (n > 1 && btns[0].x === btns[n - 1].x && btns[0].y === btns[n - 1].y) return;

    const isAppGrid = isAppGridOpen();
    const isMenu = isContextMenuOpen();

    if (isAppGrid || isMenu) {
        hideTooltip(dockActor);
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

        if (stale) dockActor._fixedSlots = null;
    }

    const slotModel = getFixedSlots(dockActor, isVertical, btns);
    if (!slotModel || !slotModel.orderedSlots || slotModel.orderedSlots.length !== n) return;

    const orderedSlots = slotModel.orderedSlots;
    const centersByBtn = slotModel.centersByBtn;
    const orderToBtn = slotModel.orderToBtn;
    const btnToOrder = slotModel.btnToOrder;

    if (!dockActor._scalesCache || dockActor._scalesCache.length !== n) {
        dockActor._scalesCache = new Array(n).fill(1.0);
        dockActor._scaledCentersCache = new Array(n).fill(0);
    }
    if (!dockActor._orderedScalesCache || dockActor._orderedScalesCache.length !== n) {
        dockActor._orderedScalesCache = new Array(n).fill(1.0);
    }
    if (!dockActor._orderedCentersCache || dockActor._orderedCentersCache.length !== n) {
        dockActor._orderedCentersCache = new Array(n).fill(0);
    }

    const scales = dockActor._scalesCache;
    const scaledCenters = dockActor._scaledCentersCache;
    const orderedScales = dockActor._orderedScalesCache;
    const orderedCenters = dockActor._orderedCentersCache;

    for (let orderIndex = 0; orderIndex < n; orderIndex++) {
        const btnIndex = orderToBtn[orderIndex];
        const b = btns[btnIndex];
        const sClass = b.get_style_class_name ? b.get_style_class_name() : (b.style_class || '');
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

        const sClassP = prevBtn.get_style_class_name ? prevBtn.get_style_class_name() : (prevBtn.style_class || '');
        const sClassC = currBtn.get_style_class_name ? currBtn.get_style_class_name() : (currBtn.style_class || '');

        const prevIsStatic = prevBtn._isStatic || sClassP.includes('dock-separator') || sClassP.includes('clock-module');
        const currIsStatic = currBtn._isStatic || sClassC.includes('dock-separator') || sClassC.includes('clock-module');

        if (currIsStatic && prevScale > 1.0) currExtra += (prevW * (prevScale - 1.0)) * 0.25;
        if (prevIsStatic && currScale > 1.0) prevExtra += (currW * (currScale - 1.0)) * 0.25;

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
    let leftExp = 0, rightExp = 0, topExp = 0, botExp = 0;

    if (zoomEnabled) {
        let minVis = Infinity, maxVis = -Infinity, origMin = Infinity, origMax = -Infinity;
        for (let i = 0; i < n; i++) {
            if (btns[i].style_class && (btns[i].style_class.includes('clock-module') || btns[i].style_class.includes('dock-drag-handle'))) continue;
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
        const zoomTrans = zoomEnabled ? (scaledCenters[i] + zoomOffset) - centersByBtn[i] : 0;

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
        const appBox = b.get_child ? b.get_child() : null;
        if (appBox && appBox.get_children) {
            appBox.get_children().forEach(c => {
                if (c._isIndicator) {
                    c.remove_transition('scale_x');
                    c.remove_transition('scale_y');
                    c.remove_transition('translation_x');
                    c.remove_transition('translation_y');

                    let px = 0.5, py = 0.5;
                    const pos = settings.get_string('dock-position');
                    if (pos === 'BOTTOM') py = 1.0;
                    else if (pos === 'TOP') py = 0.0;
                    else if (pos === 'LEFT') px = 0.0;
                    else if (pos === 'RIGHT') px = 1.0;

                    c.set_pivot_point(px, py);

                    if (zoomEnabled) {
                        const antiScale = 1.0 / smoothScale;
                        c.scale_x = antiScale;
                        c.scale_y = antiScale;
                        c.translation_x = (c._baseTx || 0) * antiScale;
                        c.translation_y = (c._baseTy || 0) * antiScale;
                    }
                } else {
                    c.remove_transition('translation_x');
                    c.remove_transition('translation_y');
                    if (zoomEnabled) {
                        c.translation_x = (c._baseTx || 0);
                        c.translation_y = (c._baseTy || 0);
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
    }

    if (isAppGrid || isMenu || !settings.get_boolean('show-apps-preview')) {
        hideTooltip(dockActor);
        return;
    }

    let closestIndex = -1;
    let minDiff = Infinity;
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

        if (btn._delegate && btn._delegate.isFolder) appName = btn._delegate.folderData.name;
        else if (btn._delegate && btn._delegate.app) appName = btn._delegate.app.get_name();
        else if (btn.get_child && btn.get_child() && btn.get_child().has_style_class_name && btn.get_child().has_style_class_name('dock-grid-icon')) appName = 'Applications';

        if (appName) {
            if (dockActor._tooltipHoveredIndex !== closestIndex) {
                clearTooltipDelay(dockActor);
                if (dockActor._magTooltip) {
                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.opacity = 0;
                    dockActor._magTooltip.hide();
                }
                dockActor._tooltipHoveredIndex = closestIndex;
                dockActor._magTooltipAppId = null;

                if (dockActor._tooltipDelayId && dockActor._magTimers) {
                    dockActor._magTimers.remove(dockActor._tooltipDelayId);
                }
                
                const showTooltip = () => {
                    dockActor._tooltipDelayId = null;
                    dockActor._tooltipReady = true;
                    const [pcx, pcy] = global.get_pointer();
                    applyRealtimeFrame(dockActor, pcx, pcy, isVertical, settings, Date.now());
                    return GLib.SOURCE_REMOVE;
                };

                if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
                dockActor._tooltipDelayId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, showTooltip);
            }

            if (!dockActor._magTooltip) {
                const { tooltip, tooltipBg, tooltipBox } = createTooltipActor();
                dockActor._magTooltip = tooltip;
                dockActor._magTooltipBg = tooltipBg;
                dockActor._magTooltipBox = tooltipBox;

                dockActor._magTooltip.connectObject('enter-event', () => {
                    if (dockActor._leaveCheckId && dockActor._magTimers) {
                        dockActor._magTimers.remove(dockActor._leaveCheckId);
                        dockActor._leaveCheckId = null;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, dockActor._magTooltip);

                dockActor._magTooltip.connectObject('leave-event', () => {
                    _checkPointerLeave(dockActor, settings);
                    return Clutter.EVENT_PROPAGATE;
                }, dockActor._magTooltip);

                Main.layoutManager.uiGroup.add_child(dockActor._magTooltip);
                
                if (!dockActor._magDestroyHandlerId) {
                    dockActor._magDestroyHandlerId = dockActor.connectObject('destroy', () => {
                        if (dockActor._magTooltip) {
                            dockActor._magTooltip.destroy();
                            dockActor._magTooltip = null;
                        }
                        if (dockActor._magPeekManager) {
                            dockActor._magPeekManager.destroy();
                            dockActor._magPeekManager = null;
                        }
                        dockActor._magDestroyHandlerId = null;
                    }, dockActor);
                }
            }

            if (!dockActor._magPeekManager && dockActor._dockUI) {
                dockActor._magPeekManager = new PeekManager(dockActor._dockUI, Main.layoutManager.uiGroup);
            }

            const delegate = btn._delegate || {};
            let appId;
            if (delegate.app) {
                appId = delegate.app.get_id ? delegate.app.get_id() : delegate.app.get_name();
            } else if (delegate.isFolder) {
                appId = delegate.folderData.id;
            } else {
                appId = appName;
            }

            if (dockActor._tooltipReady && dockActor._magTooltipAppId !== appId) {
                dockActor._magTooltipAppId = appId;
                populateTooltipContent(dockActor, btn, appName, settings);
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

                let tx = 0, ty = 0;
                const btnClass = btn.get_style_class_name ? btn.get_style_class_name() : (btn.style_class || '');
                const gap = (btnClass.includes('clock-module') || appName === 'Date & Time') ? 24 : 24;

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
                    const sibling = dockActor._dockUI.actor;
                    if (sibling && sibling.get_parent && sibling.get_parent() === parent) {
                        parent.set_child_below_sibling(dockActor._magTooltip, sibling);
                    }
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
        const keepTooltipAlive = isInsideTooltip(dockActor, cx, cy, 24) || isPointerInDockTooltipBridge(dockActor, cx, cy, settings);
        if (!keepTooltipAlive) hideTooltip(dockActor);
    }
}

export function resetMagnification(dockActor, suppressForMs = 0) {
    if (!isActorAlive(dockActor)) return;

    if (suppressForMs > 0) {
        dockActor._suppressZoom = true;
        if (dockActor._suppressTimeoutId && dockActor._magTimers) {
            dockActor._magTimers.remove(dockActor._suppressTimeoutId);
        }
        
        const removeSuppress = () => {
            dockActor._suppressZoom = false;
            dockActor._suppressTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        };

        if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
        dockActor._suppressTimeoutId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, suppressForMs, removeSuppress);
    }

    stopDragLoop(dockActor);
    dockActor._lastMagMotionFrameTs = 0;
    dockActor._fixedSlots = null;
    hideTooltip(dockActor);

    if (dockActor._postClickTimerId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._postClickTimerId);
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

            const appBox = btn.get_child ? btn.get_child() : null;
            if (isActorAlive(appBox) && appBox.get_children) {
                appBox.get_children().forEach(c => {
                    if (c._isIndicator && isActorAlive(c)) {
                        c.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            translation_x: c._baseTx || 0,
                            translation_y: c._baseTy || 0,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
                    } else if (isActorAlive(c)) {
                        c.ease({
                            translation_x: c._baseTx || 0,
                            translation_y: c._baseTy || 0,
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
}

function _checkPointerLeave(dockActor, settings) {
    if (dockActor._leaveCheckId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._leaveCheckId);
    }

    const checkLeave = () => {
        if (isContextMenuOpen() || dockActor._isDragging || dockActor._launchingApp) {
            dockActor._leaveCheckId = null;
            return GLib.SOURCE_REMOVE;
        }

        const [px, py] = global.get_pointer();
        const [dax, day] = dockActor.get_transformed_position();
        const daw = dockActor._cachedW || dockActor.width || 0;
        const dah = dockActor._cachedH || dockActor.height || 0;

        const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;

        let boundsLeft = dax, boundsRight = dax + daw, boundsTop = day, boundsBottom = day + dah;
        if (dockActor.bgActor) {
            const [bx, by] = dockActor.bgActor.get_transformed_position();
            const [bw, bh] = dockActor.bgActor.get_transformed_size();
            boundsLeft = Math.min(boundsLeft, bx);
            boundsRight = Math.max(boundsRight, bx + bw);
            boundsTop = Math.min(boundsTop, by);
            boundsBottom = Math.max(boundsBottom, by + bh);
        }
        
        const basePadX = isVertical ? 15 : 20;
        const basePadY = isVertical ? 20 : 15;
        const inBaseBounds = px >= boundsLeft - basePadX && px <= boundsRight + basePadX && py >= boundsTop - basePadY && py <= boundsBottom + basePadY;

        let inZoomedBounds = false;
        if (!inBaseBounds) {
            const btns = getDockButtons(dockActor);
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i];
                if (btn.scale_x > 1.05 || btn.scale_y > 1.05) {
                    const [bx, by] = btn.get_transformed_position();
                    const [bw, bh] = btn.get_transformed_size();
                    if (px >= bx - 5 && px <= bx + bw + 5 && py >= by - 5 && py <= by + bh + 5) {
                        inZoomedBounds = true;
                        break;
                    }
                }
            }
        }
        const inside = inBaseBounds || inZoomedBounds;
        
        const insideTooltip = isInsideTooltip(dockActor, px, py, 24);
        const insideBridge = isPointerInDockTooltipBridge(dockActor, px, py, settings);

        if (!inside && !insideTooltip && !insideBridge) {
            resetMagnification(dockActor);
            dockActor._leaveCheckId = null;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    };

    if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
    dockActor._leaveCheckId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, 30, checkLeave);
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

    dockActor._magEnterId = dockActor.connectObject('enter-event', () => {
        if (!isActorAlive(dockActor)) return;
        if (dockActor._leaveCheckId && dockActor._magTimers) {
            dockActor._magTimers.remove(dockActor._leaveCheckId);
            dockActor._leaveCheckId = null;
        }
        if (!dockActor._isDragging) {
            dockActor._fixedSlots = null;
        }
    }, dockActor);

    dockActor._magLeaveId = dockActor.connectObject('leave-event', () => {
        if (!isActorAlive(dockActor) || isContextMenuOpen() || dockActor._isDragging) return;
        _checkPointerLeave(dockActor, settings);
    }, dockActor);

    dockActor._stageClickId = global.stage.connectObject('captured-event', (_stage, event) => {
        if (!isActorAlive(dockActor) || dockActor._isHidden) return Clutter.EVENT_PROPAGATE;
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

            let boundsLeft = dax, boundsRight = dax + daw, boundsTop = day, boundsBottom = day + dah;
            if (dockActor.bgActor) {
                const [bx, by] = dockActor.bgActor.get_transformed_position();
                const [bw, bh] = dockActor.bgActor.get_transformed_size();
                boundsLeft = Math.min(boundsLeft, bx);
                boundsRight = Math.max(boundsRight, bx + bw);
                boundsTop = Math.min(boundsTop, by);
                boundsBottom = Math.max(boundsBottom, by + bh);
            }

            const isVertical = dockActor.boxActor ? dockActor.boxActor.get_vertical() : false;

            const basePadX = isVertical ? 15 : 20;
            const basePadY = isVertical ? 20 : 15;
            const inBaseBounds = ex >= boundsLeft - basePadX && ex <= boundsRight + basePadX && ey >= boundsTop - basePadY && ey <= boundsBottom + basePadY;

            let inZoomedBounds = false;
            if (!inBaseBounds) {
                const btns = getDockButtons(dockActor);
                for (let i = 0; i < btns.length; i++) {
                    const btn = btns[i];
                    if (btn.scale_x > 1.05 || btn.scale_y > 1.05) {
                        const [bx, by] = btn.get_transformed_position();
                        const [bw, bh] = btn.get_transformed_size();
                        if (ex >= bx - 5 && ex <= bx + bw + 5 && ey >= by - 5 && ey <= by + bh + 5) {
                            inZoomedBounds = true;
                            break;
                        }
                    }
                }
            }
            const onDock = inBaseBounds || inZoomedBounds;
            
            const insideTooltip = isInsideTooltip(dockActor, ex, ey, 24);
            const insideBridge = isPointerInDockTooltipBridge(dockActor, ex, ey, settings);
            const pos = settings.get_string('dock-position') || 'BOTTOM';

            if (!onDock && !insideTooltip && !insideBridge) return Clutter.EVENT_PROPAGATE;
            if (insideTooltip || insideBridge) {
                dockActor._tooltipBridgeActive = true;
                return Clutter.EVENT_PROPAGATE;
            }

            if (pos === 'BOTTOM' && onDock && dockActor._tooltipBridgeActive && dockActor._magTooltip && dockActor._magTooltip.visible) {
                hideTooltip(dockActor);
                return Clutter.EVENT_PROPAGATE;
            }
            dockActor._tooltipBridgeActive = false;

            if (isContextMenuOpen() || isAppGridOpen()) {
                clearTooltipDelay(dockActor);
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

            if (!isInsideTooltip(dockActor, px, py, 20)) {
                clearTooltipDelay(dockActor);
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

        let boundsLeft = dax, boundsRight = dax + daw, boundsTop = day, boundsBottom = day + dah;
        if (dockActor.bgActor) {
            const [bx, by] = dockActor.bgActor.get_transformed_position();
            const [bw, bh] = dockActor.bgActor.get_transformed_size();
            boundsLeft = Math.min(boundsLeft, bx);
            boundsRight = Math.max(boundsRight, bx + bw);
            boundsTop = Math.min(boundsTop, by);
            boundsBottom = Math.max(boundsBottom, by + bh);
        }
        
        const basePadX = isVertical ? 15 : 20;
        const basePadY = isVertical ? 20 : 15;
        const inBaseBounds = ex >= boundsLeft - basePadX && ex <= boundsRight + basePadX && ey >= boundsTop - basePadY && ey <= boundsBottom + basePadY;

        let inZoomedBounds = false;
        if (!inBaseBounds) {
            const btns = getDockButtons(dockActor);
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i];
                if (btn.scale_x > 1.05 || btn.scale_y > 1.05) {
                    const [bx, by] = btn.get_transformed_position();
                    const [bw, bh] = btn.get_transformed_size();
                    if (ex >= bx - 5 && ex <= bx + bw + 5 && ey >= by - 5 && ey <= by + bh + 5) {
                        inZoomedBounds = true;
                        break;
                    }
                }
            }
        }

        if (!inBaseBounds && !inZoomedBounds) return Clutter.EVENT_PROPAGATE;

        const invokeButton = (targetBtn) => {
            if (!targetBtn || !targetBtn._activateCallback) return false;

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
            clearTooltipDelay(dockActor);
            if (dockActor._magTooltip) {
                dockActor._magTooltip.remove_all_transitions();
                dockActor._magTooltip.opacity = 0;
                dockActor._magTooltip.hide();
            }

            targetBtn._activateCallback(buttonNum, event.get_state());
            if (buttonNum === 1) resetMagnification(dockActor, 800);

            if (dockActor._postClickTimerId && dockActor._magTimers) {
                dockActor._magTimers.remove(dockActor._postClickTimerId);
            }
            
            const postClick = () => {
                dockActor._postClickTimerId = null;
                if (isAppGridOpen()) resetMagnification(dockActor);
                return GLib.SOURCE_REMOVE;
            };

            if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
            dockActor._postClickTimerId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, 150, postClick);
            return true;
        };

        const btns = getDockButtons(dockActor);
        const n = btns.length;
        if (!n) return Clutter.EVENT_PROPAGATE;

        for (let i = n - 1; i >= 0; i--) {
            const btn = btns[i];
            if (!btn || !btn._activateCallback) continue;
            const [bx, by] = btn.get_transformed_position();
            const [bw, bh] = btn.get_transformed_size();
            if (bw <= 0 || bh <= 0) continue;
            if (ex >= bx && ex <= bx + bw && ey >= by && ey <= by + bh) {
                if (invokeButton(btn)) return Clutter.EVENT_STOP;
            }
        }

        const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, ex, ey);
        let cur = picked;
        let hops = 0;
        while (cur && hops < 12) {
            if (cur._activateCallback) {
                if (invokeButton(cur)) return Clutter.EVENT_STOP;
            }
            cur = cur.get_parent ? cur.get_parent() : null;
            hops++;
        }

        if (!n || actualMaxZoom <= 1.0) return Clutter.EVENT_PROPAGATE;

        const RADIUS = settings.get_int('icon-size') * 3.5;
        const scaleFactor = isVertical ? dockActor.scale_y : dockActor.scale_x;
        const localEx = (isVertical ? ey - day : ex - dax) / scaleFactor;
        const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
        const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;
        const slotModel = getFixedSlots(dockActor, isVertical, btns);
        if (!slotModel || !slotModel.orderedSlots || slotModel.orderedSlots.length !== n) return Clutter.EVENT_PROPAGATE;

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
            const sClass = b.get_style_class_name ? b.get_style_class_name() : (b.style_class || '');
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

            const sClassP = prevBtn.get_style_class_name ? prevBtn.get_style_class_name() : (prevBtn.style_class || '');
            const sClassC = currBtn.get_style_class_name ? currBtn.get_style_class_name() : (currBtn.style_class || '');

            const prevIsStatic = prevBtn._isStatic || sClassP.includes('dock-separator') || sClassP.includes('clock-module');
            const currIsStatic = currBtn._isStatic || sClassC.includes('dock-separator') || sClassC.includes('clock-module');

            if (currIsStatic && prevScale > 1.0) currExtra += (prevW * (prevScale - 1.0)) * 0.25;
            if (prevIsStatic && currScale > 1.0) prevExtra += (currW * (currScale - 1.0)) * 0.25;

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
            let px = 0.5, py = 0.5;
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
    }, dockActor);
}

export function teardownMagnification(dockActor, skipReset = false) {
    if (!dockActor) return;

    if (dockActor._leaveCheckId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._leaveCheckId);
        dockActor._leaveCheckId = null;
    }

    if (dockActor._postClickTimerId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._postClickTimerId);
        dockActor._postClickTimerId = null;
    }
    
    if (dockActor._magTimers) {
        dockActor._magTimers.destroy();
        dockActor._magTimers = null;
    }

    stopDragLoop(dockActor);

    dockActor._lastMagMotionFrameTs = 0;

    if (isActorAlive(dockActor)) {
        if (dockActor._magMotionId) dockActor.disconnectObject(dockActor._magMotionId);
        dockActor._magMotionId = null;

        if (dockActor._magLeaveId) dockActor.disconnectObject(dockActor._magLeaveId);
        dockActor._magLeaveId = null;

        if (dockActor._magEnterId) dockActor.disconnectObject(dockActor._magEnterId);
        dockActor._magEnterId = null;
    } else {
        dockActor._magMotionId = null;
        dockActor._magLeaveId = null;
        dockActor._magEnterId = null;
    }

    if (dockActor._stageClickId) {
        global.stage.disconnectObject(dockActor);
        dockActor._stageClickId = null;
    }

    clearTooltipDelay(dockActor);
    dockActor._tooltipHoveredIndex = -1;

    if (isActorAlive(dockActor)) {
        if (dockActor._magDestroyHandlerId) dockActor.disconnectObject(dockActor);
    }
    dockActor._magDestroyHandlerId = null;

    if (dockActor._magTooltip) {
        dockActor._magTooltip.destroy();
        dockActor._magTooltip = null;
    }

    if (dockActor._magPeekManager) {
        dockActor._magPeekManager.destroy();
        dockActor._magPeekManager = null;
    }

    if (!skipReset && isActorAlive(dockActor)) {
        resetMagnification(dockActor);
    }

    dockActor._fixedSlots = null;
    dockActor._lastIconClickTime = null;
}