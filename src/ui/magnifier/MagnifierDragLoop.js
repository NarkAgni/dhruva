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

import { getDockButtons } from './MagnifierMath.js';
import { applyRealtimeFrame } from './Magnifier.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';


function isActorAlive(actor) {
    if (!actor) return false;
    return actor.visible !== undefined;
}

export function stopDragLoop(dockActor) {
    if (dockActor && dockActor._dragLoopId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._dragLoopId);
        dockActor._dragLoopId = null;
    }
}

export function startDragLoop(dockActor, isVertical, settings) {
    stopDragLoop(dockActor);
    let dragWasOutside = false;

    if (!dockActor._dragLoopDestroyId) {
        dockActor._dragLoopDestroyId = dockActor.connectObject('destroy', () => {
            stopDragLoop(dockActor);
        }, dockActor);
    }

    const loopTick = () => {
        if (!isActorAlive(dockActor) || !dockActor._isDragging) {
            dockActor._dragLoopId = null;
            return GLib.SOURCE_REMOVE;
        }

        const [cx, cy] = global.get_pointer();
        const [dx, dy] = dockActor.get_transformed_position();
        const [dw, dh] = dockActor.get_transformed_size();

        let boundsLeft = dx;
        let boundsRight = dx + dw;
        let boundsTop = dy;
        let boundsBottom = dy + dh;
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
        const inBaseBounds = cx >= boundsLeft - basePadX && cx <= boundsRight + basePadX && cy >= boundsTop - basePadY && cy <= boundsBottom + basePadY;

        let inZoomedBounds = false;
        if (!inBaseBounds) {
            const iconSize = settings.get_int('icon-size') || 48;
            const zoomFactor = settings.get_double('hover-zoom-factor') || 1.0;
            const maxPadding = (iconSize * zoomFactor) + 20;
            
            inZoomedBounds = cx >= boundsLeft - maxPadding && cx <= boundsRight + maxPadding && cy >= boundsTop - maxPadding && cy <= boundsBottom + maxPadding;
        }

        const isInsideDock = inBaseBounds || inZoomedBounds;

        if (!isInsideDock) {
            if (!dragWasOutside) {
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
                if (dockActor.bgActor && dockActor.bgActor.set_pivot_point) {
                    dockActor.bgActor.set_pivot_point(0.5, 0.5);
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
    dockActor._dragLoopId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, 16, loopTick);
}