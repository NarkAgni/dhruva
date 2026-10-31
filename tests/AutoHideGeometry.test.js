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


import { Settings } from '../src/core/SettingsManager.js';
import { createFakeSettings } from './lib/fakes.js';
import { test, assertDeepEqual, assertTrue, assertFalse } from './lib/assert.js';
import { getHideOffsets, clampSpan, getTriggerRect, rectsIntersect } from '../src/core/autohide/AutoHideGeometry.js';


const MONITOR = { x: 0, y: 0, width: 1920, height: 1080 };

function fakeDock(dockPosition, overrides = {}) {
    return {
        dockPosition,
        isWindowGrabbed: false,
        isOnSharedMonitorEdge: () => false,
        actor: { width: 400, height: 60 },
        ...overrides,
    };
}

function withMargin(margin, fn) {
    Settings.init(createFakeSettings({ 'dock-margin': margin }));
    try {
        fn();
    } finally {
        Settings.destroy();
    }
}

test('getHideOffsets: slides fully off each edge', () => withMargin(8, () => {
    assertDeepEqual(getHideOffsets(fakeDock('BOTTOM')), { hideX: 0, hideY: 88 });
    assertDeepEqual(getHideOffsets(fakeDock('TOP')), { hideX: 0, hideY: -88 });
    assertDeepEqual(getHideOffsets(fakeDock('LEFT')), { hideX: -428, hideY: 0 });
    assertDeepEqual(getHideOffsets(fakeDock('RIGHT')), { hideX: 428, hideY: 0 });
}));

test('getHideOffsets: peek leaves part of the dock on screen', () => withMargin(8, () => {
    assertDeepEqual(getHideOffsets(fakeDock('BOTTOM'), 6), { hideX: 0, hideY: 62 });
}));

test('getHideOffsets: stays put while a window is grabbed or on a shared edge', () => withMargin(8, () => {
    assertDeepEqual(getHideOffsets(fakeDock('LEFT', { isWindowGrabbed: true })), { hideX: 0, hideY: 0 });
    assertDeepEqual(getHideOffsets(fakeDock('LEFT', { isOnSharedMonitorEdge: () => true })), { hideX: 0, hideY: 0 });
}));

test('getHideOffsets: unknown position does not move', () => withMargin(8, () => {
    assertDeepEqual(getHideOffsets(fakeDock('CENTER')), { hideX: 0, hideY: 0 });
}));

test('clampSpan: rounds and clamps to the monitor', () => {
    assertDeepEqual(clampSpan(0, 1920, 500.4, 300.6), [500, 801]);
    assertDeepEqual(clampSpan(0, 1920, -50, 200), [0, 150]);
    assertDeepEqual(clampSpan(0, 1920, 1800, 300), [1800, 1920]);
    assertDeepEqual(clampSpan(1920, 1920, 1900, 100), [1920, 2000]);
});

test('clampSpan: unmeasured size spans the whole monitor', () => {
    assertDeepEqual(clampSpan(0, 1920, 600, 20), [0, 1920]);
    assertDeepEqual(clampSpan(0, 1920, 600, 0), [0, 1920]);
});

test('getTriggerRect: thin strip on each edge, spanning the source', () => {
    const source = { x: 600, y: 1000, width: 720, height: 80 };
    assertDeepEqual(getTriggerRect('BOTTOM', MONITOR, source, 4), { x: 600, y: 1076, width: 720, height: 4 });
    assertDeepEqual(getTriggerRect('TOP', MONITOR, source, 4), { x: 600, y: 0, width: 720, height: 4 });
    assertDeepEqual(getTriggerRect('LEFT', MONITOR, source, 4), { x: 0, y: 1000, width: 4, height: 80 });
    assertDeepEqual(getTriggerRect('RIGHT', MONITOR, source, 4), { x: 1916, y: 1000, width: 4, height: 80 });
});

test('getTriggerRect: monitor as source gives a full-length strip', () => {
    assertDeepEqual(getTriggerRect('BOTTOM', MONITOR, MONITOR, 4), { x: 0, y: 1076, width: 1920, height: 4 });
});

test('getTriggerRect: unknown position is empty', () => {
    assertDeepEqual(getTriggerRect('CENTER', MONITOR, MONITOR, 4), { x: 0, y: 0, width: 0, height: 0 });
});

test('rectsIntersect: tolerance extends only toward the screen center', () => {
    const dock = { x: 600, y: 1000, width: 720, height: 80 };
    assertTrue(rectsIntersect('BOTTOM', dock, { x: 0, y: 0, width: 1920, height: 990 }));
    assertFalse(rectsIntersect('BOTTOM', dock, { x: 0, y: 0, width: 1920, height: 984 }));
    assertFalse(rectsIntersect('BOTTOM', dock, { x: 1320, y: 900, width: 200, height: 200 }));

    const side = { x: 0, y: 200, width: 80, height: 600 };
    assertTrue(rectsIntersect('LEFT', side, { x: 95, y: 0, width: 500, height: 1080 }));
    assertFalse(rectsIntersect('LEFT', side, { x: 96, y: 0, width: 500, height: 1080 }));
});

test('rectsIntersect: custom tolerance', () => {
    const dock = { x: 600, y: 1000, width: 720, height: 80 };
    assertFalse(rectsIntersect('BOTTOM', dock, { x: 0, y: 0, width: 1920, height: 990 }, 0));
});