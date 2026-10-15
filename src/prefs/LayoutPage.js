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
import Gio from 'gi://Gio';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import {
    fmt, addGroup, addGroupReset, showWhen, addSwitchRow, addSliderRow, addSegmentedRow, addChoiceCards,
    roundedRect,
} from './PrefsWidgets.js';


const SHORTCUT_KEY = 'toggle-independent-dock-shortcut';
const SIZE_KEYS = ['icon-size', 'icon-spacing', 'dock-height', 'dock-padding', 'dock-margin'];

const MODIFIER_KEYS = [
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
];

function edgeArt(edge) {
    const area = new Gtk.DrawingArea({ content_width: 84, content_height: 54, halign: Gtk.Align.CENTER });
    area.set_draw_func((_area, cr, w, h) => {
        roundedRect(cr, 1, 1, w - 2, h - 2, 6);
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, 0.3);
        cr.setLineWidth(1);
        cr.stroke();

        const thick = 7;
        const gap = 4;
        const isVertical = edge === 'LEFT' || edge === 'RIGHT';
        const long = isVertical ? h * 0.6 : w * 0.6;
        let x = (w - long) / 2;
        let y = (h - long) / 2;
        if (edge === 'BOTTOM') y = h - thick - gap;
        else if (edge === 'TOP') y = gap;
        else if (edge === 'LEFT') x = gap;
        else x = w - thick - gap;

        roundedRect(cr, x, y, isVertical ? thick : long, isVertical ? long : thick, 3);
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.fill();
    });
    return area;
}

function addMonitorRow(group, settings) {
    const monitors = Gdk.Display.get_default().get_monitors();
    const names = [_('Primary monitor')];
    for (let i = 0; i < monitors.get_n_items(); i++) {
        const monitor = monitors.get_item(i);
        names.push(monitor.get_description() || monitor.get_connector() || `${_('Monitor')} ${i + 1}`);
    }

    const row = new Adw.ComboRow({
        title: _('Monitor'),
        subtitle: _('Screen that shows the dock'),
        model: Gtk.StringList.new(names),
    });
    const sync = () => {
        const index = settings.get_int('preferred-monitor');
        const selected = index >= 0 && index + 1 < names.length ? index + 1 : 0;
        if (row.get_selected() !== selected) row.set_selected(selected);
    };
    row.connect('notify::selected', () => {
        const value = row.get_selected() - 1;
        if (value !== settings.get_int('preferred-monitor')) settings.set_int('preferred-monitor', value);
    });
    onSettingChanged(settings, 'preferred-monitor', sync);
    sync();
    group.add(row);
    return row;
}

