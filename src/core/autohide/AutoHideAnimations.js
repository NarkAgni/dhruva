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


import Clutter from 'gi://Clutter';

import { isActorAlive } from '../Utils.js';


const HIDE_OFFSET_BUFFER = 20;
const ANIM_DURATION_MS = 250;

export function getHideOffsets(dockUI) {
    const pos = dockUI.dockPosition;
    let hideX = 0;
    let hideY = 0;

    const margin = dockUI.settings.get_int('dock-margin');
    const totalExtra = margin + HIDE_OFFSET_BUFFER;

    if (pos === 'BOTTOM') {
        hideY = dockUI.actor.height + totalExtra;
    } else if (pos === 'TOP') {
        hideY = -(dockUI.actor.height + totalExtra);
    } else if (pos === 'LEFT') {
        hideX = -(dockUI.actor.width + totalExtra);
    } else if (pos === 'RIGHT') {
        hideX = dockUI.actor.width + totalExtra;
    }

    return { hideX, hideY };
}

export function animateShow(dockUI, onComplete) {
    if (!dockUI || !isActorAlive(dockUI.actor)) return;

    dockUI.actor.remove_all_transitions();
    dockUI.actor.show();
    dockUI.actor.ease({
        translation_x: 0,
        translation_y: 0,
        opacity: 255,
        duration: ANIM_DURATION_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: (_isFinished) => {
            if (onComplete) onComplete();
        },
    });
}

export function animateHide(dockUI, onComplete) {
    if (!dockUI || !isActorAlive(dockUI.actor)) return;

    const { hideX, hideY } = getHideOffsets(dockUI);

    dockUI.actor.remove_all_transitions();
    dockUI.actor.ease({
        translation_x: hideX,
        translation_y: hideY,
        opacity: 0,
        duration: ANIM_DURATION_MS,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onStopped: (_isFinished) => {
            if (onComplete) onComplete();
        },
    });
}