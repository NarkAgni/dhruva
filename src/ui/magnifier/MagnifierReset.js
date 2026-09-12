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
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { clearTooltipDelay, hideTooltip } from './MagnifierTooltip.js';


export function resetMagnification(dockActor, duration = 200, lockEngine = false) {
    if (!isActorAlive(dockActor)) return;

    hideTooltip(dockActor);
    clearTooltipDelay(dockActor);

    if (lockEngine) {
        dockActor._suppressZoom = true;
        if (dockActor._suppressTimerId && dockActor._magTimers) {
            dockActor._magTimers.remove(dockActor._suppressTimerId);
        }
        if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
        dockActor._suppressTimerId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, duration + 50, () => {
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

    const btns = getDockButtons(dockActor);

    btns.forEach(b => {
        if (!isActorAlive(b)) return;

        b.remove_all_transitions();
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
            appBox.get_children().forEach(c => {
                if (!isActorAlive(c)) return;
                c.remove_all_transitions();

                if (c._isIndicator) {
                    c.ease({
                        scale_x: c._baseScaleX || 1.0,
                        scale_y: c._baseScaleY || 1.0,
                        translation_x: c._baseTx || 0,
                        translation_y: c._baseTy || 0,
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                } else {
                    c.ease({
                        translation_x: c._baseTx || 0,
                        translation_y: c._baseTy || 0,
                        duration,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
            });
        }
    });

    if (isActorAlive(dockActor.bgActor)) {
        dockActor.bgActor.remove_all_transitions();
        dockActor.bgActor.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            translation_x: 0,
            translation_y: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }
}

export function teardownMagnification(dockActor) {
    if (!isActorAlive(dockActor)) return;

    dockActor._suppressZoom = false;
    resetMagnification(dockActor, 0, false);

    if (dockActor._magTimers) {
        dockActor._magTimers.destroy();
        dockActor._magTimers = null;
    }

    if (dockActor._stageClickId) {
        global.stage.disconnectObject(dockActor);
        dockActor._stageClickId = null;
    }

    dockActor.disconnectObject(dockActor);

    if (isActorAlive(dockActor.boxActor)) {
        dockActor.boxActor.disconnectObject(dockActor);
    }
}