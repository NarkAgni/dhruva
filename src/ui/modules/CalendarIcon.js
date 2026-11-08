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

// Keep the date in local time, including after timezone or system-clock changes.
export function calendarDate(now = GLib.DateTime.new_now_local()) {
    return {
        key: now.format('%Y-%m-%d'),
        month: now.format('%b'),
        day: String(now.get_day_of_month()),
    };
}

export function calendarSvg({ month, day }) {
    const escape = text => GLib.markup_escape_text(text, -1);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 128 128">
        <defs>
            <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0" stop-color="#ffffff"/>
                <stop offset="0.55" stop-color="#f8f8f8"/>
                <stop offset="1" stop-color="#e9e9ec"/>
            </linearGradient>
            <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0" stop-color="#ffffff"/>
                <stop offset="1" stop-color="#c9c9cf"/>
            </linearGradient>
        </defs>
        <rect x="9" y="10" width="110" height="112" rx="18" fill="#000000" opacity="0.08"/>
        <rect x="9" y="8" width="110" height="112" rx="18" fill="#bcbcc2"/>
        <rect x="9" y="6" width="110" height="112" rx="18" fill="url(#paper)"/>
        <rect x="9.5" y="6.5" width="109" height="111" rx="17.5" fill="none" stroke="url(#edge)" stroke-width="1"/>
        <text x="64" y="37" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="500" fill="#777777">${escape(month)}</text>
        <text x="64" y="99" text-anchor="middle" font-family="sans-serif" font-size="62" font-weight="600" fill="#242424">${escape(day)}</text>
    </svg>`;
}
