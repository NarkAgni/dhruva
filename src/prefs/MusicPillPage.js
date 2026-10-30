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
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { addGroup, addGroupReset, addChoiceCards, addComboRow, addSwitchRow, showWhen } from './PrefsWidgets.js';


const MOUSE_KEYS = [
    'music-pill-click-action', 'music-pill-double-click-action', 'music-pill-middle-click-action',
    'music-pill-right-click-action', 'music-pill-scroll-action',
];

const CLICK_ACTIONS = () => [
    { name: _('Nothing'), value: 'none' },
    { name: _('Play or Pause'), value: 'play-pause' },
    { name: _('Next Track'), value: 'next' },
    { name: _('Previous Track'), value: 'previous' },
    { name: _('Open Big Player'), value: 'player' },
    { name: _('Show or Hide Player'), value: 'window' },
];


export function buildMusicPillPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Music Pill'),
        icon_name: 'audio-x-generic-symbolic',
    });

    const pillGroup = addGroup(page, _('Music Pill'),
        _('Now playing on the dock: artwork, controls and live lyrics. Works with Spotify, browsers and other music players'));
    const enableSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('show-music-pill', enableSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    pillGroup.set_header_suffix(enableSwitch);

    const placeGroup = addGroup(page, _('Placement'));
    addChoiceCards(placeGroup, settings, 'music-pill-position', [
        { value: 'START', icon: 'format-justify-left-symbolic', title: _('Before Apps'), description: _('At the start of the dock') },
        { value: 'END', icon: 'format-justify-right-symbolic', title: _('After Apps'), description: _('At the end of the dock') },
    ]);
    showWhen(placeGroup, settings, ['show-music-pill'], () => settings.get_boolean('show-music-pill'));

    const lookGroup = addGroup(page, _('Look'));
    addComboRow(lookGroup, settings, 'music-pill-progress', _('Track Progress'), _('Where the progress line is drawn'), [
        { name: _('Around the Pill'), value: 'pill' },
        { name: _('Around the Artwork'), value: 'art' },
        { name: _('Hidden'), value: 'none' },
    ]);
    addSwitchRow(lookGroup, settings, 'music-pill-show-prev', _('Previous Button'), _('Appears when hovering the pill'));
    addSwitchRow(lookGroup, settings, 'music-pill-show-next', _('Next Button'), _('Appears when hovering the pill'));
    addSwitchRow(lookGroup, settings, 'music-pill-lyrics', _('Live Lyrics'), _('Show the song’s lyrics on the pill as it plays. Lyrics come from lrclib.net'));

    const mouseGroup = addGroup(page, _('Mouse'), _('What the pill does when you click or scroll on it'));
    addGroupReset(mouseGroup, settings, MOUSE_KEYS);
    addComboRow(mouseGroup, settings, 'music-pill-click-action', _('Click'),
        _('Waits a moment to tell it apart from a double click, unless Double Click does nothing'), CLICK_ACTIONS());
    addComboRow(mouseGroup, settings, 'music-pill-double-click-action', _('Double Click'), null, CLICK_ACTIONS());
    addComboRow(mouseGroup, settings, 'music-pill-middle-click-action', _('Middle Click'), null, CLICK_ACTIONS());
    addComboRow(mouseGroup, settings, 'music-pill-right-click-action', _('Right Click'), null, CLICK_ACTIONS());
    addComboRow(mouseGroup, settings, 'music-pill-scroll-action', _('Scroll'), null, [
        { name: _('Change Volume'), value: 'volume' },
        { name: _('Seek 5 Seconds'), value: 'seek' },
        { name: _('Next or Previous Track'), value: 'track' },
        { name: _('Nothing'), value: 'none' },
    ]);

    for (const group of [lookGroup, mouseGroup])
        showWhen(group, settings, ['show-music-pill'], () => settings.get_boolean('show-music-pill'));

    window.add(page);
}