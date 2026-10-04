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

    addSwitchRow(
        posGroup,
        settings,
        'independent-dock',
        _('Independent Dock Mode'),
        _('Use completely separate pinned apps and custom app launcher'),
        'system-run-symbolic',
        null
    );

    const indepShortcutRow = new Adw.ActionRow({
        title: _('Toggle Shortcut'),
        subtitle: _('Keyboard shortcut to switch independent dock mode'),
        icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'
    });

    const shortcutBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER
    });

    const shortcutBtn = new Gtk.Button({
        valign: Gtk.Align.CENTER,
        css_classes: ['flat']
    });

    const shortcutLabel = new Gtk.ShortcutLabel({
        disabled_text: _('None'),
        valign: Gtk.Align.CENTER
    });
    shortcutBtn.set_child(shortcutLabel);

    const divider = new Gtk.Separator({
        orientation: Gtk.Orientation.VERTICAL,
        valign: Gtk.Align.CENTER,
        margin_top: 6,
        margin_bottom: 6
    });

    const resetShortcutBtn = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: _('Reset Shortcut'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular']
    });

    const updateShortcutBtnText = () => {
        const val = Settings.toggleIndependentDockShortcut;
        const hasKey = Boolean(val && val.length > 0 && val[0].trim() !== '');
        if (hasKey) {
            shortcutLabel.set_accelerator(val[0]);
            divider.set_visible(true);
            resetShortcutBtn.set_visible(true);
        } else {
            shortcutLabel.set_accelerator('');
            divider.set_visible(false);
            resetShortcutBtn.set_visible(false);
        }
    };

    resetShortcutBtn.connect('clicked', () => {
        Settings.toggleIndependentDockShortcut = [];
        updateShortcutBtnText();
    });

    updateShortcutBtnText();

    const openShortcutDialog = () => {
        const dialog = new Adw.Window({
            transient_for: window,
            modal: true,
            title: _('Set Shortcut'),
            default_width: 380,
            default_height: 220,
            resizable: false
        });

        const rootBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 16,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER
        });

        const icon = new Gtk.Image({
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            pixel_size: 48
        });

        const instructionLabel = new Gtk.Label({
            label: _('Press keys combo (e.g. Super+Alt+I or Ctrl+Alt+D)\n(Esc to Cancel, Backspace to Clear)'),
            justify: Gtk.Justification.CENTER
        });

        const clearBtn = new Gtk.Button({
            label: _('Clear Shortcut'),
            halign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        clearBtn.connect('clicked', () => {
            Settings.toggleIndependentDockShortcut = [];
            updateShortcutBtnText();
            dialog.close();
        });

        rootBox.append(icon);
        rootBox.append(instructionLabel);
        rootBox.append(clearBtn);
        dialog.set_content(rootBox);

        const dialogKeyController = new Gtk.EventControllerKey();
        dialogKeyController.connect('key-pressed', (_controller, keyval, keycode, state) => {
            const cleanMask = state & (
                Gdk.ModifierType.CONTROL_MASK |
                Gdk.ModifierType.SHIFT_MASK |
                Gdk.ModifierType.ALT_MASK |
                Gdk.ModifierType.SUPER_MASK
            );

            if (keyval === Gdk.KEY_Escape && cleanMask === 0) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            if ((keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete) && cleanMask === 0) {
                Settings.toggleIndependentDockShortcut = [];
                updateShortcutBtnText();
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            const isModifierKey = [
                Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
                Gdk.KEY_Control_L, Gdk.KEY_Control_R,
                Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
                Gdk.KEY_Super_L, Gdk.KEY_Super_R,
                Gdk.KEY_Meta_L, Gdk.KEY_Meta_R
            ].includes(keyval);

            if (isModifierKey) {
                return Gdk.EVENT_PROPAGATE;
            }

            const lowerKeyval = Gdk.keyval_to_lower(keyval);
            const accel = Gtk.accelerator_name_with_keycode(null, lowerKeyval, keycode, cleanMask);

            if (accel && Gtk.accelerator_valid(lowerKeyval, cleanMask)) {
                Settings.toggleIndependentDockShortcut = [accel];
                updateShortcutBtnText();
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            return Gdk.EVENT_PROPAGATE;
        });

        dialog.add_controller(dialogKeyController);
        dialog.present();
    };

    shortcutBtn.connect('clicked', openShortcutDialog);
    settings.connect('changed::toggle-independent-dock-shortcut', updateShortcutBtnText);

    shortcutBox.append(shortcutBtn);
    shortcutBox.append(divider);
    shortcutBox.append(resetShortcutBtn);
    indepShortcutRow.add_suffix(shortcutBox);
    posGroup.add(indepShortcutRow);

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
        title: _('Sizing &amp; Spacing'),
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

        indepShortcutRow.set_visible(isIndep);
        showIndepOverviewRow.set_visible(isIndep);
    };

    settings.connect('changed::full-width', syncLayoutVisibility);
    settings.connect('changed::show-on-all-monitors', syncLayoutVisibility);
    settings.connect('changed::independent-dock', syncLayoutVisibility);

    syncLayoutVisibility();
}