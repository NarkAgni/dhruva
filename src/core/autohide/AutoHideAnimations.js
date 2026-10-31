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
const MIN_ANIM_DURATION_MS = 50;

function getAnimDuration() {
    const val = Settings.autohideAnimationSpeed;
    return Number.isFinite(val) && val >= MIN_ANIM_DURATION_MS ? val : DEFAULT_ANIM_DURATION_MS;
}

function nextSerial(dockUI) {
    dockUI._autohideSerial = (dockUI._autohideSerial || 0) + 1;
    return dockUI._autohideSerial;
}

function easeDock(dockUI, props, mode, onStopped) {
    dockUI.actor.remove_all_transitions();
    dockUI.actor.ease({
        ...props,
        duration: getAnimDuration(),
        mode,
        onStopped,
    });
}

export function getHideOffsets(dockUI, peek = 0) {
    if (dockUI._isWindowGrabbed || dockUI.isOnSharedMonitorEdge()) {
        return { hideX: 0, hideY: 0 };
    }

    const margin = Settings.dockMargin;
    const extra = peek > 0 ? margin - peek : margin + HIDE_OFFSET_BUFFER;
    const width = dockUI.actor.width + extra;
    const height = dockUI.actor.height + extra;

    switch (dockUI.dockPosition) {
    case 'BOTTOM':
        return { hideX: 0, hideY: height };
    case 'TOP':
        return { hideX: 0, hideY: -height };
    case 'LEFT':
        return { hideX: -width, hideY: 0 };
    case 'RIGHT':
        return { hideX: width, hideY: 0 };
    default:
        return { hideX: 0, hideY: 0 };
    }
}

export function animateShow(dockUI, onComplete) {
    if (!dockUI || !isActorAlive(dockUI.actor)) return;

    const serial = nextSerial(dockUI);
    dockUI.actor._isAutohiding = false;
    dockUI.actor.show();

    easeDock(dockUI, { translation_x: 0, translation_y: 0, opacity: 255 }, Clutter.AnimationMode.EASE_OUT_QUAD, isFinished => {
        if (dockUI._autohideSerial !== serial) return;
        if (isFinished) {
            dockUI._dockBlur.syncGeometry();
            dockUI._dockBlur.queueCapture(true);
        }
        onComplete();
    });
}

export function animateHide(dockUI, onComplete, peek = 0) {
    if (!dockUI || !isActorAlive(dockUI.actor)) return;

    const serial = nextSerial(dockUI);
    const { hideX, hideY } = getHideOffsets(dockUI, peek);

    dockUI.actor._isAutohiding = true;
    dockUI._dockBlur.hideBlur();

    easeDock(dockUI, { translation_x: hideX, translation_y: hideY, opacity: peek > 0 ? 255 : 0 }, Clutter.AnimationMode.EASE_IN_QUAD, () => {
        if (dockUI._autohideSerial === serial) onComplete();
    });
}