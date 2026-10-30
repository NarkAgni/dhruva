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
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { addGroup } from './PrefsWidgets.js';
import { PresetPreview } from './PresetPreview.js';
import { onSettingChanged } from './SettingsSignals.js';
import {
    PRESETS, PRESET_KEYS, presetValues, applyValues, savedPreset, isCustomized,
} from './Presets.js';


const PREVIEW_HEIGHT = 260;
const EXTRA_WATCHED_KEYS = ['background-color', 'active-preset'];


function buildChoice(settings, preset, group, onSelect) {
    const values = presetValues(settings, preset);
    const check = new Gtk.Image({ icon_name: 'object-select-symbolic', pixel_size: 14, visible: false });
    const content = new Gtk.Box({ spacing: 8, halign: Gtk.Align.CENTER, margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12 });
    content.append(new Gtk.Label({ label: preset.name, css_classes: ['heading'] }));
    content.append(check);

    const button = new Gtk.ToggleButton({ child: content, tooltip_text: preset.description, css_classes: ['card'] });
    if (group) button.set_group(group);
    button.connect('toggled', () => {
        if (button.active) onSelect();
    });
    return { preset, values, button, check };
}


export function buildPresetsPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Presets'),
        icon_name: 'starred-symbolic',
    });

    const heroGroup = addGroup(page, _('Presets'),
        _('Choose a style to see it here, then apply it. You can still change any setting afterwards'));
    const preview = new PresetPreview(settings, PREVIEW_HEIGHT);
    const status = new Gtk.Label({ css_classes: ['dim-label'], hexpand: true, xalign: 0, wrap: true });
    const applyButton = new Gtk.Button({
        label: _('Apply'),
        sensitive: false,
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action', 'pill'],
    });

    const actionRow = new Gtk.Box({ spacing: 12, margin_top: 12 });
    actionRow.append(status);
    actionRow.append(applyButton);

    const hero = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    hero.append(preview.widget);
    hero.append(actionRow);
    heroGroup.add(hero);

    const styleGroup = addGroup(page, _('Styles'));
    const flow = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: true,
        min_children_per_line: 2,
        max_children_per_line: 4,
        column_spacing: 10,
        row_spacing: 10,
    });
    styleGroup.add(flow);

    let selected = null;
    let syncId = 0;

    const syncStatus = () => {
        const active = savedPreset(settings);
        const isChanged = isCustomized(settings, active);
        const isOther = selected !== null && selected.preset.id !== active.id;
        applyButton.sensitive = isOther || (selected !== null && isChanged);
        applyButton.label = isOther || !isChanged ? _('Apply') : _('Reset to Preset');

        if (isOther) status.label = `${selected.preset.description}. ${_('Not applied yet')}`;
        else if (isChanged) status.label = _('Current style: %s, with your own changes').format(active.name);
        else status.label = _('Current style: %s').format(active.name);
    };

    const choices = [];
    for (const preset of PRESETS()) {
        const choice = buildChoice(settings, preset, choices.length > 0 ? choices[0].button : null, () => {
            selected = choice;
            preview.setOverride(choice.values);
            syncStatus();
        });
        choices.push(choice);
        flow.append(choice.button);
    }

    applyButton.connect('clicked', () => {
        applyValues(settings, selected.values, selected.preset.id);
    });

    const sync = () => {
        const active = savedPreset(settings);
        for (const choice of choices) choice.check.visible = active.id === choice.preset.id;
        if (selected && active.id === selected.preset.id) preview.setOverride(null);
        else preview.redraw();
        syncStatus();
    };

    const queueSync = () => {
        if (syncId) return;
        syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            syncId = 0;
            sync();
            return GLib.SOURCE_REMOVE;
        });
    };

    for (const key of [...PRESET_KEYS, ...EXTRA_WATCHED_KEYS]) {
        if (settings.settings_schema.has_key(key)) onSettingChanged(settings, key, queueSync);
    }
    page.connect('unrealize', () => {
        if (syncId) GLib.source_remove(syncId);
        syncId = 0;
    });

    const activeId = savedPreset(settings).id;
    choices.find(choice => choice.preset.id === activeId).button.active = true;
    sync();
    window.add(page);
}