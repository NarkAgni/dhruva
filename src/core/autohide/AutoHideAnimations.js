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
import { Settings } from '../SettingsManager.js';


const HIDE_OFFSET_BUFFER = 20;
const DEFAULT_ANIM_DURATION_MS = 250;

function getAnimDuration() {
    const val = Settings.autohideAnimationSpeed;
    return (Number.isFinite(val) && val >= 50) ? val : DEFAULT_ANIM_DURATION_MS;
}

function nextSerial(dockUI) {
    dockUI._autohideSerial = (dockUI._autohideSerial || 0) + 1;
    return dockUI._autohideSerial;
}

export function getHideOffsets(dockUI, peek = 0) {
    if (dockUI._isWindowGrabbed || (dockUI._isOnSharedMonitorEdge && dockUI._isOnSharedMonitorEdge())) {
        return { hideX: 0, hideY: 0 };
    }

    const pos = dockUI.dockPosition;
    let hideX = 0;
    let hideY = 0;

    const margin = Settings.dockMargin;
    const totalExtra = peek > 0 ? margin - peek : margin + HIDE_OFFSET_BUFFER;

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

    const serial = nextSerial(dockUI);
    dockUI.actor._isAutohiding = false;
    dockUI.actor.remove_all_transitions();
    dockUI.actor.show();
    dockUI.actor.ease({
        translation_x: 0,
        translation_y: 0,
        opacity: 255,
        duration: getAnimDuration(),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: isFinished => {
            if (dockUI._autohideSerial !== serial) return;
            if (isFinished && dockUI._dockBlur) {
                dockUI._dockBlur.syncGeometry();
                dockUI._dockBlur.queueCapture(true);
            }
            if (onComplete) onComplete();
        },
    });
}

export function animateHide(dockUI, onComplete, peek = 0) {
    if (!dockUI || !isActorAlive(dockUI.actor)) return;

    const serial = nextSerial(dockUI);
    const { hideX, hideY } = getHideOffsets(dockUI, peek);
    const targetOpacity = peek > 0 ? 255 : 0;

    dockUI.actor._isAutohiding = true;
    if (dockUI._dockBlur) {
        dockUI._dockBlur._hideBlur();
    }

    dockUI.actor.remove_all_transitions();
    dockUI.actor.ease({
        translation_x: hideX,
        translation_y: hideY,
        opacity: targetOpacity,
        duration: getAnimDuration(),
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onStopped: () => {
            if (dockUI._autohideSerial === serial && onComplete) onComplete();
        },
    });
}