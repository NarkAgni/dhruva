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
import { createFakeSettings, FakeActor } from './lib/fakes.js';
import { test, assertEqual, assertClose, assertDeepEqual, assertTrue, assertFalse } from './lib/assert.js';
import {
    easeOutCirc,
    axisSpan,
    isStaticItem,
    getFixedSlots,
    getPanelSideActors,
    isPointerInIconCorridor,
    isPointerWithinDockBounds,
} from '../src/ui/magnifier/MagnifierMath.js';


function withSettings(values, fn) {
    Settings.init(createFakeSettings({
        'full-width': false,
        'hybrid-panel-mode': false,
        'dynamic-panel': false,
        'dock-position': 'BOTTOM',
        'icon-size': 48,
        'hover-zoom-radius': 2.0,
        ...values,
    }));
    try {
        fn();
    } finally {
        Settings.destroy();
    }
}

function button(x, width, y = 0, height = 48) {
    return { x, y, width, height };
}

test('easeOutCirc: starts at 0, ends at 1, eases out', () => {
    assertEqual(easeOutCirc(0), 0);
    assertEqual(easeOutCirc(1), 1);
    assertClose(easeOutCirc(0.5), Math.sqrt(0.75));
});

test('axisSpan: picks the axis that matches the dock orientation', () => {
    const actor = new FakeActor({ x: 10, y: 20, width: 30, height: 40 });
    assertDeepEqual(axisSpan(actor, false), [10, 40]);
    assertDeepEqual(axisSpan(actor, true), [20, 60]);
});

test('isStaticItem: separators, clocks and pills do not magnify', () => {
    assertTrue(isStaticItem(new FakeActor({ styleClass: 'dock-separator' })));
    assertTrue(isStaticItem(new FakeActor({ styleClass: 'clock-module extra' })));
    assertTrue(isStaticItem(new FakeActor({ _isStatic: true })));
});

test('isStaticItem: app buttons and the overflow button do magnify', () => {
    assertFalse(isStaticItem(new FakeActor({ styleClass: 'dock-app-button' })));
    assertFalse(isStaticItem(new FakeActor({ styleClass: 'dock-separator', _isOverflowBtn: true })));
    assertFalse(isStaticItem(new FakeActor({ styleClass: null })));
});

test('getFixedSlots: centers include the box offset and are sorted', () => {
    const btns = [button(120, 40), button(0, 40), button(60, 40)];
    const slots = getFixedSlots({ boxActor: { x: 100, y: 0 } }, false, btns);
    assertDeepEqual(slots.centersByBtn, [240, 120, 180]);
    assertDeepEqual(slots.orderedSlots, [120, 180, 240]);
    assertDeepEqual(slots.orderToBtn, [1, 2, 0]);
    assertDeepEqual(slots.btnToOrder, [2, 0, 1]);
});

test('getFixedSlots: vertical docks use the y axis', () => {
    const btns = [button(0, 48, 0, 40), button(0, 48, 50, 40)];
    const slots = getFixedSlots({ boxActor: { x: 0, y: 200 } }, true, btns);
    assertDeepEqual(slots.centersByBtn, [220, 270]);
});

test('getFixedSlots: reuses the cache until a button moves more than 2px', () => {
    const dock = { boxActor: { x: 0, y: 0 } };
    const btns = [button(0, 40), button(50, 40)];
    const first = getFixedSlots(dock, false, btns);
    btns[1].x += 2;
    assertTrue(getFixedSlots(dock, false, btns) === first, 'cache reused:');
    btns[1].x += 1;
    assertFalse(getFixedSlots(dock, false, btns) === first, 'cache rebuilt:');
});

test('getPanelSideActors: empty outside panel mode', () => withSettings({}, () => {
    assertDeepEqual(getPanelSideActors(new FakeActor()), { start: [], end: [] });
}));

test('isPointerWithinDockBounds: floating dock pads more toward the screen edge', () => withSettings({}, () => {
    const dock = { get_transformed_position: () => [500, 1000], get_transformed_size: () => [400, 80] };
    assertTrue(isPointerWithinDockBounds(dock, 700, 1040, false, true));
    assertTrue(isPointerWithinDockBounds(dock, 700, 994, false, true));
    assertFalse(isPointerWithinDockBounds(dock, 700, 993, false, true));
    assertTrue(isPointerWithinDockBounds(dock, 700, 1105, false, true));
    assertFalse(isPointerWithinDockBounds(dock, 700, 1106, false, true));
    assertTrue(isPointerWithinDockBounds(dock, 482, 1040, false, true));
    assertFalse(isPointerWithinDockBounds(dock, 481, 1040, false, true));
}));

test('isPointerWithinDockBounds: background extends the floating bounds', () => withSettings({}, () => {
    const dock = {
        get_transformed_position: () => [500, 1000],
        get_transformed_size: () => [400, 80],
        bgActor: { get_transformed_position: () => [450, 990], get_transformed_size: () => [500, 90] },
    };
    assertTrue(isPointerWithinDockBounds(dock, 432, 1040, false, true));
    assertFalse(isPointerWithinDockBounds(dock, 431, 1040, false, true));
}));

test('isPointerWithinDockBounds: panel mode reaches past the icon box by the zoom radius', () => withSettings({ 'full-width': true }, () => {
    const dock = { boxActor: new FakeActor({ x: 800, y: 1020, width: 320, height: 60 }) };
    assertTrue(isPointerWithinDockBounds(dock, 686, 1050, false, true));
    assertFalse(isPointerWithinDockBounds(dock, 685, 1050, false, true));
    assertTrue(isPointerWithinDockBounds(dock, 1234, 1050, false, true));
    assertFalse(isPointerWithinDockBounds(dock, 1235, 1050, false, true));
}));

test('isPointerInIconCorridor: floating docks have no corridor limit', () => withSettings({}, () => {
    assertTrue(isPointerInIconCorridor(new FakeActor(), 0, 0, false));
}));

test('isPointerInIconCorridor: full-width bar limits magnification to the icon cluster', () => withSettings({ 'full-width': true }, () => {
    const boxActor = new FakeActor({
        x: 800, width: 320,
        children: [new FakeActor({ x: 810, width: 50 }), new FakeActor({ x: 870, width: 50 })],
    });
    const dock = new FakeActor({ boxActor });
    assertTrue(isPointerInIconCorridor(dock, 785, 0, false));
    assertFalse(isPointerInIconCorridor(dock, 784, 0, false));
    assertTrue(isPointerInIconCorridor(dock, 1135, 0, false));
    assertFalse(isPointerInIconCorridor(dock, 1136, 0, false));
}));

test('isPointerInIconCorridor: children sticking out widen the corridor', () => withSettings({ 'full-width': true }, () => {
    const boxActor = new FakeActor({
        x: 800, width: 320,
        children: [new FakeActor({ x: 1140, width: 50 }), new FakeActor({ x: 1300, width: 50, visible: false })],
    });
    const dock = new FakeActor({ boxActor });
    assertTrue(isPointerInIconCorridor(dock, 1194, 0, false));
    assertFalse(isPointerInIconCorridor(dock, 1195, 0, false));
}));