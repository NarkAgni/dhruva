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
import { getDockButtons, isPointerWithinDockBounds, isPointerInIconCorridor, isPointerOnPanelItems, syncPanelSidesToBackground } from './MagnifierMath.js';
import { resetMagnification, teardownMagnification } from './MagnifierReset.js';
import { clearTooltipDelay, hideTooltip, isInsideTooltip, isPointerInDockTooltipBridge } from './MagnifierTooltip.js';


const TOOLTIP_EXIT_PAD = 4;
const TOOLTIP_WATCH_MS = 50;


function _watchTooltipPointer(dockActor, settings) {
    if (dockActor._tooltipWatchId) return;
    if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();

    dockActor._tooltipWatchId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, TOOLTIP_WATCH_MS, () => {
        const tooltip = dockActor._magTooltip;
        if (!isActorAlive(dockActor) || !tooltip || !tooltip.visible) {
            dockActor._tooltipWatchId = null;
            return GLib.SOURCE_REMOVE;
        }
        if (dockActor._isDragging || isContextMenuOpen()) return GLib.SOURCE_CONTINUE;

        const [px, py] = global.get_pointer();
        const isVertical = getBoxVertical(dockActor.boxActor);
        const isNear = isPointerWithinDockBounds(dockActor, px, py, isVertical, settings) ||
            isInsideTooltip(dockActor, px, py, TOOLTIP_EXIT_PAD) ||
            isPointerInDockTooltipBridge(dockActor, px, py, settings);
        if (isNear) return GLib.SOURCE_CONTINUE;

        dockActor._tooltipWatchId = null;
        hideTooltip(dockActor);
        if (!dockActor._isResetting) {
            dockActor._isResetting = true;
            resetMagnification(dockActor, 180);
        }
        return GLib.SOURCE_REMOVE;
    });
}


