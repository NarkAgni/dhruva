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
import { SettleSync } from '../src/ui/blur/BlurSettleSync.js';


function fakeLaters() {
    let nextId = 1;
    const pending = new Map();
    return {
        pending,
        schedule: callback => {
            const id = nextId++;
            pending.set(id, callback);
            return id;
        },
        cancel: id => pending.delete(id),
        flush() {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach(callback => callback());
        },
    };
}

test('settle sync: several queue calls in one frame schedule a single run', () => {
    const laters = fakeLaters();
    let runs = 0;
    const sync = new SettleSync(laters.schedule, laters.cancel, () => runs++);

    sync.queue();
    sync.queue();
    sync.queue();

    assertEqual(laters.pending.size, 1, 'one later scheduled');
    laters.flush();
    assertEqual(runs, 1, 'run executed once');
});

test('settle sync: the run happens only after the scheduled callback fires', () => {
    const laters = fakeLaters();
    let runs = 0;
    const sync = new SettleSync(laters.schedule, laters.cancel, () => runs++);

    sync.queue();

    assertEqual(runs, 0, 'nothing runs synchronously');
    assertTrue(sync.isPending, 'pending until the later fires');
    laters.flush();
    assertFalse(sync.isPending, 'no longer pending after it fires');
});

test('settle sync: a later frame can queue a new run after the previous one fired', () => {
    const laters = fakeLaters();
    let runs = 0;
    const sync = new SettleSync(laters.schedule, laters.cancel, () => runs++);

    sync.queue();
    laters.flush();
    sync.queue();
    laters.flush();

    assertEqual(runs, 2);
});

test('settle sync: cancel drops the pending run', () => {
    const laters = fakeLaters();
    let runs = 0;
    const sync = new SettleSync(laters.schedule, laters.cancel, () => runs++);

    sync.queue();
    sync.cancel();
    laters.flush();

    assertEqual(runs, 0, 'cancelled run never executes');
    assertEqual(laters.pending.size, 0, 'later removed from the scheduler');
    assertFalse(sync.isPending);
});

test('settle sync: cancel without a pending run is a no-op', () => {
    const laters = fakeLaters();
    let cancels = 0;
    const sync = new SettleSync(laters.schedule, () => cancels++, () => {});

    sync.cancel();

    assertEqual(cancels, 0);
});
