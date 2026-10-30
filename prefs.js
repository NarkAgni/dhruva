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


import { buildBlurPage } from './src/prefs/BlurPage.js';
import { buildPresetsPage } from './src/prefs/PresetsPage.js';
import { buildPanelPage } from './src/prefs/PanelPage.js';
import { buildAboutPage } from './src/prefs/AboutPage.js';
import { setupHeaderBar } from './src/prefs/HeaderBar.js';
import { buildLayoutPage } from './src/prefs/LayoutPage.js';
import { buildModulesPage } from './src/prefs/ModulesPage.js';
import { buildBehaviorPage } from './src/prefs/BehaviorPage.js';
import { migrateSettings } from './src/core/SettingsMigration.js';
import { buildMusicPillPage } from './src/prefs/MusicPillPage.js';
import { buildAppearancePage } from './src/prefs/AppearancePage.js';
import { disconnectSettingSignals } from './src/prefs/SettingsSignals.js';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class DhruvaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        migrateSettings(settings, this.metadata['version-name']);

        buildPresetsPage(window, settings);
        buildLayoutPage(window, settings);
        buildPanelPage(window, settings);
        buildAppearancePage(window, settings);
        buildBlurPage(window, settings);
        buildBehaviorPage(window, settings);
        buildModulesPage(this, window, settings);
        buildMusicPillPage(window, settings);
        buildAboutPage(this, window);
        setupHeaderBar(this, window);

        window.connect('close-request', () => {
            disconnectSettingSignals();
            return false;
        });
    }
}