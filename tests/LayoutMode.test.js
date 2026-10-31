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
import { test, assertEqual } from './lib/assert.js';
import { isDynamicPanelLayout, isFullBarLayout, isPanelOrFullWidth } from '../src/core/LayoutMode.js';


const CASES = [
    { fullWidth: false, hybrid: false, dynamic: false, isDynamic: false, isFullBar: false, isPanelOrFull: false },
    { fullWidth: false, hybrid: false, dynamic: true, isDynamic: false, isFullBar: false, isPanelOrFull: false },
    { fullWidth: false, hybrid: true, dynamic: false, isDynamic: false, isFullBar: true, isPanelOrFull: true },
    { fullWidth: false, hybrid: true, dynamic: true, isDynamic: true, isFullBar: false, isPanelOrFull: true },
    { fullWidth: true, hybrid: false, dynamic: false, isDynamic: false, isFullBar: true, isPanelOrFull: true },
    { fullWidth: true, hybrid: true, dynamic: true, isDynamic: true, isFullBar: true, isPanelOrFull: true },
];

for (const c of CASES) {
    const label = `fullWidth=${c.fullWidth} panel=${c.hybrid} dynamic=${c.dynamic}`;

    test(`LayoutMode: ${label}`, () => {
        Settings.init(createFakeSettings({
            'full-width': c.fullWidth,
            'hybrid-panel-mode': c.hybrid,
            'dynamic-panel': c.dynamic,
        }));
        try {
            assertEqual(isDynamicPanelLayout(), c.isDynamic, 'isDynamicPanelLayout:');
            assertEqual(isFullBarLayout(), c.isFullBar, 'isFullBarLayout:');
            assertEqual(isPanelOrFullWidth(), c.isPanelOrFull, 'isPanelOrFullWidth:');
        } finally {
            Settings.destroy();
        }
    });
}