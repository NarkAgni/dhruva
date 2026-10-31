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


import { Settings } from '../SettingsManager.js';


const HIDE_OFFSET_BUFFER = 20;
const MIN_MEASURED_SIZE_PX = 20;
const DEFAULT_INTERSECT_TOLERANCE = 16;

export function isHorizontalEdge(pos) {
    return pos === 'BOTTOM' || pos === 'TOP';
}

export function getHideOffsets(dockUI, peek = 0) {
    if (dockUI.isWindowGrabbed || dockUI.isOnSharedMonitorEdge()) {
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

export function clampSpan(monitorStart, monitorLength, start, size) {
    const monitorEnd = monitorStart + monitorLength;
    if (size <= MIN_MEASURED_SIZE_PX) return [monitorStart, monitorEnd];

    const roundedStart = Math.round(start);
    return [Math.max(monitorStart, roundedStart), Math.min(monitorEnd, roundedStart + Math.round(size))];
}

export function getTriggerRect(pos, monitor, source, depth) {
    const [start, length] = isHorizontalEdge(pos)
        ? [source.x, source.width]
        : [source.y, source.height];

    switch (pos) {
    case 'BOTTOM':
        return { x: start, y: monitor.y + monitor.height - depth, width: length, height: depth };
    case 'TOP':
        return { x: start, y: monitor.y, width: length, height: depth };
    case 'LEFT':
        return { x: monitor.x, y: start, width: depth, height: length };
    case 'RIGHT':
        return { x: monitor.x + monitor.width - depth, y: start, width: depth, height: length };
    default:
        return { x: 0, y: 0, width: 0, height: 0 };
    }
}

export function rectsIntersect(pos, r1, r2, tolerance = DEFAULT_INTERSECT_TOLERANCE) {
    let left = r1.x;
    let right = r1.x + r1.width;
    let top = r1.y;
    let bottom = r1.y + r1.height;

    if (pos === 'BOTTOM') top -= tolerance;
    else if (pos === 'TOP') bottom += tolerance;
    else if (pos === 'LEFT') right += tolerance;
    else if (pos === 'RIGHT') left -= tolerance;

    return !(
        r2.x >= right ||
        (r2.x + r2.width) <= left ||
        r2.y >= bottom ||
        (r2.y + r2.height) <= top
    );
}