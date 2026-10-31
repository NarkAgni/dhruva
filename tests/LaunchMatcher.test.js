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


import { test, assertEqual, assertTrue, assertFalse, assertDeepEqual } from './lib/assert.js';
import {
    getWindowIdentity,
    launchMatchesWindow,
    hasPendingLaunchFor,
    pruneExpiredLaunches,
    claimLaunchForWindow,
} from '../src/ui/dock/LaunchMatcher.js';


function fakeTracker(appId) {
    return { get_window_app: () => (appId ? { get_id: () => appId } : null) };
}

function fakeWindow(wmClass) {
    return { get_wm_class: () => wmClass };
}

test('getWindowIdentity: reads app id and lower-cases the window class', () => {
    assertDeepEqual(getWindowIdentity(fakeWindow('Firefox'), fakeTracker('firefox.desktop')),
        { appId: 'firefox.desktop', wmClass: 'firefox' });
});

test('getWindowIdentity: tolerates windows without app or class', () => {
    assertDeepEqual(getWindowIdentity(fakeWindow(null), fakeTracker(null)), { appId: null, wmClass: '' });
});

test('launchMatchesWindow: exact app id wins', () => {
    assertTrue(launchMatchesWindow({ appId: 'org.gnome.Terminal.desktop' }, { appId: 'org.gnome.Terminal.desktop', wmClass: 'x' }));
});

test('launchMatchesWindow: falls back to the window class in either direction', () => {
    assertTrue(launchMatchesWindow({ appId: 'firefox.desktop' }, { appId: 'other', wmClass: 'firefox' }));
    assertTrue(launchMatchesWindow({ appId: 'code.desktop' }, { appId: null, wmClass: 'code-oss' }));
    assertFalse(launchMatchesWindow({ appId: 'firefox.desktop' }, { appId: null, wmClass: 'gimp' }));
});

test('launchMatchesWindow: folder launches match the file manager', () => {
    assertTrue(launchMatchesWindow({ isFolder: true }, { appId: null, wmClass: 'org.gnome.nautilus' }));
    assertFalse(launchMatchesWindow({ isFolder: true }, { appId: null, wmClass: 'firefox' }));
});

test('hasPendingLaunchFor: ignores consumed launches', () => {
    const identity = { appId: 'a.desktop', wmClass: '' };
    assertTrue(hasPendingLaunchFor([{ appId: 'a.desktop' }], identity));
    assertFalse(hasPendingLaunchFor([{ appId: 'a.desktop', consumed: true }], identity));
});

test('pruneExpiredLaunches: drops launches older than 8 seconds and empty slots', () => {
    const now = 100000;
    const fresh = { appId: 'a', createdAt: now - 7999 };
    const stale = { appId: 'b', createdAt: now - 8000 };
    const undated = { appId: 'c' };
    assertDeepEqual(pruneExpiredLaunches([fresh, stale, null, undated], now), [fresh, undated]);
});

test('claimLaunchForWindow: claims the first matching launch only once', () => {
    const identity = { appId: 'a.desktop', wmClass: '' };
    const launches = [{ appId: 'b.desktop' }, { appId: 'a.desktop' }, { appId: 'a.desktop' }];
    const first = claimLaunchForWindow(launches, identity);
    assertTrue(first === launches[1]);
    assertTrue(launches[1].consumed);
    assertTrue(claimLaunchForWindow(launches, identity) === launches[2]);
    assertEqual(claimLaunchForWindow(launches, identity), null);
});