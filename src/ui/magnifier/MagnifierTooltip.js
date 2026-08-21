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


export function clearTooltipDelay(dockActor) {
    if (!dockActor) return;
    if (dockActor._tooltipDelayId) {
        if (dockActor._dockUI && dockActor._dockUI.registry) dockActor._dockUI.registry.remove(dockActor._tooltipDelayId);
        else GLib.source_remove(dockActor._tooltipDelayId);
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
        if (dockActor._magTooltip.remove_all_transitions) {
            dockActor._magTooltip.remove_all_transitions();
        }
        
        dockActor._magTooltip.ease({
            opacity: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (dockActor._magTooltip && dockActor._magTooltip.hide) {
                    dockActor._magTooltip.hide();
                }
            }
        });
    }
}

export function isInsideTooltip(dockActor, px, py, pad = 20) {
    if (!dockActor || !dockActor._magTooltip || !dockActor._magTooltip.visible) return false;
    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
    const [tw, th] = dockActor._magTooltip.get_transformed_size();
    if (tw <= 0 || th <= 0) return false;
    return (px >= tx - pad && px <= tx + tw + pad && py >= ty - pad && py <= ty + th + pad);
}

export function isPointerInDockTooltipBridge(dockActor, px, py, settings) {
    if (!dockActor || !dockActor._magTooltip || !dockActor._magTooltip.visible) return false;

    let lateralPad = 18;
    let bridgePad = 12;

    const iconSize = settings.get_int('icon-size') || 48;
    lateralPad = Math.max(14, Math.min(26, Math.round(iconSize * 0.28)));
    bridgePad = Math.max(8, Math.min(18, Math.round(iconSize * 0.18)));

    const dockPos = settings.get_string('dock-position') || 'BOTTOM';
    const [dax, day] = dockActor.get_transformed_position();
    const [daw, dah] = dockActor.get_transformed_size();
    const [tx, ty] = dockActor._magTooltip.get_transformed_position();
    const [tw, th] = dockActor._magTooltip.get_transformed_size();
    if (daw <= 0 || dah <= 0 || tw <= 0 || th <= 0) return false;

    const dockLeft = dax;
    const dockRight = dax + daw;
    const dockTop = day;
    const dockBottom = day + dah;

    const tipLeft = tx;
    const tipRight = tx + tw;
    const tipTop = ty;
    const tipBottom = ty + th;

    let left = 0, right = 0, top = 0, bottom = 0;

    if (dockPos === 'BOTTOM') {
        left = tipLeft - lateralPad;
        right = tipRight + lateralPad;
        top = tipBottom - bridgePad;
        bottom = dockTop - 2;
    } else if (dockPos === 'TOP') {
        left = tipLeft - lateralPad;
        right = tipRight + lateralPad;
        top = dockBottom + 2;
        bottom = tipTop + bridgePad;
    } else if (dockPos === 'LEFT') {
        left = dockRight - bridgePad;
        right = tipLeft + bridgePad;
        top = tipTop - lateralPad;
        bottom = tipBottom + lateralPad;
    } else {
        left = tipRight - bridgePad;
        right = dockLeft + bridgePad;
        top = tipTop - lateralPad;
        bottom = tipBottom + lateralPad;
    }

    return (px >= left && px <= right && py >= top && py <= bottom);
}