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


const DEFAULT_RGB_CHANNEL = 20;

export function clampByte(v) {
    return Math.max(0, Math.min(255, Number.isFinite(v) ? v : 0));
}

export function hexToRgba(colorStr, alpha) {
    let r = DEFAULT_RGB_CHANNEL;
    let g = DEFAULT_RGB_CHANNEL;
    let b = DEFAULT_RGB_CHANNEL;

    const isString = Boolean(colorStr && colorStr.substring && colorStr.startsWith);

    if (isString && colorStr.startsWith('#')) {
        let hex = colorStr.slice(1).trim();
        if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');

        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
    } else if (isString && colorStr.startsWith('rgb')) {
        const parts = colorStr.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            r = clampByte(parseFloat(parts[0]));
            g = clampByte(parseFloat(parts[1]));
            b = clampByte(parseFloat(parts[2]));
        }
    }

    const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}