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
import Gio from 'gi://Gio';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


function findTopHeaderBar(widget) {
    if (!widget) return null;
    if (widget.get_show_end_title_buttons && widget.pack_start) {
        return widget;
    }

    let child = widget.get_first_child();
    while (child) {
        const found = findTopHeaderBar(child);
        if (found) return found;
        child = child.get_next_sibling();
    }
    return null;
}

export function setupHeaderBar(prefs, window) {
    window.set_search_enabled(true);

    const headerBar = findTopHeaderBar(window);
    if (!headerBar) return;

    const coffeeLogo = Gtk.Image.new_from_file(`${prefs.path}/icons/bmc-logo.svg`);
    coffeeLogo.set_pixel_size(24);

    const coffeeBtn = new Gtk.Button({
        child: coffeeLogo,
        tooltip_text: _('Buy Me a Coffee'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'image-button'],
    });

    coffeeBtn.connect('clicked', () => {
        Gio.AppInfo.launch_default_for_uri(
            'https://buymeacoffee.com/narkagni',
            window.get_display().get_app_launch_context()
        );
    });

    headerBar.pack_start(coffeeBtn);
}