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

import { test, assertEqual, assertTrue, assertFalse } from './lib/assert.js';
import { settleBackgroundAfterReset } from '../src/ui/dock/DockLayoutSettle.js';

const HOOKS = { duration: 220, mode: 'EASE_OUT_QUAD' };

function createFakeBg() {
    const easeCalls = [];
    const bg = {
        x: 10, y: 20, width: 300, height: 60,
        _isMagResetting: false,
        ease(props) {
            easeCalls.push(props);
            if (props.onUpdate) props.onUpdate();
        },
    };
    return { bg, easeCalls };
}

test('settle: starts the ease and marks the reset flag', () => {
    const { bg, easeCalls } = createFakeBg();
    const started = settleBackgroundAfterReset(bg, 100, 200, 800, 60, HOOKS);
    assertTrue(started, 'started');
    assertEqual(easeCalls.length, 1, 'ease calls');
    assertTrue(bg._isMagResetting, 'reset flag set');
    assertEqual(easeCalls[0].x, 100, 'ease x');
    assertEqual(easeCalls[0].width, 800, 'ease width');
});

test('settle: does not restart while the same target is already settling', () => {
    const { bg, easeCalls } = createFakeBg();
    settleBackgroundAfterReset(bg, 100, 200, 800, 60, HOOKS);
    const restarted = settleBackgroundAfterReset(bg, 100, 200, 800, 60, HOOKS);
    assertFalse(restarted, 'second call with same target must not restart the ease');
    assertEqual(easeCalls.length, 1, 'ease calls');
    assertTrue(bg._isMagResetting, 'reset flag stays set');
});

test('settle: restarts when the layout target changes mid-flight', () => {
    const { bg, easeCalls } = createFakeBg();
    settleBackgroundAfterReset(bg, 100, 200, 800, 60, HOOKS);
    const restarted = settleBackgroundAfterReset(bg, 120, 200, 780, 60, HOOKS);
    assertTrue(restarted, 'changed target must restart');
    assertEqual(easeCalls.length, 2, 'ease calls');
    assertEqual(easeCalls[1].x, 120, 'new ease x');
});

test('settle: a finished settle allows starting a new identical one', () => {
    const { bg, easeCalls } = createFakeBg();
    settleBackgroundAfterReset(bg, 100, 200, 800, 60, HOOKS);
    easeCalls[0].onStopped();
    assertFalse(bg._isMagResetting, 'flag cleared after stop');
    const restarted = settleBackgroundAfterReset(bg, 100, 200, 800, 60, HOOKS);
    assertTrue(restarted, 'new settle after completion');
    assertEqual(easeCalls.length, 2, 'ease calls');
});

test('settle: updates blur geometry when restarting with changed target', () => {
    const { bg } = createFakeBg();
    let blurSyncs = 0;
    settleBackgroundAfterReset(bg, 100, 200, 800, 60, { ...HOOKS, onUpdate: () => { blurSyncs++; } });
    settleBackgroundAfterReset(bg, 120, 200, 780, 60, { ...HOOKS, onUpdate: () => { blurSyncs++; } });
    assertTrue(blurSyncs >= 2, 'blur sync ran for each started ease');
});
