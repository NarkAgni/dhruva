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


const HIDE_ANIMATION_MS = 180;
const DEFAULT_TOOLTIP_PADDING = 20;

export function clearTooltipDelay(dockActor) {
    if (!dockActor) return;
    if (dockActor._tooltipDelayId) {
        if (dockActor._magTimers) {
            dockActor._magTimers.remove(dockActor._tooltipDelayId);
        } else if (dockActor._dockUI && dockActor._dockUI.registry) {
            dockActor._dockUI.registry.remove(dockActor._tooltipDelayId);
        } else {
            GLib.source_remove(dockActor._tooltipDelayId);
        }
        dockActor._tooltipDelayId = null;
    }
    dockActor._tooltipReady = false;
}

export function hideTooltip(dockActor) {
    clearTooltipDelay(dockActor);
    if (!dockActor) return;
    dockActor._tooltipHoveredIndex = -1;
    dockActor._tooltipBridgeActive = false;
    
    if (dockActor._magPeekManager && dockActor._magPeekManager.stopPeek) {
        dockActor._magPeekManager.stopPeek();
    }

    if (dockActor._magTooltip && dockActor._magTooltip.visible) {
        dockActor._magTooltip.remove_all_transitions();
        dockActor._magTooltip.ease({
            opacity: 0,
            duration: HIDE_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (dockActor._magTooltip) dockActor._magTooltip.hide();
            }
        });
    }
}

export function isInsideTooltip(dockActor, px, py, pad = DEFAULT_TOOLTIP_PADDING) {
    if (!dockActor || !dockActor._magTooltip || !dockActor._magTooltip.visible) return false;
    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
    const [tw, th] = dockActor._magTooltip.get_transformed_size();
    if (tw <= 0 || th <= 0) return false;
    return px >= tx - pad && px <= tx + tw + pad && py >= ty - pad && py <= ty + th + pad;
}

export function isPointerInDockTooltipBridge(dockActor, px, py, settings) {
    if (!dockActor || !dockActor._magTooltip || !dockActor._magTooltip.visible) return false;

    const iconSize = Settings.iconSize || 48;
    const lateralPad = Math.max(14, Math.min(26, Math.round(iconSize * 0.28)));
    const bridgePad = Math.max(8, Math.min(18, Math.round(iconSize * 0.18)));

    const dockPos = Settings.dockPosition || 'BOTTOM';
    const [dax, day] = dockActor.get_transformed_position();
    const [daw, dah] = dockActor.get_transformed_size();
    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
    const [tw, th] = dockActor._magTooltip.get_transformed_size();
    if (daw <= 0 || dah <= 0 || tw <= 0 || th <= 0) return false;

    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;

    if (dockPos === 'BOTTOM') {
        left = tx - lateralPad;
        right = tx + tw + lateralPad;
        top = ty + th - bridgePad;
        bottom = day - 2;
    } else if (dockPos === 'TOP') {
        left = tx - lateralPad;
        right = tx + tw + lateralPad;
        top = day + dah + 2;
        bottom = ty + bridgePad;
    } else if (dockPos === 'LEFT') {
        left = dax + daw - bridgePad;
        right = tx + bridgePad;
        top = ty - lateralPad;
        bottom = ty + th + lateralPad;
    } else {
        left = tx + tw - bridgePad;
        right = dax + bridgePad;
        top = ty - lateralPad;
        bottom = ty + th + lateralPad;
    }

    return px >= left && px <= right && py >= top && py <= bottom;
}