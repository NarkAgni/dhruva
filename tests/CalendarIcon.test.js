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
import { test, assertEqual, assertTrue } from './lib/assert.js';
import { calendarDate, calendarSvg } from '../src/ui/modules/CalendarIcon.js';

test('calendarDate: uses the local month and an unpadded day', () => {
    const now = GLib.DateTime.new_local(2026, 11, 8, 12, 0, 0);
    const date = calendarDate(now);
    assertEqual(date.key, '2026-11-08');
    assertEqual(date.day, '8');
    assertEqual(date.month, now.format('%b'));
});

test('calendarDate: changes at midnight and year rollover', () => {
    const before = calendarDate(GLib.DateTime.new_local(2026, 12, 31, 23, 59, 59));
    const after = calendarDate(GLib.DateTime.new_local(2027, 1, 1, 0, 0, 0));
    assertEqual(before.key, '2026-12-31');
    assertEqual(after.key, '2027-01-01');
    assertEqual(after.day, '1');
});

test('calendarSvg: escapes localized labels for valid SVG', () => {
    const svg = calendarSvg({ month: 'M&<>', day: '8' });
    assertTrue(svg.includes('M&amp;&lt;&gt;'));
    assertTrue(svg.includes('>8</text>'));
});
