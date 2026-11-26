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


import { getTrayPreferenceKey } from '../src/core/panel/TrayIndicatorId.js';
import { test, assertEqual } from './lib/assert.js';


test('getTrayPreferenceKey: a notifier retains its key when its bus name or PID changes', () => {
    const indicator = { _indicator: { id: 'org.example.Mail' } };
    const savedKey = getTrayPreferenceKey('appindicator-org.kde.StatusNotifierItem-123-1', indicator);
    assertEqual(savedKey, 'appindicator-id:org.example.Mail');
    assertEqual(getTrayPreferenceKey('appindicator-:1.51@/StatusNotifierItem', indicator), savedKey);
});

test('getTrayPreferenceKey: generated tray-icon IDs use the notifier title', () => {
    const first = { _indicator: { id: 'tray-icon tray app 123-1', title: 'Example Chat' } };
    const second = { _indicator: { id: 'tray-icon tray app 456-1', title: 'Example Chat' } };
    const savedKey = getTrayPreferenceKey('appindicator-:1.18@/Item', first);
    assertEqual(savedKey, 'appindicator-title:Example Chat');
    assertEqual(getTrayPreferenceKey('appindicator-:1.51@/Item', second), savedKey);
});

test('getTrayPreferenceKey: different Electron apps sharing an Id get distinct keys', () => {
    const id = 'chrome_status_icon_1';
    const first = { _indicator: { id, _appInfo: { get_executable: () => '/opt/example/Example' } } };
    const reconnected = { _indicator: { id, _fakeAppInfo: { get_executable: () => 'example' } } };
    const second = { _indicator: { id, _appInfo: { get_executable: () => 'other' } } };
    const savedKey = getTrayPreferenceKey('appindicator-:1.18@/Item', first);
    assertEqual(savedKey, 'appindicator-id:example:chrome_status_icon_1');
    assertEqual(getTrayPreferenceKey('appindicator-:1.51@/Item', reconnected), savedKey);
    assertEqual(getTrayPreferenceKey('appindicator-:1.52@/Item', second), 'appindicator-id:other:chrome_status_icon_1');
});

test('getTrayPreferenceKey: falls back to the panel role when identity is unavailable', () => {
    const role = 'appindicator-:1.18@/Item';
    assertEqual(getTrayPreferenceKey('example-applet', {}), 'example-applet');
    assertEqual(getTrayPreferenceKey(role, {}), role);
    assertEqual(getTrayPreferenceKey(role, { _indicator: { id: 'chrome_status_icon_1' } }), role);
});
