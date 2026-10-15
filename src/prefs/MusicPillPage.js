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

import { addGroup, addChoiceCards, showWhen } from './PrefsWidgets.js';


export function buildMusicPillPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Music Pill'),
        icon_name: 'audio-x-generic-symbolic',
    });

    const pillGroup = addGroup(page, _('Music Pill'),
        _('Now playing on the dock: artwork, controls and live lyrics. Works with Spotify'));
    const enableSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('show-music-pill', enableSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    pillGroup.set_header_suffix(enableSwitch);

    const placeGroup = addGroup(page, _('Placement'));
    addChoiceCards(placeGroup, settings, 'music-pill-position', [
        { value: 'START', icon: 'format-justify-left-symbolic', title: _('Before Apps'), description: _('At the start of the dock') },
        { value: 'END', icon: 'format-justify-right-symbolic', title: _('After Apps'), description: _('At the end of the dock') },
    ]);
    showWhen(placeGroup, settings, ['show-music-pill'], () => settings.get_boolean('show-music-pill'));

    const tipsGroup = addGroup(page, _('Using It'));
    tipsGroup.add(new Adw.ActionRow({ title: _('Right click'), subtitle: _('Opens the big player with the seek bar') }));
    tipsGroup.add(new Adw.ActionRow({ title: _('Double click'), subtitle: _('Shows or hides the Spotify window') }));
    tipsGroup.add(new Adw.ActionRow({ title: _('Scroll while hovering'), subtitle: _('Changes the volume') }));
    showWhen(tipsGroup, settings, ['show-music-pill'], () => settings.get_boolean('show-music-pill'));

    window.add(page);
}