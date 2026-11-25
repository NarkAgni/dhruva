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

import { test, assertEqual, assertTrue } from './lib/assert.js';
import { readSchemaKeys } from './lib/fakes.js';
import { PRESET_BASE, presetList } from '../src/prefs/PresetData.js';


const schemaKeys = readSchemaKeys();
const PRESETS = () => presetList();
const PRESET_KEYS = Object.keys(PRESET_BASE);

test('presets: every preset key exists in the settings schema', () => {
    for (const key of PRESET_KEYS)
        assertTrue(schemaKeys.has(key), `key '${key}' must exist in the schema`);
});

test('presets: preset values only touch known schema keys', () => {
    for (const preset of PRESETS()) {
        for (const key of Object.keys(preset.values))
            assertTrue(schemaKeys.has(key), `${preset.id}: key '${key}' must exist in the schema`);
    }
});
test('presets: macos preset enables the Mac-style behaviour', () => {
    const macos = PRESETS().find(preset => preset.id === 'macos');
    assertTrue(macos !== undefined, 'macos preset exists');
    const values = macos.values;
    assertEqual(values['hover-zoom'], true, 'hover-zoom');
    assertEqual(values['hide-mode'], 'intelligent', 'hide-mode');
    assertEqual(values['click-effect'], 'bounce', 'click-effect');
    assertEqual(values['minimize-effect'], 'magic-lamp', 'minimize-effect');
});

test('presets: macos preset uses the dominant indicator colour', () => {
    const macos = PRESETS().find(preset => preset.id === 'macos');
    assertEqual(macos.values['indicator-color-mode'], 'dominant', 'indicator-color-mode');
});
