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


import { test, assertEqual } from './lib/assert.js';
import { hexToRgba, clampByte } from '../src/core/Color.js';


test('hexToRgba: six and three digit hex', () => {
    assertEqual(hexToRgba('#241F31', 1), 'rgba(36, 31, 49, 1)');
    assertEqual(hexToRgba('#fff', 0.5), 'rgba(255, 255, 255, 0.5)');
});

test('hexToRgba: rgb() strings are clamped per channel', () => {
    assertEqual(hexToRgba('rgb(300, 128, 10)', 1), 'rgba(255, 128, 10, 1)');
});

test('hexToRgba: invalid input falls back to dark grey', () => {
    assertEqual(hexToRgba('#zzzzzz', 1), 'rgba(20, 20, 20, 1)');
    assertEqual(hexToRgba(null, 1), 'rgba(20, 20, 20, 1)');
    assertEqual(hexToRgba('teal', 1), 'rgba(20, 20, 20, 1)');
});

test('hexToRgba: alpha is clamped and defaults to 1', () => {
    assertEqual(hexToRgba('#000000', 2), 'rgba(0, 0, 0, 1)');
    assertEqual(hexToRgba('#000000', -1), 'rgba(0, 0, 0, 0)');
    assertEqual(hexToRgba('#000000'), 'rgba(0, 0, 0, 1)');
});

test('clampByte: keeps values in 0..255 and maps non-numbers to 0', () => {
    assertEqual(clampByte(-5), 0);
    assertEqual(clampByte(300), 255);
    assertEqual(clampByte(NaN), 0);
    assertEqual(clampByte(128), 128);
});