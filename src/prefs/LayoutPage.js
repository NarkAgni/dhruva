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

import { addSegmentedRow, addSwitchRow, addCustomSpinRow } from './PrefsWidgets.js';


export function buildLayoutPage(prefs, window, settings, createResetBtn, createGroupReset) {
    const page = new Adw.PreferencesPage({
        title: 'Layout',
        icon_name: 'view-grid-symbolic'
    });
    window.add(page);

    const posGroup = new Adw.PreferencesGroup({
        title: 'Screen Placement',
        description: 'Where to place the dock on your display'
    });
    page.add(posGroup);

    addSegmentedRow(prefs, posGroup, settings, 'dock-position', 'Screen Edge', 'Which edge to attach to', 'go-bottom-symbolic', [{
        name: 'Left',
        value: 'LEFT'
    },
    {
        name: 'Bottom',
        value: 'BOTTOM'
    },
    {
        name: 'Top',
        value: 'TOP'
    },
    {
        name: 'Right',
        value: 'RIGHT'
    }
    ]);

    const display = Gdk.Display.get_default();
    const monitorsModel = display.get_monitors();
    let monitorOptions = [];

    for (let i = 0; i < monitorsModel.get_n_items(); i++) {
        const m = monitorsModel.get_item(i);
        const name = m.get_description() || m.get_connector() || `Monitor ${i + 1}`;
        if (i === 0) {
            monitorOptions.push(`Primary Monitor (${name})`);
        } else {
            monitorOptions.push(name);
        }
    }

    const monitorModel = Gtk.StringList.new(monitorOptions);
    const monitorRow = new Adw.ComboRow({
        title: 'Preferred Monitor',
        subtitle: 'Choose display for the dock',
        icon_name: 'video-display-symbolic',
        model: monitorModel
    });

    const syncMonitor = () => {
        const val = settings.get_int('preferred-monitor');
        monitorRow.set_selected(val === -1 ? 0 : val);
    };
    syncMonitor();

    monitorRow.connect('notify::selected', () => {
        const idx = monitorRow.get_selected();
        settings.set_string('preferred-monitor', idx === 0 ? -1 : idx);
    });

    prefs._settingsSignals.push(settings.connect('changed::preferred-monitor', syncMonitor));
    posGroup.add(monitorRow);

    addSwitchRow(posGroup, settings, 'show-on-all-monitors', 'Show on All Monitors', 'Display the dock on every connected screen', 'video-display-symbolic', null);
    addSwitchRow(posGroup, settings, 'isolate-monitors', 'Isolate Monitors', 'Only show apps running on the current monitor', 'video-display-symbolic', null);

    addSwitchRow(posGroup, settings, 'independent-dock', 'Independent Dock Mode', 'Use completely separate pinned apps and custom app launcher', 'system-run-symbolic', null);
    const showIndepOverviewRow = addSwitchRow(posGroup, settings, 'show-independent-in-overview', 'Show Independent Dock in Overview', 'Shows dock on the left side during overview', 'view-grid-symbolic', null);
    const fullWidthRow = addSwitchRow(posGroup, settings, 'full-width', 'Full Screen Width', 'Extend dock edge to edge', 'view-fullscreen-symbolic', null);

    const alignmentRow = addSegmentedRow(prefs, posGroup, settings, 'icon-alignment', 'Icon Alignment', 'Justification when Full Width is active', 'format-justify-center-symbolic', [{
        name: 'Start',
        value: 'START'
    }, 
    {
        name: 'Center',
        value: 'CENTER'
    },
    {
        name: 'End',
        value: 'END'
    }
    ]);

    addCustomSpinRow(posGroup, settings, 'dock-margin', 'Edge Margin', 'Distance from screen edge', 'format-indent-less-symbolic', {
        lower: 0,
        upper: 50,
        step_increment: 1
    }, createResetBtn);

    const sizeGroup = new Adw.PreferencesGroup({
        title: 'Sizing &amp; Spacing',
        description: 'Base dimensions for dock and icons'
    });
    page.add(sizeGroup);

    addCustomSpinRow(sizeGroup, settings, 'icon-size', 'Base Icon Size', 'Normal size of app icons', 'zoom-original-symbolic', {
        lower: 16,
        upper: 128,
        step_increment: 2
    }, createResetBtn);
    addCustomSpinRow(sizeGroup, settings, 'icon-spacing', 'Icon Gap', 'Distance between icons', 'format-indent-more-symbolic', {
        lower: 0,
        upper: 30,
        step_increment: 1
    }, createResetBtn);
    const sidePaddingRow = addCustomSpinRow(sizeGroup, settings, 'dock-padding', 'Side Padding', 'Extra gap inside dock ends', 'format-justify-fill-symbolic', {
        lower: 0,
        upper: 150,
        step_increment: 2
    }, createResetBtn);

    addCustomSpinRow(sizeGroup, settings, 'dock-height', 'Dock Height / Thickness', 'Extra padding on top/bottom (or left/right)', 'format-justify-center-symbolic', {
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

    prefs._settingsSignals.push(settings.connect('changed::full-width', syncLayoutVisibility));
    prefs._settingsSignals.push(settings.connect('changed::show-on-all-monitors', syncLayoutVisibility));
    prefs._settingsSignals.push(settings.connect('changed::independent-dock', syncLayoutVisibility));
    syncLayoutVisibility();
}