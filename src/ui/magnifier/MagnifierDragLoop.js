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
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { applyRealtimeFrame } from './MagnifierFrameEngine.js';
import { getDockButtons, isPointerWithinDockBounds } from './MagnifierMath.js';


const DRAG_TICK_INTERVAL_MS = 16;
const RESET_DURATION_MS = 200;

export function stopDragLoop(dockActor) {
    if (dockActor && dockActor._dragLoopId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._dragLoopId);
        dockActor._dragLoopId = null;
    }
}

export function startDragLoop(dockActor, isVertical, settings) {
    stopDragLoop(dockActor);
    let dragWasOutside = false;

    const loopTick = () => {
        if (!isActorAlive(dockActor) || !dockActor._isDragging) {
            dockActor._dragLoopId = null;
            return GLib.SOURCE_REMOVE;
        }

        const [cx, cy] = global.get_pointer();
        const isInsideDock = isPointerWithinDockBounds(dockActor, cx, cy, isVertical, settings);

        if (!isInsideDock) {
            if (!dragWasOutside) {
                getDockButtons(dockActor).forEach(btn => {
                    btn.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        translation_x: 0,
                        translation_y: 0,
                        duration: RESET_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                });
                if (dockActor.bgActor && !dockActor._isFullWidth) {
                    const baseX = dockActor.bgActor._baseX !== undefined ? dockActor.bgActor._baseX : dockActor.bgActor.x;
                    const baseY = dockActor.bgActor._baseY !== undefined ? dockActor.bgActor._baseY : dockActor.bgActor.y;
                    const baseW = dockActor.bgActor._baseW || dockActor.bgActor.width;
                    const baseH = dockActor.bgActor._baseH || dockActor.bgActor.height;
                    dockActor.bgActor.ease({
                        x: baseX,
                        y: baseY,
                        width: baseW,
                        height: baseH,
                        duration: RESET_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
                dragWasOutside = true;
            }
            return GLib.SOURCE_CONTINUE;
        }

        if (dragWasOutside) {
            dockActor._fixedSlots = null;
            dragWasOutside = false;
        }

        applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, Date.now());
        return GLib.SOURCE_CONTINUE;
    };

    if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
    dockActor._dragLoopId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, DRAG_TICK_INTERVAL_MS, loopTick);
}