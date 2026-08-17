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


export function buildAboutPage(prefs, window) {
    const page = new Adw.PreferencesPage({
        title: 'About',
        icon_name: 'help-about-symbolic'
    });
    window.add(page);

    buildAboutHero(prefs, page);
    buildAboutLinks(prefs, page, window);
    buildAboutAuthor(prefs, page);
    buildAboutDonations(prefs, page, window);
}

export function buildAboutHero(prefs, page) {
    const group = new Adw.PreferencesGroup();
    page.add(group);

    const heroBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        halign: Gtk.Align.CENTER,
        margin_top: 24,
        margin_bottom: 12
    });

    const logo = Gtk.Image.new_from_file(`${prefs.path}/icons/logo.svg`);
    logo.set_pixel_size(128);
    heroBox.append(logo);

    heroBox.append(new Gtk.Label({
        label: '<span size="xx-large" weight="bold">Dhruva Dock</span>',
        use_markup: true,
        margin_top: 8
    }));
    heroBox.append(new Gtk.Label({
        label: 'A beautifully crafted, highly customisable dock for GNOME Shell',
        css_classes: ['dim-label'],
        margin_bottom: 4
    }));
    heroBox.append(new Gtk.Label({
        label: 'Version 1  •  GPL-3.0',
        css_classes: ['dim-label', 'caption']
    }));

    const row = new Adw.ActionRow();
    row.set_child(heroBox);
    group.add(row);
}

export function buildAboutLinks(prefs, page, window) {
    const group = new Adw.PreferencesGroup({
        title: 'Links'
    });
    page.add(group);

    const addLink = (title, subtitle, icon, url) => {
        const row = new Adw.ActionRow({
            title,
            subtitle,
            icon_name: icon,
            activatable: true
        });
        row.add_suffix(new Gtk.Image({
            icon_name: 'adw-external-link-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label']
        }));

        row.connect('activated', () => {
            Gio.AppInfo.launch_default_for_uri(url, window.get_display().get_app_launch_context());
        });
        group.add(row);
    };

    addLink('GitHub Repository', 'github.com/narkagni/dhruva', 'system-software-install-symbolic', 'https://github.com/narkagni/dhruva');
}

export function buildAboutAuthor(prefs, page) {
    const group = new Adw.PreferencesGroup({
        title: 'Credits'
    });
    page.add(group);
    group.add(new Adw.ActionRow({
        title: 'Narkagni',
        subtitle: 'Author &amp; Maintainer',
        icon_name: 'avatar-default-symbolic'
    }));

    group.add(new Adw.ActionRow({
        title: 'Features',
        subtitle: 'Per-app running indicators · ' +
            'Hover zoom magnification · Window minimize effects (Magic Lamp, Snake, Vortex &amp; more) · ' +
            'Icon click animations (Bounce, Jelly, Heartbeat &amp; 20+ styles) · ' +
            'Intelligent auto-hide with edge pressure reveal · ' +
            'Chameleon theme (wallpaper colour matching) · ' +
            'Full-width dock mode · Multi-monitor support · ' +
            'Custom folders, Trash, Desktop button &amp; App Grid · ' +
            'Workspace isolation · Aero Peek window previews · ' +
            'Lock icons to prevent accidental reorder',
        icon_name: 'starred-symbolic'
    }));

    group.add(new Adw.ActionRow({
        title: 'Disclaimer',
        subtitle: 'Dhruva Dock is an independent open-source project.',
        icon_name: 'dialog-information-symbolic'
    }));
}

export function buildAboutDonations(prefs, page, window) {
    const group = new Adw.PreferencesGroup({
        title: 'Support Development',
        description: 'If you enjoy Dhruva, consider buying me a coffee ☕ or sending crypto!'
    });
    page.add(group);

    const coffeeRow = new Adw.ActionRow({
        title: 'Buy Me a Coffee',
        subtitle: 'buymeacoffee.com/narkagni',
        icon_name: 'emoji-food-symbolic',
        activatable: true
    });
    coffeeRow.add_suffix(new Gtk.Image({
        icon_name: 'adw-external-link-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['dim-label']
    }));
    coffeeRow.connect('activated', () => {
        Gio.AppInfo.launch_default_for_uri('https://buymeacoffee.com/narkagni', window.get_display().get_app_launch_context());
    });
    group.add(coffeeRow);

    const addCrypto = (coin, icon, address) => {
        let shortAddress = address;
        if (address.length > 24) {
            shortAddress = address.substring(0, 12) + '…' + address.slice(-8);
        }

        const row = new Adw.ActionRow({
            title: coin,
            subtitle: shortAddress,
            icon_name: icon
        });
        const copyBtn = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
            tooltip_text: `Copy ${coin} address`
        });

        copyBtn.connect('clicked', () => {
            window.get_display().get_clipboard().set_content(Gdk.ContentProvider.new_for_value(address));
            try {
                window.add_toast(new Adw.Toast({
                    title: `${coin} address copied!`,
                    timeout: 2
                }));
            } catch (error) { }
        });

        row.add_suffix(copyBtn);
        group.add(row);
    };

    addCrypto('Bitcoin (BTC)', 'security-high-symbolic', '1GSHkxfhYjk1Qe4AQSHg3aRN2jg2GQWAcV');
    addCrypto('Ethereum (ETH)', 'emblem-shared-symbolic', '0xf43c3f83e53495ea06676c0d9d4fc87ce627ffa3');
    addCrypto('Tether (USDT - TRC20)', 'security-medium-symbolic', 'THnqG9nchLgaf1LzGK3CqdmNpRxw59hs82');
}