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

import { Settings } from '../../core/SettingsManager.js';


const HIDE_ANIMATION_MS = 180;
const DEFAULT_TOOLTIP_PADDING = 20;
const ICON_REACH_PX = 4;

export const TOOLTIP_GAP = 24;

export function clearTooltipDelay(dockActor) {
    if (!dockActor) return;
    if (dockActor._tooltipDelayId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._tooltipDelayId);
        dockActor._tooltipDelayId = 0;
    }
    dockActor._tooltipReady = false;
}

export function hideTooltip(dockActor) {
    clearTooltipDelay(dockActor);
    if (!dockActor) return;
    if (dockActor._tooltipLeaveIdleId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._tooltipLeaveIdleId);
        dockActor._tooltipLeaveIdleId = 0;
    }
    dockActor._tooltipHoveredIndex = -1;
    dockActor._tooltipBridgeActive = false;
    
    if (dockActor._magPeekManager && dockActor._magPeekManager.stopPeek) {
        dockActor._magPeekManager.stopPeek();
    }

    if (dockActor._magTooltipBlur) {
        dockActor._magTooltipBlur.blurActor.hide();
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
        bottom = Math.max(day - 2, ty + th + TOOLTIP_GAP + ICON_REACH_PX);
    } else if (dockPos === 'TOP') {
        left = tx - lateralPad;
        right = tx + tw + lateralPad;
        top = Math.min(day + dah + 2, ty - TOOLTIP_GAP - ICON_REACH_PX);
        bottom = ty + bridgePad;
    } else if (dockPos === 'LEFT') {
        left = Math.min(dax + daw - bridgePad, tx - TOOLTIP_GAP - ICON_REACH_PX);
        right = tx + bridgePad;
        top = ty - lateralPad;
        bottom = ty + th + lateralPad;
    } else {
        left = tx + tw - bridgePad;
        right = Math.max(dax + bridgePad, tx + tw + TOOLTIP_GAP + ICON_REACH_PX);
        top = ty - lateralPad;
        bottom = ty + th + lateralPad;
    }

    return px >= left && px <= right && py >= top && py <= bottom;
}