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


import { buildAboutPage } from './src/prefs/AboutPage.js';
import { buildLayoutPage } from './src/prefs/LayoutPage.js';
import { buildModulesPage } from './src/prefs/ModulesPage.js';
import { buildBehaviorPage } from './src/prefs/BehaviorPage.js';
import { buildAppearancePage } from './src/prefs/AppearancePage.js';
import { makeResetBtn, makeGroupResetBtn } from './src/prefs/ResetButtons.js';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class DhruvaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settingsSignals = [];
        const settings = this.getSettings();

        const createResetBtn = makeResetBtn(this, settings);
        const createGroupReset = makeGroupResetBtn(this, settings);

        window.set_default_size(650, 800);
        window.set_search_enabled(true);

        buildLayoutPage(this, window, settings, createResetBtn, createGroupReset);
        buildAppearancePage(this, window, settings, createResetBtn, createGroupReset);
        buildBehaviorPage(this, window, settings, createResetBtn);
        buildModulesPage(this, window, settings);
        buildAboutPage(this, window);

        window.connect('destroy', () => {
            this._settingsSignals.forEach(id => settings.disconnect(id));
            this._settingsSignals = [];
        });
    }
}