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


import Gtk from 'gi://Gtk';


export function makeResetBtn(settings) {
    return (key) => {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER
        });

        const divider = new Gtk.Separator({
            orientation: Gtk.Orientation.VERTICAL
        });
        divider.set_margin_top(8);
        divider.set_margin_bottom(8);
        box.append(divider);

        const btn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
            tooltip_text: 'Reset to default'
        });

        const update = () => {
            const isDef = settings.get_value(key).equal(settings.get_default_value(key));
            btn.set_sensitive(!isDef);
            btn.set_opacity(isDef ? 0.3 : 1.0);
        };

        btn.connect('clicked', () => settings.reset(key));
        settings.connect(`changed::${key}`, update);
        update();

        box.append(btn);
        return box;
    };
}

export function makeGroupResetBtn(settings) {
    return (keys) => {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER
        });

        const divider = new Gtk.Separator({
            orientation: Gtk.Orientation.VERTICAL
        });
        divider.set_margin_top(8);
        divider.set_margin_bottom(8);
        box.append(divider);

        const btn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
            tooltip_text: 'Reset all in this group'
        });

        const update = () => {
            const anyChanged = keys.some(key =>
                settings.settings_schema.has_key(key) &&
                !settings.get_value(key).equal(settings.get_default_value(key))
            );
            btn.set_sensitive(anyChanged);
            btn.set_opacity(anyChanged ? 1.0 : 0.3);
        };

        btn.connect('clicked', () => {
            keys.forEach(k => {
                if (settings.settings_schema.has_key(k)) {
                    settings.reset(k);
                }
            });
        });

        keys.forEach(k => {
            if (settings.settings_schema.has_key(k)) {
                settings.connect(`changed::${k}`, update);
            }
        });
        update();

        box.append(btn);
        return box;
    };
}