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

import { Settings } from '../../core/SettingsManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { applyRealtimeFrame } from './MagnifierFrameEngine.js';
import { isActorAlive, getBoxVertical } from '../../core/Utils.js';
import { isContextMenuOpen, isAppGridOpen } from './MagnifierState.js';
import { resetMagnification, teardownMagnification } from './MagnifierReset.js';
import { getDockButtons, getFixedSlots, isPointerWithinDockBounds } from './MagnifierMath.js';
import { clearTooltipDelay, hideTooltip, isInsideTooltip, isPointerInDockTooltipBridge } from './MagnifierTooltip.js';


function _checkPointerLeave(dockActor, settings) {
    if (dockActor._leaveCheckId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._leaveCheckId);
        dockActor._leaveCheckId = null;
    }

    if (dockActor._isResetting) return;

    const isVertical = getBoxVertical(dockActor.boxActor);
    const [px, py] = global.get_pointer();
    const onDock = isPointerWithinDockBounds(dockActor, px, py, isVertical, settings);
    const insideTooltip = isInsideTooltip(dockActor, px, py, 16);
    const insideBridge = isPointerInDockTooltipBridge(dockActor, px, py, settings);

    if (!onDock && !insideTooltip && !insideBridge) {
        dockActor._isResetting = true;
        resetMagnification(dockActor, 180);
        return;
    }

    let attempts = 0;
    const checkLeave = () => {
        if (!isActorAlive(dockActor)) {
            dockActor._leaveCheckId = null;
            return GLib.SOURCE_REMOVE;
        }

        if (isContextMenuOpen() || dockActor._isDragging || dockActor._launchingApp) {
            dockActor._leaveCheckId = null;
            return GLib.SOURCE_REMOVE;
        }

        const [cx, cy] = global.get_pointer();
        const stillInside = isPointerWithinDockBounds(dockActor, cx, cy, isVertical, settings);
        const stillInsideTooltip = isInsideTooltip(dockActor, cx, cy, 16);
        const stillInsideBridge = isPointerInDockTooltipBridge(dockActor, cx, cy, settings);

        if (!stillInside && !stillInsideTooltip && !stillInsideBridge) {
            dockActor._leaveCheckId = null;
            if (!dockActor._isResetting) {
                dockActor._isResetting = true;
                resetMagnification(dockActor, 180);
            }
            return GLib.SOURCE_REMOVE;
        }

        attempts++;
        if (attempts > 12) {
            dockActor._leaveCheckId = null;
            return GLib.SOURCE_REMOVE;
        }

        return GLib.SOURCE_CONTINUE;
    };

    if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
    dockActor._leaveCheckId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, 16, checkLeave);
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

    dockActor.connectObject('leave-event', () => {
        _checkPointerLeave(dockActor, settings);
        return Clutter.EVENT_PROPAGATE;
    }, dockActor);

    if (isActorAlive(dockActor.boxActor)) {
        dockActor.boxActor.connectObject('leave-event', () => {
            _checkPointerLeave(dockActor, settings);
            return Clutter.EVENT_PROPAGATE;
        }, dockActor);
    }

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
            const isVertical = getBoxVertical(dockActor.boxActor);
            const onDock = isPointerWithinDockBounds(dockActor, ex, ey, isVertical, settings);

            const insideTooltip = isInsideTooltip(dockActor, ex, ey, 20);
            const insideBridge = isPointerInDockTooltipBridge(dockActor, ex, ey, settings);
            const pos = Settings.dockPosition || 'BOTTOM';

            if (!onDock && !insideTooltip && !insideBridge) {
                _checkPointerLeave(dockActor, settings);
                return Clutter.EVENT_PROPAGATE;
            }

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
        if (!Settings.hoverZoom) return Clutter.EVENT_PROPAGATE;

        const [ex, ey] = event.get_coords();
        const buttonNum = event.get_button();
        const [dax, day] = dockActor.get_transformed_position();

        const isVertical = getBoxVertical(dockActor.boxActor);
        const actualMaxZoom = 1.0 + (Settings.hoverZoomFactor - 1.0) * 2.0;

        if (!isPointerWithinDockBounds(dockActor, ex, ey, isVertical, settings)) {
            return Clutter.EVENT_PROPAGATE;
        }

        const invokeButton = (targetBtn) => {
            if (!targetBtn || !targetBtn._activateCallback) return false;

            if (targetBtn._wasDragged) {
                targetBtn._wasDragged = false;
                return true;
            }

            if (Settings.lockIcons) {
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
            
            if (buttonNum === 1) {
                resetMagnification(dockActor, 320, true);
            }

            if (dockActor._postClickTimerId && dockActor._magTimers) {
                dockActor._magTimers.remove(dockActor._postClickTimerId);
            }

            const postClick = () => {
                dockActor._postClickTimerId = null;
                if (isAppGridOpen()) resetMagnification(dockActor, 150, true);
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

        const RADIUS = Settings.iconSize * 3.5;
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
        const dockPos = Settings.dockPosition || 'BOTTOM';

        for (let i = 0; i < n; i++) {
            const btn = btns[i];
            if (!btn._activateCallback) continue;

            const scale = scales[i];
            let px = 0.5;
            let py = 0.5;
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