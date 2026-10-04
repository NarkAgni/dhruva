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


const SCREEN_EDGE_SAFETY_MARGIN = 16;


export function calculateScale(_isVertical, baseContentSize, maxZoomFactor, iconSize, availableSpace) {
    const usableSpace = Math.max(100, availableSpace - (SCREEN_EDGE_SAFETY_MARGIN * 2));

    const actualMax = 1.0 + (maxZoomFactor - 1.0) * 2.0;
    const dynamicZoomPush = actualMax > 1.0 ? Math.round(iconSize * (actualMax - 1.0) * 1.6) : 0;

    const totalProjectedSize = baseContentSize + dynamicZoomPush;

    if (totalProjectedSize <= usableSpace) {
        return 1.0;
    }

    const requiredScale = usableSpace / totalProjectedSize;
    return Math.max(0.20, Math.min(1.0, requiredScale));
}

export function calculatePivot(pos, isFullWidth, isVertical, alignment) {
    let pivotX = 0.5;
    let pivotY = 0.5;

    if (pos === 'LEFT') pivotX = 0.0;
    else if (pos === 'RIGHT') pivotX = 1.0;
    else if (pos === 'TOP') pivotY = 0.0;
    else if (pos === 'BOTTOM') pivotY = 1.0;

    if (isFullWidth) {
        if (!isVertical) {
            if (alignment === 'START') pivotX = 0.0;
            else if (alignment === 'END') pivotX = 1.0;
        } else {
            if (alignment === 'START') pivotY = 0.0;
            else if (alignment === 'END') pivotY = 1.0;
        }
    }
    return { pivotX, pivotY };
}

export function calculateBackgroundBounds(isFullWidth, isVertical, pos, scale, sWidth, boxW, boxH, monitor, pivotX, pivotY, actorW, actorH) {
    let bgX = 0;
    let bgY = 0;
    let bgW = 0;
    let bgH = 0;

    if (isFullWidth) {
        bgW = isVertical ? boxW + (sWidth * 2) : monitor.width / scale;
        bgH = isVertical ? monitor.height / scale : boxH + (sWidth * 2);

        if (!isVertical) {
            bgX = -pivotX * monitor.width * ((1.0 / scale) - 1.0);
            bgY = pos === 'BOTTOM' ? actorH - bgH : (pos === 'TOP' ? 0 : (actorH - bgH) / 2);
        } else {
            bgY = -pivotY * monitor.height * ((1.0 / scale) - 1.0);
            bgX = pos === 'RIGHT' ? actorW - bgW : (pos === 'LEFT' ? 0 : (actorW - bgW) / 2);
        }
    } else {
        bgW = boxW + (sWidth * 2);
        bgH = boxH + (sWidth * 2);
        bgX = (actorW - bgW) / 2;
        bgY = (actorH - bgH) / 2;

        if (pos === 'BOTTOM') bgY = actorH - bgH;
        else if (pos === 'TOP') bgY = 0;
        else if (pos === 'LEFT') bgX = 0;
        else if (pos === 'RIGHT') bgX = actorW - bgW;
    }

    return { bgX, bgY, bgW, bgH };
}