function openShortcutDialog(window, settings) {
    const dialog = new Adw.Window({
        transient_for: window,
        modal: true,
        title: _('Set Shortcut'),
        default_width: 380,
        default_height: 220,
        resizable: false,
    });

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
    });
    content.append(new Gtk.Image({ icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic', pixel_size: 48 }));
    content.append(new Gtk.Label({
        label: _('Press a key combination, e.g. Super+Alt+I\nEsc cancels, Backspace clears'),
        justify: Gtk.Justification.CENTER,
    }));
    dialog.set_content(content);

    const keys = new Gtk.EventControllerKey();
    keys.connect('key-pressed', (_controller, keyval, keycode, state) => {
        const mask = state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK |
            Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK);

        if (keyval === Gdk.KEY_Escape && mask === 0) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if ((keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete) && mask === 0) {
            settings.set_strv(SHORTCUT_KEY, []);
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (MODIFIER_KEYS.includes(keyval)) return Gdk.EVENT_PROPAGATE;

        const lower = Gdk.keyval_to_lower(keyval);
        const accel = Gtk.accelerator_name_with_keycode(null, lower, keycode, mask);
        if (!accel || !Gtk.accelerator_valid(lower, mask)) return Gdk.EVENT_PROPAGATE;

        settings.set_strv(SHORTCUT_KEY, [accel]);
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(keys);
    dialog.present();
}

function addShortcutRow(group, window, settings) {
    const row = new Adw.ActionRow({
        title: _('Toggle Shortcut'),
        subtitle: _('Switch independent mode from the keyboard'),
    });

    const label = new Gtk.ShortcutLabel({ disabled_text: _('None'), valign: Gtk.Align.CENTER });
    const setBtn = new Gtk.Button({ child: label, valign: Gtk.Align.CENTER, css_classes: ['flat'] });
    const clearBtn = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        tooltip_text: _('Remove shortcut'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
    });

    const sync = () => {
        const [accel] = settings.get_strv(SHORTCUT_KEY);
        const hasKey = Boolean(accel) && accel.trim() !== '';
        label.set_accelerator(hasKey ? accel : '');
        clearBtn.set_visible(hasKey);
    };
    setBtn.connect('clicked', () => openShortcutDialog(window, settings));
    clearBtn.connect('clicked', () => settings.set_strv(SHORTCUT_KEY, []));
    onSettingChanged(settings, SHORTCUT_KEY, sync);
    sync();

    row.add_suffix(setBtn);
    row.add_suffix(clearBtn);
    group.add(row);
    return row;
}


export function buildLayoutPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Layout'),
        icon_name: 'view-grid-symbolic',
    });

    const isPanel = () => settings.get_boolean('hybrid-panel-mode');
    const isFullBar = () => settings.get_boolean('full-width') || isPanel();

    const edgeGroup = addGroup(page, _('Screen Edge'), _('Where the dock lives'));
    addChoiceCards(edgeGroup, settings, 'dock-position', [
        { value: 'BOTTOM', title: _('Bottom'), art: edgeArt('BOTTOM') },
        { value: 'LEFT', title: _('Left'), art: edgeArt('LEFT') },
        { value: 'RIGHT', title: _('Right'), art: edgeArt('RIGHT') },
        { value: 'TOP', title: _('Top'), art: edgeArt('TOP') },
    ]);

    const screenGroup = addGroup(page, _('Monitors'));
    addSwitchRow(screenGroup, settings, 'show-on-all-monitors', _('Every Monitor'), _('Show a dock on each connected screen'));
    const monitorRow = addMonitorRow(screenGroup, settings);
    const isolateRow = addSwitchRow(screenGroup, settings, 'isolate-monitors', _('Apps per Monitor'),
        _('Each dock shows only the apps open on its own screen'));
    const onAll = () => settings.get_boolean('show-on-all-monitors');
    showWhen(monitorRow, settings, ['show-on-all-monitors'], () => !onAll());
    showWhen(isolateRow, settings, ['show-on-all-monitors'], onAll);

    const shapeGroup = addGroup(page, _('Shape'), _('Floating dock or a bar across the whole edge'));
    addSwitchRow(shapeGroup, settings, 'full-width', _('Full Width'), _('Stretch the dock from edge to edge'));
    const alignRow = addSegmentedRow(shapeGroup, settings, 'icon-alignment', _('Icon Alignment'),
        _('Where icons sit along the full-width bar'), [
            { name: _('Start'), value: 'START' },
            { name: _('Center'), value: 'CENTER' },
            { name: _('End'), value: 'END' },
        ]);
    showWhen(alignRow, settings, ['full-width'], () => settings.get_boolean('full-width'));
    showWhen(shapeGroup, settings, ['hybrid-panel-mode'], () => !isPanel());

    const sizeGroup = addGroup(page, _('Size &amp; Spacing'));
    addGroupReset(sizeGroup, settings, SIZE_KEYS);
    addSliderRow(sizeGroup, settings, 'icon-size', _('Icon Size'), null, { lower: 16, upper: 128, step: 2 }, fmt.px);
    addSliderRow(sizeGroup, settings, 'icon-spacing', _('Icon Gap'), null, { lower: 0, upper: 30, step: 1 }, fmt.px);
    addSliderRow(sizeGroup, settings, 'dock-height', _('Thickness'), _('Extra room above and below the icons'),
        { lower: 0, upper: 100, step: 2 }, fmt.px);
    const paddingRow = addSliderRow(sizeGroup, settings, 'dock-padding', _('End Padding'),
        _('Room at both ends of the dock'), { lower: 0, upper: 150, step: 2 }, fmt.px);
    const marginRow = addSliderRow(sizeGroup, settings, 'dock-margin', _('Edge Gap'),
        _('Distance from the screen edge'), { lower: 0, upper: 50, step: 1 }, fmt.px);
    showWhen(paddingRow, settings, ['full-width', 'hybrid-panel-mode'], () => !isFullBar());
    showWhen(marginRow, settings, ['hybrid-panel-mode'], () => !isPanel());

    const indepGroup = addGroup(page, _('Independent Dock'),
        _('Its own pinned apps and launcher, separate from GNOME favourites'));
    const indepSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('independent-dock', indepSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    indepGroup.set_header_suffix(indepSwitch);
    const overviewRow = addSwitchRow(indepGroup, settings, 'show-independent-in-overview', _('Show in Overview'),
        _('Keep the dock on the left side during the overview'));
    addShortcutRow(indepGroup, window, settings);
    showWhen(overviewRow, settings, ['independent-dock'], () => settings.get_boolean('independent-dock'));

    window.add(page);
}