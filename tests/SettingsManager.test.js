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
import { test, assertEqual, assertDeepEqual, assertTrue } from './lib/assert.js';
import { createFakeSettings, createRecordingSettings, readSchemaKeys } from './lib/fakes.js';


function settingNames() {
    return Object.keys(Settings).filter(name => Object.getOwnPropertyDescriptor(Settings, name).get);
}

test('Settings: every key exists in the gschema with the matching type', () => {
    const schema = readSchemaKeys();
    const recorder = createRecordingSettings();
    Settings.init(recorder);
    try {
        for (const name of settingNames()) {
            recorder.reads.length = 0;
            void Settings[name];
            const [read] = recorder.reads;
            assertTrue(schema.has(read.key), `${name} -> '${read.key}' missing from schema:`);
            assertEqual(read.type, schema.get(read.key), `${name} -> '${read.key}' type:`);
        }
    } finally {
        Settings.destroy();
    }
});

test('Settings: returns neutral values before init', () => {
    assertEqual(Settings.iconSize, 0);
    assertEqual(Settings.hybridPanelMode, false);
    assertEqual(Settings.dockPosition, '');
    assertDeepEqual(Settings.customFolders, []);
});

test('Settings: reads typed values from GSettings', () => {
    Settings.init(createFakeSettings({ 'icon-size': 48, 'hide-mode': 'intelligent', 'hover-zoom-factor': 1.5 }));
    try {
        assertEqual(Settings.iconSize, 48);
        assertEqual(Settings.hideMode, 'intelligent');
        assertEqual(Settings.hoverZoomFactor, 1.5);
    } finally {
        Settings.destroy();
    }
});

test('Settings: setter writes to GSettings', () => {
    const fake = createFakeSettings({ 'independent-dock': false });
    Settings.init(fake);
    try {
        Settings.independentDock = true;
        assertEqual(fake.values['independent-dock'], true);
    } finally {
        Settings.destroy();
    }
});

test('Settings: setter before init is a no-op', () => {
    Settings.independentDock = true;
    assertEqual(Settings.independentDock, false);
});

test('Settings: JSON array keys parse valid arrays', () => {
    Settings.init(createFakeSettings({ 'custom-folders': '[{"id":"a"}]' }));
    try {
        assertDeepEqual(Settings.customFolders, [{ id: 'a' }]);
    } finally {
        Settings.destroy();
    }
});

test('Settings: JSON array keys fall back to [] for empty, invalid or non-array values', () => {
    for (const raw of ['', '{', '{"a":1}', 'null']) {
        Settings.init(createFakeSettings({ 'app-folders': raw }));
        try {
            assertDeepEqual(Settings.appFolders, [], `for ${JSON.stringify(raw)}:`);
        } finally {
            Settings.destroy();
        }
    }
});

test('Settings: JSON array setter stores a JSON string', () => {
    const fake = createFakeSettings({ 'app-folders': '[]' });
    Settings.init(fake);
    try {
        Settings.appFolders = [{ id: 'x' }];
        assertEqual(fake.values['app-folders'], '[{"id":"x"}]');
    } finally {
        Settings.destroy();
    }
});