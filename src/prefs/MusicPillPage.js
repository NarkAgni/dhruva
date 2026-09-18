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


import Adw from 'gi://Adw';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { addSwitchRow, addSegmentedRow } from './PrefsWidgets.js';


export function buildMusicPillPage(window, settings, createResetBtn) {
    const page = new Adw.PreferencesPage({
        title: _('Music Pill'),
        icon_name: 'audio-x-generic-symbolic'
    });
    window.add(page);

    const generalGroup = new Adw.PreferencesGroup({
        title: _('General Settings'),
        description: _('Configure live media player widget on the dock')
    });
    page.add(generalGroup);

    addSwitchRow(
        generalGroup,
        settings,
        'show-music-pill',
        _('Show Music Pill'),
        _('Display currently playing media and controls'),
        'audio-x-generic-symbolic',
        createResetBtn
    );

    const musicPosRow = addSegmentedRow(
        generalGroup,
        settings,
        'music-pill-position',
        _('Pill Placement'),
        _('Position of the pill on dock'),
        'format-justify-left-symbolic',
        [
            { name: _('Start'), value: 'START' },
            { name: _('End'), value: 'END' }
        ]
    );

    const syncVisibility = () => {
        const isEnabled = settings.get_boolean('show-music-pill');
        musicPosRow.set_visible(isEnabled);
    };

    settings.connect('changed::show-music-pill', syncVisibility);
    syncVisibility();
}