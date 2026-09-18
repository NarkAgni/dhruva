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
import Gdk from 'gi://Gdk';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { Settings } from '../core/SettingsManager.js';
import { addSegmentedRow, addSwitchRow, addCustomSpinRow } from './PrefsWidgets.js';


export function buildLayoutPage(window, settings, createResetBtn) {
    const page = new Adw.PreferencesPage({
        title: _('Layout'),
        icon_name: 'view-grid-symbolic'
    });
    window.add(page);

    const posGroup = new Adw.PreferencesGroup({
        title: _('Screen Placement'),
        description: _('Where to place the dock on your display')
    });
    page.add(posGroup);

    addSegmentedRow(posGroup, settings, 'dock-position', _('Screen Edge'), _('Which edge to attach to'), 'go-bottom-symbolic', [
        { name: _('Left'), value: 'LEFT' },
        { name: _('Bottom'), value: 'BOTTOM' },
        { name: _('Top'), value: 'TOP' },
        { name: _('Right'), value: 'RIGHT' }
    ]);

    const display = Gdk.Display.get_default();
    const monitorsModel = display.get_monitors();
    let monitorOptions = [];

    for (let i = 0; i < monitorsModel.get_n_items(); i++) {
        const m = monitorsModel.get_item(i);
        const name = m.get_description() || m.get_connector() || `${_('Monitor')} ${i + 1}`;
        if (i === 0) {
            monitorOptions.push(_('Primary Monitor (%s)').replace('%s', name));
        } else {
            monitorOptions.push(name);
        }
    }

    const monitorModel = Gtk.StringList.new(monitorOptions);
    const monitorRow = new Adw.ComboRow({
        title: _('Preferred Monitor'),
        subtitle: _('Choose display for the dock'),
        icon_name: 'video-display-symbolic',
        model: monitorModel
    });

    const syncMonitor = () => {
        const val = Settings.preferredMonitor;
        monitorRow.set_selected(val === -1 ? 0 : val);
    };
    syncMonitor();

    monitorRow.connect('notify::selected', () => {
        const idx = monitorRow.get_selected();
        settings.set_string('preferred-monitor', idx === 0 ? -1 : idx);
    });

    settings.connect('changed::preferred-monitor', syncMonitor);
    posGroup.add(monitorRow);

    addSwitchRow(posGroup, settings, 'show-on-all-monitors', _('Show on All Monitors'), _('Display the dock on every connected screen'), 'video-display-symbolic', null);
    addSwitchRow(posGroup, settings, 'isolate-monitors', _('Isolate Monitors'), _('Only show apps running on the current monitor'), 'video-display-symbolic', null);

    const indepDockRow = addSwitchRow(
        posGroup,
        settings,
        'independent-dock',
        _('Independent Dock Mode'),
        _('Use completely separate pinned apps and custom app launcher'),
        'system-run-symbolic',
        null
    );

    const showIndepOverviewRow = addSwitchRow(
        posGroup,
        settings,
        'show-independent-in-overview',
        _('Show Independent Dock in Overview'),
        _('Shows dock on the left side during overview'),
        'view-grid-symbolic',
        null
    );

    addSwitchRow(posGroup, settings, 'full-width', _('Full Screen Width'), _('Extend dock edge to edge'), 'view-fullscreen-symbolic', null);

    const alignmentRow = addSegmentedRow(posGroup, settings, 'icon-alignment', _('Icon Alignment'), _('Justification when Full Width is active'), 'format-justify-center-symbolic', [
        { name: _('Start'), value: 'START' }, 
        { name: _('Center'), value: 'CENTER' },
        { name: _('End'), value: 'END' }
    ]);

    addCustomSpinRow(posGroup, settings, 'dock-margin', _('Edge Margin'), _('Distance from screen edge'), 'format-indent-less-symbolic', {
        lower: 0,
        upper: 50,
        step_increment: 1
    }, createResetBtn);

    const sizeGroup = new Adw.PreferencesGroup({
        title: _('Sizing & Spacing'),
        description: _('Base dimensions for dock and icons')
    });
    page.add(sizeGroup);

    addCustomSpinRow(sizeGroup, settings, 'icon-size', _('Base Icon Size'), _('Normal size of app icons'), 'zoom-original-symbolic', {
        lower: 16,
        upper: 128,
        step_increment: 2
    }, createResetBtn);

    addCustomSpinRow(sizeGroup, settings, 'icon-spacing', _('Icon Gap'), _('Distance between icons'), 'format-indent-more-symbolic', {
        lower: 0,
        upper: 30,
        step_increment: 1
    }, createResetBtn);

    const sidePaddingRow = addCustomSpinRow(sizeGroup, settings, 'dock-padding', _('Side Padding'), _('Extra gap inside dock ends'), 'format-justify-fill-symbolic', {
        lower: 0,
        upper: 150,
        step_increment: 2
    }, createResetBtn);

    addCustomSpinRow(sizeGroup, settings, 'dock-height', _('Dock Height / Thickness'), _('Extra padding on top/bottom (or left/right)'), 'format-justify-center-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 2
    }, createResetBtn);

    const syncLayoutVisibility = () => {
        const isFullWidth = settings.get_boolean('full-width');
        const showOnAll = settings.get_boolean('show-on-all-monitors');
        const isIndep = settings.get_boolean('independent-dock');

        alignmentRow.set_visible(isFullWidth);
        monitorRow.set_visible(!showOnAll);
        sidePaddingRow.set_visible(!isFullWidth);

        showIndepOverviewRow.set_visible(isIndep);
    };

    settings.connect('changed::full-width', syncLayoutVisibility);
    settings.connect('changed::show-on-all-monitors', syncLayoutVisibility);
    settings.connect('changed::independent-dock', syncLayoutVisibility);

    syncLayoutVisibility();
}