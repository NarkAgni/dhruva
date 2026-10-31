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

import { isActorAlive } from '../../core/Utils.js';
import { getDockButtons } from './MagnifierMath.js';
import { isFullBarLayout } from '../../core/LayoutMode.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { clearTooltipDelay, hideTooltip } from './MagnifierTooltip.js';


export function resetMagnification(dockActor, duration = 200, lockEngine = false) {
    if (!isActorAlive(dockActor)) return;

    dockActor._isZoomActive = false;
    dockActor._magNeedsFrames = false;
    dockActor._magMotionPending = false;

    hideTooltip(dockActor);
    clearTooltipDelay(dockActor);

    if (lockEngine) {
        dockActor._suppressZoom = true;
        if (dockActor._suppressTimerId && dockActor._magTimers) {
            dockActor._magTimers.remove(dockActor._suppressTimerId);
        }
        if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
        dockActor._suppressTimerId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, duration + 80, () => {
            dockActor._suppressTimerId = null;
            dockActor._suppressZoom = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    dockActor._scalesCache = null;
    dockActor._scalesYCache = null;
    dockActor._scaledCentersCache = null;
    dockActor._riseOffsetsCache = null;
    dockActor._orderedScalesCache = null;
    dockActor._orderedCentersCache = null;
    dockActor._angleZCache = null;
    dockActor._angleYCache = null;
    dockActor._angleXCache = null;
    dockActor._magOffsetsCache = null;
    dockActor._pointerState = null;
    dockActor._prevPointerPos = null;

    const btns = (dockActor._dockUI && dockActor._dockUI._actorRegistry && dockActor._dockUI._actorRegistry.size > 0)
        ? Array.from(dockActor._dockUI._actorRegistry.values()).map(e => e.actor).filter(Boolean)
        : getDockButtons(dockActor);

    for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        if (!isActorAlive(b)) continue;

        b.remove_all_transitions();
        b._flipOffset = 0;
        b._flipStartTime = null;

        b.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            translation_x: 0,
            translation_y: 0,
            rotation_angle_z: 0,
            rotation_angle_y: 0,
            rotation_angle_x: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });

        const appBox = b.get_child ? b.get_child() : null;
        if (appBox && appBox.get_children) {
            const kids = appBox.get_children();
            for (let j = 0; j < kids.length; j++) {
                const c = kids[j];
                if (!isActorAlive(c)) continue;
                c.remove_all_transitions();

                c.rotation_angle_z = 0;
                c.rotation_angle_y = 0;
                c.rotation_angle_x = 0;

                if (c._isIndicator) {
                    c.ease({
                        scale_x: c._baseScaleX !== undefined ? c._baseScaleX : 1.0,
                        scale_y: c._baseScaleY !== undefined ? c._baseScaleY : 1.0,
                        translation_x: c._baseTx || 0,
                        translation_y: c._baseTy || 0,
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                } else if (c._isHoverBg) {
                    const targetSx = c._baseScaleX ? c._baseScaleX : 1.0;
                    const targetSy = c._baseScaleY ? c._baseScaleY : 1.0;
                    c.ease({
                        scale_x: targetSx,
                        scale_y: targetSy,
                        translation_x: 0,
                        translation_y: 0,
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                } else {
                    c.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        translation_x: c._baseTx ? c._baseTx : 0,
                        translation_y: c._baseTy ? c._baseTy : 0,
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
            }
        }
    }

    const isFullBar = isFullBarLayout();

    if (isActorAlive(dockActor.bgActor) && !isFullBar) {
        dockActor.bgActor.remove_all_transitions();
        dockActor.bgActor.scale_x = 1.0;
        dockActor.bgActor.scale_y = 1.0;
        dockActor.bgActor.translation_x = 0;
        dockActor.bgActor.translation_y = 0;

        const baseX = dockActor.bgActor._baseX !== undefined ? dockActor.bgActor._baseX : dockActor.bgActor.x;
        const baseY = dockActor.bgActor._baseY !== undefined ? dockActor.bgActor._baseY : dockActor.bgActor.y;
        const baseW = dockActor.bgActor._baseW || dockActor.bgActor.width;
        const baseH = dockActor.bgActor._baseH || dockActor.bgActor.height;

        if (duration === 0) {
            dockActor.bgActor.set_position(baseX, baseY);
            dockActor.bgActor.set_size(baseW, baseH);
            if (dockActor._dockUI && dockActor._dockUI._dockBlur) {
                dockActor._dockUI._dockBlur.syncGeometry();
            }
        } else {
            dockActor.bgActor.ease({
                x: baseX,
                y: baseY,
                width: baseW,
                height: baseH,
                duration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onUpdate: () => {
                    if (dockActor._dockUI && dockActor._dockUI._dockBlur) {
                        dockActor._dockUI._dockBlur.syncGeometry();
                    }
                },
                onStopped: () => {
                    if (isActorAlive(dockActor.bgActor)) {
                        dockActor.bgActor.set_position(baseX, baseY);
                        dockActor.bgActor.set_size(baseW, baseH);
                    }
                    if (dockActor._dockUI && dockActor._dockUI._dockBlur) {
                        dockActor._dockUI._dockBlur.syncGeometry();
                    }
                }
            });
        }
    } else if (isActorAlive(dockActor.bgActor) && isFullBar) {
        dockActor.bgActor.remove_all_transitions();
        dockActor.bgActor.scale_x = 1.0;
        dockActor.bgActor.scale_y = 1.0;
        dockActor.bgActor.translation_x = 0;
        dockActor.bgActor.translation_y = 0;
    }

    dockActor._structureChanged = false;
}

export function teardownMagnification(dockActor) {
    if (isActorAlive(dockActor)) {
        dockActor._suppressZoom = false;
        resetMagnification(dockActor, 0, false);

        if (dockActor._magTimers) {
            if (dockActor._leaveCheckId) dockActor._magTimers.remove(dockActor._leaveCheckId);
            if (dockActor._postClickTimerId) dockActor._magTimers.remove(dockActor._postClickTimerId);
            if (dockActor._suppressTimerId) dockActor._magTimers.remove(dockActor._suppressTimerId);
            if (dockActor._tooltipWatchId) dockActor._magTimers.remove(dockActor._tooltipWatchId);
            if (dockActor._tooltipDelayId) dockActor._magTimers.remove(dockActor._tooltipDelayId);
            if (dockActor._tooltipLeaveIdleId) dockActor._magTimers.remove(dockActor._tooltipLeaveIdleId);

            dockActor._magTimers.destroy();
            dockActor._magTimers = null;
        }

        dockActor._leaveCheckId = 0;
        dockActor._postClickTimerId = 0;
        dockActor._suppressTimerId = 0;
        dockActor._tooltipWatchId = 0;
        dockActor._tooltipDelayId = 0;
        dockActor._tooltipLeaveIdleId = 0;

        if (dockActor._magTicker) {
            dockActor._magTicker.destroy();
            dockActor._magTicker = null;
        }
        if (dockActor._tooltipTicker) {
            dockActor._tooltipTicker.destroy();
            dockActor._tooltipTicker = null;
        }
        if (dockActor._dragTicker) {
            dockActor._dragTicker.destroy();
            dockActor._dragTicker = null;
        }

        global.stage.disconnectObject(dockActor);

        dockActor.disconnectObject(dockActor);

        if (isActorAlive(dockActor.boxActor)) {
            dockActor.boxActor.disconnectObject(dockActor);
        }
        if (isActorAlive(dockActor.bgActor)) {
            dockActor.bgActor.disconnectObject(dockActor);
        }

        if (isActorAlive(dockActor._magTooltip)) dockActor._magTooltip.destroy();
        dockActor._magTooltip = null;
        dockActor._magTooltipBg = null;
        dockActor._magTooltipBox = null;

        if (dockActor._magPeekManager) {
            dockActor._magPeekManager.destroy();
            dockActor._magPeekManager = null;
        }
    }
}