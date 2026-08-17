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


export function addCustomSpinRow(parent, settings, key, title, subtitle, icon, adjParams, createResetBtn, digits = 0) {
    const row = new Adw.ActionRow({
        title,
        subtitle,
        icon_name: icon
    });
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment(adjParams),
        numeric: true,
        digits: digits,
        valign: Gtk.Align.CENTER
    });
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(spin);

    if (createResetBtn) {
        row.add_suffix(createResetBtn(key));
    }

    if (parent.add_row) {
        parent.add_row(row);
    } else {
        parent.add(row);
    }
    
    return row;
}

export function addSwitchRow(parent, settings, key, title, subtitle, icon, createResetBtn) {
    const row = new Adw.ActionRow({
        title,
        subtitle,
        icon_name: icon
    });
    const sw = new Gtk.Switch({
        valign: Gtk.Align.CENTER
    });
    settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(sw);

    if (createResetBtn) {
        row.add_suffix(createResetBtn(key));
    }

    if (parent.add_row) {
        parent.add_row(row);
    } else {
        parent.add(row);
    }
    
    return row;
}

export function addComboRow(prefs, parent, settings, key, title, subtitle, icon, optionsArr, createResetBtn) {
    const model = Gtk.StringList.new(optionsArr.map(opt => opt.name));
    const row = new Adw.ComboRow({
        title,
        subtitle,
        icon_name: icon,
        model
    });

    const syncUI = () => {
        const val = settings.get_string(key);
        const idx = optionsArr.findIndex(opt => opt.value === val);
        if (idx >= 0) row.set_selected(idx);
    };
    syncUI();

    row.connect('notify::selected', () => {
        settings.set_string(key, optionsArr[row.get_selected()].value);
    });
    prefs._settingsSignals.push(settings.connect(`changed::${key}`, syncUI));

    if (createResetBtn) {
        row.add_suffix(createResetBtn(key));
    }

    if (parent.add_row) {
        parent.add_row(row);
    } else {
        parent.add(row);
    }
    
    return row;
}

export function addSegmentedRow(prefs, parent, settings, key, title, subtitle, icon, optionsArr) {
    const row = new Adw.ActionRow({
        title,
        subtitle,
        icon_name: icon
    });
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        css_classes: ['linked'],
        valign: Gtk.Align.CENTER
    });

    let buttons = [];
    optionsArr.forEach((opt, i) => {
        const btn = new Gtk.ToggleButton({
            label: opt.name
        });
        if (i > 0) btn.set_group(buttons[0].btn);
        buttons.push({
            btn,
            value: opt.value
        });
        box.append(btn);

        btn.connect('toggled', () => {
            if (btn.get_active()) settings.set_string(key, opt.value);
        });
    });

    const syncUI = () => {
        const target = buttons.find(b => b.value === settings.get_string(key));
        if (target && !target.btn.get_active()) {
            target.btn.set_active(true);
        }
    };
    syncUI();

    prefs._settingsSignals.push(settings.connect(`changed::${key}`, syncUI));
    row.add_suffix(box);

    if (parent.add_row) {
        parent.add_row(row);
    } else {
        parent.add(row);
    }
    
    return row;
}

export function addColorRow(prefs, parent, settings, key, title, icon) {
    const row = new Adw.ActionRow({
        title,
        icon_name: icon
    });
    const rgba = new Gdk.RGBA();

    if (!rgba.parse(settings.get_string(key))) {
        rgba.parse('#ffffff');
    }

    const colorDialog = new Gtk.ColorDialog();
    const colorButton = new Gtk.ColorDialogButton({
        dialog: colorDialog,
        rgba: rgba,
        valign: Gtk.Align.CENTER
    });

    colorButton.connect('notify::rgba', () => {
        const c = colorButton.get_rgba();
        const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
        settings.set_string(key, `#${toHex(c.red)}${toHex(c.green)}${toHex(c.blue)}`);
    });

    prefs._settingsSignals.push(settings.connect(`changed::${key}`, () => {
        const newRgba = new Gdk.RGBA();
        if (newRgba.parse(settings.get_string(key))) {
            colorButton.set_rgba(newRgba);
        }
    }));

    row.add_suffix(colorButton);
    
    if (parent.add_row) {
        parent.add_row(row);
    } else {
        parent.add(row);
    }
    
    return row;
}