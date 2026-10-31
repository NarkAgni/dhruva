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


import { test, assertEqual, assertClose, assertDeepEqual } from './lib/assert.js';
import { calculateScale, calculatePivot, calculateBackgroundBounds } from '../src/ui/dock/DockGeometryCalculator.js';


const MONITOR = { x: 0, y: 0, width: 1920, height: 1080 };

function assertBounds(actual, expected) {
    for (const key of Object.keys(expected))
        assertClose(actual[key], expected[key], `${key}:`);
}

test('calculateScale: content that fits is not scaled', () => {
    assertEqual(calculateScale(false, 800, 1.0, 48, 1920), 1.0);
    assertEqual(calculateScale(true, 900, 1.0, 48, 1080), 1.0);
});

test('calculateScale: overflowing content shrinks to fit the usable space', () => {
    assertClose(calculateScale(false, 2000, 1.0, 48, 1920), 1888 / 2000);
    assertClose(calculateScale(true, 1000, 1.0, 48, 1080), 968 / 1000);
});

test('calculateScale: reserves room for hover zoom', () => {
    assertClose(calculateScale(false, 1850, 1.5, 48, 1920), 1888 / 1927);
});

test('calculateScale: never shrinks below 20%', () => {
    assertEqual(calculateScale(false, 100000, 1.0, 48, 1920), 0.2);
});

test('calculateScale: tiny monitors still get 100px usable space', () => {
    assertEqual(calculateScale(false, 100, 1.0, 48, 50), 1.0);
});

test('calculatePivot: anchors to the dock edge', () => {
    assertDeepEqual(calculatePivot('BOTTOM', false, false, 'START'), { pivotX: 0.5, pivotY: 1.0 });
    assertDeepEqual(calculatePivot('TOP', false, false, 'CENTER'), { pivotX: 0.5, pivotY: 0.0 });
    assertDeepEqual(calculatePivot('LEFT', false, true, 'CENTER'), { pivotX: 0.0, pivotY: 0.5 });
    assertDeepEqual(calculatePivot('RIGHT', false, true, 'CENTER'), { pivotX: 1.0, pivotY: 0.5 });
});

test('calculatePivot: full-width bars follow icon alignment', () => {
    assertDeepEqual(calculatePivot('BOTTOM', true, false, 'START'), { pivotX: 0.0, pivotY: 1.0 });
    assertDeepEqual(calculatePivot('BOTTOM', true, false, 'END'), { pivotX: 1.0, pivotY: 1.0 });
    assertDeepEqual(calculatePivot('RIGHT', true, true, 'START'), { pivotX: 1.0, pivotY: 0.0 });
});

test('calculateBackgroundBounds: floating dock hugs the box plus stroke', () => {
    assertBounds(
        calculateBackgroundBounds(false, false, 'BOTTOM', 1, 1, 500, 60, MONITOR, 0.5, 1, 600, 100),
        { bgX: 49, bgY: 38, bgW: 502, bgH: 62 }
    );
    assertBounds(
        calculateBackgroundBounds(false, true, 'LEFT', 1, 2, 60, 500, MONITOR, 0, 0.5, 100, 600),
        { bgX: 0, bgY: 48, bgW: 64, bgH: 504 }
    );
});

test('calculateBackgroundBounds: full-width bar spans the monitor', () => {
    assertBounds(
        calculateBackgroundBounds(true, false, 'BOTTOM', 1, 1, 500, 60, MONITOR, 0.5, 1, 1920, 100),
        { bgX: 0, bgY: 38, bgW: 1920, bgH: 62 }
    );
});

test('calculateBackgroundBounds: full-width bar compensates for scale', () => {
    assertBounds(
        calculateBackgroundBounds(true, false, 'BOTTOM', 0.5, 1, 500, 60, MONITOR, 0.5, 1, 1920, 100),
        { bgX: -960, bgW: 3840 }
    );
});