function _checkPointerLeave(dockActor, settings) {
    if (dockActor._leaveCheckId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._leaveCheckId);
        dockActor._leaveCheckId = null;
    }

    if (dockActor._isResetting) return;

    const isVertical = getBoxVertical(dockActor.boxActor);
    const coords = global.get_pointer();
    const px = coords[0];
    const py = coords[1];
    const onDock = isPointerWithinDockBounds(dockActor, px, py, isVertical, settings);
    const insideTooltip = isInsideTooltip(dockActor, px, py, TOOLTIP_EXIT_PAD);
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

        const currentCoords = global.get_pointer();
        const cx = currentCoords[0];
        const cy = currentCoords[1];
        const stillInside = isPointerWithinDockBounds(dockActor, cx, cy, isVertical, settings);
        const stillInsideTooltip = isInsideTooltip(dockActor, cx, cy, TOOLTIP_EXIT_PAD);
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
    dockActor._tooltipWatchId = null;
    if (!isActorAlive(dockActor)) return;

    dockActor._lastMagMotionFrameTs = 0;
    const dockPos = dockPositionGetter();

    const initialBtns = getDockButtons(dockActor);
    for (let i = 0; i < initialBtns.length; i++) {
        const btn = initialBtns[i];
        if (!isActorAlive(btn)) continue;
        if (dockPos === 'BOTTOM') btn.set_pivot_point(0.5, 1.0);
        else if (dockPos === 'TOP') btn.set_pivot_point(0.5, 0.0);
        else if (dockPos === 'LEFT') btn.set_pivot_point(0.0, 0.5);
        else if (dockPos === 'RIGHT') btn.set_pivot_point(1.0, 0.5);
    }

    if (isActorAlive(dockActor.bgActor)) {
        dockActor.bgActor.connectObject('notify::allocation', () => syncPanelSidesToBackground(dockActor), dockActor);
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

    global.stage.connectObject('captured-event', (_stage, event) => {
        if (!isActorAlive(dockActor) || dockActor._isAutohiding) return Clutter.EVENT_PROPAGATE;
        const evType = event.type();

        if (evType === Clutter.EventType.MOTION) {
            if (dockActor._isDragging) return Clutter.EVENT_PROPAGATE;
            if ((event.get_state() & Clutter.ModifierType.BUTTON1_MASK) !== 0) return Clutter.EVENT_PROPAGATE;

            const frameNow = Date.now();
            const minFrameGap = 7;
            if (dockActor._lastMagMotionFrameTs && (frameNow - dockActor._lastMagMotionFrameTs) < minFrameGap) {
                return Clutter.EVENT_PROPAGATE;
            }
            dockActor._lastMagMotionFrameTs = frameNow;

            const motionCoords = event.get_coords();
            const ex = motionCoords[0];
            const ey = motionCoords[1];
            const isVertical = getBoxVertical(dockActor.boxActor);
            const onDock = isPointerWithinDockBounds(dockActor, ex, ey, isVertical, settings);

            const insideTooltip = isInsideTooltip(dockActor, ex, ey, TOOLTIP_EXIT_PAD);
            const insideBridge = isPointerInDockTooltipBridge(dockActor, ex, ey, settings);
            const pos = Settings.dockPosition || 'BOTTOM';
            if (dockActor._magTooltip && dockActor._magTooltip.visible) _watchTooltipPointer(dockActor, settings);

            if (!onDock && !insideTooltip && !insideBridge) {
                if (dockActor._isPointerAway) return Clutter.EVENT_PROPAGATE;
                dockActor._isPointerAway = true;
                dockActor._tooltipBridgeActive = false;
                hideTooltip(dockActor);
                _checkPointerLeave(dockActor, settings);
                return Clutter.EVENT_PROPAGATE;
            }
            dockActor._isPointerAway = false;

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

            if (!isPointerInIconCorridor(dockActor, ex, ey, isVertical)) {
                hideTooltip(dockActor);
                if (!dockActor._isMagnifierResetDone) {
                    dockActor._isMagnifierResetDone = true;
                    resetMagnification(dockActor, 180, false);
                }
                return Clutter.EVENT_PROPAGATE;
            }

            dockActor._isMagnifierResetDone = false;
            applyRealtimeFrame(dockActor, ex, ey, isVertical, settings, Date.now());
            return Clutter.EVENT_PROPAGATE;
        }

        if (evType === Clutter.EventType.BUTTON_PRESS) {
            const pressCoords = event.get_coords();
            const px = pressCoords[0];
            const py = pressCoords[1];
            dockActor._globalPressX = px;
            dockActor._globalPressY = py;
            dockActor._lastIconClickTime = Date.now();
            dockActor._pressStartedOnDock = isPointerWithinDockBounds(dockActor, px, py, getBoxVertical(dockActor.boxActor), settings);

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

        const pressStartedOnDock = dockActor._pressStartedOnDock;
        dockActor._pressStartedOnDock = false;

        if (!pressStartedOnDock) return Clutter.EVENT_PROPAGATE;
        if (dockActor._isDragging || isAppGridOpen() || isContextMenuOpen()) return Clutter.EVENT_PROPAGATE;
        if (!Settings.hoverZoom) return Clutter.EVENT_PROPAGATE;

        const releaseCoords = event.get_coords();
        const ex = releaseCoords[0];
        const ey = releaseCoords[1];
        const buttonNum = event.get_button();
        const isVertical = getBoxVertical(dockActor.boxActor);

        if (!isPointerWithinDockBounds(dockActor, ex, ey, isVertical, settings) || isPointerOnPanelItems(dockActor, ex, ey)) {
            return Clutter.EVENT_PROPAGATE;
        }

        const pill = (dockActor._dockUI && dockActor._dockUI._musicPill) ? dockActor._dockUI._musicPill : null;
        if (pill && isActorAlive(pill) && pill.visible) {
            const targetActor = global.stage.get_event_actor(event);
            if (targetActor && (targetActor === pill || (pill.contains && pill.contains(targetActor)))) {
                return Clutter.EVENT_PROPAGATE;
            }
            const pillPos = pill.get_transformed_position();
            const pillSize = pill.get_transformed_size();
            if (ex >= pillPos[0] && ex <= pillPos[0] + pillSize[0] &&
                ey >= pillPos[1] && ey <= pillPos[1] + pillSize[1]) {
                return Clutter.EVENT_PROPAGATE;
            }
        }

        const invokeButton = (targetBtn) => {
            if (!targetBtn || !targetBtn._activateCallback) return false;

            if (targetBtn._wasDragged) {
                targetBtn._wasDragged = false;
                return true;
            }

            if (Settings.lockIcons) {
                const pressX = dockActor._globalPressX || ex;
                const pressY = dockActor._globalPressY || ey;
                const dx = Math.abs(ex - pressX);
                const dy = Math.abs(ey - pressY);
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

        let closestBtn = null;
        let minDistance = Infinity;

        for (let i = 0; i < n; i++) {
            const btn = btns[i];
            if (!btn || !btn._activateCallback || !isActorAlive(btn) || !btn.visible) continue;

            const pos = btn.get_transformed_position();
            const bx = pos[0];
            const by = pos[1];
            const sz = btn.get_transformed_size();
            const bw = sz[0];
            const bh = sz[1];
            if (bw <= 0 || bh <= 0) continue;

            const centerX = bx + bw / 2;
            const centerY = by + bh / 2;

            const dist = isVertical ? Math.abs(ey - centerY) : Math.abs(ex - centerX);
            const crossDist = isVertical ? Math.abs(ex - centerX) : Math.abs(ey - centerY);
            const maxCross = (isVertical ? bw : bh) / 2 + 20;

            if (crossDist <= maxCross && dist < minDistance) {
                minDistance = dist;
                closestBtn = btn;
            }
        }

        if (closestBtn) {
            invokeButton(closestBtn);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }, dockActor);
}