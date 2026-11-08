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


import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop?version=4.0';

import { calendarDate, calendarSvg } from './CalendarIcon.js';

export function createCalendarIcon(renderSize) {
    const icon = new St.Icon({ icon_size: renderSize, reactive: false });
    let lastDate = '';
    const update = () => {
        const date = calendarDate();
        if (date.key === lastDate) return;
        lastDate = date.key;
        const bytes = new GLib.Bytes(new TextEncoder().encode(calendarSvg(date)));
        icon.gicon = new Gio.BytesIcon({ bytes });
    };

    // WallClock follows midnight, resume and system time/timezone changes.
    let clock = new GnomeDesktop.WallClock();
    const signalId = clock.connect('notify::clock', update);
    icon.connect('destroy', () => {
        clock.disconnect(signalId);
        clock = null;
    });
    update();
    return icon;
}
