/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    ExtensionPreferences
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class DhruvaPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        this._settingsSignals = [];
        const settings = this.getSettings();

        const createResetBtn = this._makeResetBtn(settings);
        const createGroupReset = this._makeGroupResetBtn(settings);

        window.set_default_size(650, 800);
        window.set_search_enabled(true);

        this._buildLayoutPage(window, settings, createResetBtn, createGroupReset);
        this._buildAppearancePage(window, settings, createResetBtn, createGroupReset);
        this._buildBehaviorPage(window, settings, createResetBtn);
        this._buildModulesPage(window, settings);
        this._buildAboutPage(window);

        window.connect('destroy', () => {
            this._settingsSignals.forEach(id => settings.disconnect(id));
            this._settingsSignals = [];
        });
    }

    _buildAboutPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic'
        });
        window.add(page);

        this._buildAboutHero(page);
        this._buildAboutLinks(page, window);
        this._buildAboutAuthor(page);
        this._buildAboutDonations(page, window);
    }

    _makeResetBtn(settings) {
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
            this._settingsSignals.push(settings.connect(`changed::${key}`, update));
            update();

            box.append(btn);
            return box;
        };
    }

    _makeGroupResetBtn(settings) {
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
                    this._settingsSignals.push(settings.connect(`changed::${k}`, update));
                }
            });
            update();

            box.append(btn);
            return box;
        };
    }

    _addCustomSpinRow(parent, settings, key, title, subtitle, icon, adjParams, createResetBtn, digits = 0) {
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

        typeof parent.add_row === 'function' ? parent.add_row(row) : parent.add(row);
        return row;
    }

    _addSwitchRow(parent, settings, key, title, subtitle, icon, createResetBtn) {
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

        typeof parent.add_row === 'function' ? parent.add_row(row) : parent.add(row);
        return row;
    }

    _addComboRow(parent, settings, key, title, subtitle, icon, optionsArr, createResetBtn) {
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
        this._settingsSignals.push(settings.connect(`changed::${key}`, syncUI));

        if (createResetBtn) {
            row.add_suffix(createResetBtn(key));
        }

        typeof parent.add_row === 'function' ? parent.add_row(row) : parent.add(row);
        return row;
    }

    _addSegmentedRow(parent, settings, key, title, subtitle, icon, optionsArr) {
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

        this._settingsSignals.push(settings.connect(`changed::${key}`, syncUI));
        row.add_suffix(box);

        typeof parent.add_row === 'function' ? parent.add_row(row) : parent.add(row);
        return row;
    }

    _addColorRow(parent, settings, key, title, icon) {
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

        this._settingsSignals.push(settings.connect(`changed::${key}`, () => {
            const newRgba = new Gdk.RGBA();
            if (newRgba.parse(settings.get_string(key))) {
                colorButton.set_rgba(newRgba);
            }
        }));

        row.add_suffix(colorButton);
        typeof parent.add_row === 'function' ? parent.add_row(row) : parent.add(row);
        return row;
    }

    _buildLayoutPage(window, settings, createResetBtn, createGroupReset) {
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

        this._addSegmentedRow(posGroup, settings, 'dock-position', 'Screen Edge', 'Which edge to attach to', 'go-bottom-symbolic', [{
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

        this._settingsSignals.push(settings.connect('changed::preferred-monitor', syncMonitor));
        posGroup.add(monitorRow);

        this._addSwitchRow(posGroup, settings, 'show-on-all-monitors', 'Show on All Monitors', 'Display the dock on every connected screen', 'video-display-symbolic', null);
        this._addSwitchRow(posGroup, settings, 'isolate-monitors', 'Isolate Monitors', 'Only show apps running on the current monitor', 'video-display-symbolic', null);

        this._addSwitchRow(posGroup, settings, 'independent-dock', 'Independent Dock Mode', 'Use completely separate pinned apps and custom app launcher', 'system-run-symbolic', null);
        const fullWidthRow = this._addSwitchRow(posGroup, settings, 'full-width', 'Full Screen Width', 'Extend dock edge to edge', 'view-fullscreen-symbolic', null);

        const alignmentRow = this._addSegmentedRow(posGroup, settings, 'icon-alignment', 'Icon Alignment', 'Justification when Full Width is active', 'format-justify-center-symbolic', [{
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

        this._addCustomSpinRow(posGroup, settings, 'dock-margin', 'Edge Margin', 'Distance from screen edge', 'format-indent-less-symbolic', {
            lower: 0,
            upper: 50,
            step_increment: 1
        }, createResetBtn);

        const floatingGroup = new Adw.PreferencesGroup({
            title: 'Floating Dock',
            description: 'Detach and freely move the dock anywhere on screen'
        });
        page.add(floatingGroup);

        this._addSwitchRow(floatingGroup, settings, 'enable-floating-dock', 'Enable Floating Mode', 'Click and drag the side lines to pull the dock', 'input-mouse-symbolic');

        const floatExpander = new Adw.ExpanderRow({
            title: 'Floating Dock Options',
            subtitle: 'Handle, opacity &amp; behaviour settings',
            icon_name: 'view-reveal-symbolic',
            expanded: false
        });

        const masterFloatReset = createGroupReset([
            'floating-side-line-opacity', 'floating-d-length', 'floating-d-thickness',
            'floating-d-curve', 'floating-d-offset', 'floating-d-gap',
            'floating-dock-opacity', 'floating-dock-hover-full-opacity'
        ]);
        masterFloatReset.valign = Gtk.Align.CENTER;
        floatExpander.add_suffix(masterFloatReset);

        floatingGroup.add(floatExpander);

        this._addCustomSpinRow(floatExpander, settings, 'floating-side-line-opacity', 'Side Line Opacity', 'Visibility of the drag handles (0–100)', 'view-reveal-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 5
        }, createResetBtn);
        this._addCustomSpinRow(floatExpander, settings, 'floating-d-length', 'Handle Length', 'Length of the D-shape handle', 'go-up-symbolic', {
            lower: 5,
            upper: 100,
            step_increment: 1
        }, createResetBtn);
        this._addCustomSpinRow(floatExpander, settings, 'floating-d-thickness', 'Handle Thickness', 'Thickness of the D-shape (auto-clamped to fit dock)', 'go-next-symbolic', {
            lower: 1,
            upper: 50,
            step_increment: 1
        }, createResetBtn);
        this._addCustomSpinRow(floatExpander, settings, 'floating-d-curve', 'Handle Curve', 'Border radius for the D-shape', 'media-record-symbolic', {
            lower: 0,
            upper: 50,
            step_increment: 1
        }, createResetBtn);

        this._addCustomSpinRow(floatExpander, settings, 'floating-d-offset', 'Handle Offset', 'Shift the handle inwards/outwards', 'format-justify-fill-symbolic', {
            lower: -50,
            upper: 50,
            step_increment: 1
        }, createResetBtn);

        this._addCustomSpinRow(floatExpander, settings, 'floating-d-gap', 'Handle Gap', 'Space between the handle and icons', 'format-indent-more-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 1
        }, createResetBtn);

        this._addCustomSpinRow(floatExpander, settings, 'floating-dock-opacity', 'Dock Opacity', 'Overall opacity of the full dock while floating (icons, background, stroke, handles)', 'display-brightness-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 5
        }, createResetBtn);

        this._addSwitchRow(floatExpander, settings, 'floating-dock-hover-full-opacity', 'Full Opacity on Hover', 'Instantly show full opacity when the cursor enters the floating dock', 'input-mouse-symbolic', null);

        const sizeGroup = new Adw.PreferencesGroup({
            title: 'Sizing &amp; Spacing',
            description: 'Base dimensions for dock and icons'
        });
        page.add(sizeGroup);

        this._addCustomSpinRow(sizeGroup, settings, 'icon-size', 'Base Icon Size', 'Normal size of app icons', 'zoom-original-symbolic', {
            lower: 16,
            upper: 128,
            step_increment: 2
        }, createResetBtn);
        this._addCustomSpinRow(sizeGroup, settings, 'icon-spacing', 'Icon Gap', 'Distance between icons', 'format-indent-more-symbolic', {
            lower: 0,
            upper: 30,
            step_increment: 1
        }, createResetBtn);
        const sidePaddingRow = this._addCustomSpinRow(sizeGroup, settings, 'dock-padding', 'Side Padding', 'Extra gap inside dock ends', 'format-justify-fill-symbolic', {
            lower: 0,
            upper: 150,
            step_increment: 2
        }, createResetBtn);

        this._addCustomSpinRow(sizeGroup, settings, 'dock-height', 'Dock Height / Thickness', 'Extra padding on top/bottom (or left/right)', 'format-justify-center-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 2
        }, createResetBtn);

        const syncLayoutVisibility = () => {
            const isFullWidth = settings.get_boolean('full-width');
            const isFloatingEnabled = settings.get_boolean('enable-floating-dock');
            const showOnAll = settings.get_boolean('show-on-all-monitors');

            alignmentRow.set_visible(isFullWidth);
            monitorRow.set_visible(!showOnAll);

            sidePaddingRow.set_visible(!isFullWidth && !isFloatingEnabled);
            if (fullWidthRow) fullWidthRow.set_visible(!isFloatingEnabled);

            floatingGroup.set_visible(!isFullWidth);
            floatExpander.set_visible(isFloatingEnabled);
        };

        this._settingsSignals.push(settings.connect('changed::full-width', syncLayoutVisibility));
        this._settingsSignals.push(settings.connect('changed::enable-floating-dock', syncLayoutVisibility));
        this._settingsSignals.push(settings.connect('changed::show-on-all-monitors', syncLayoutVisibility));
        syncLayoutVisibility();
    }

    _buildAppearancePage(window, settings, createResetBtn, createGroupReset) {
        const page = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-wallpaper-symbolic'
        });
        window.add(page);

        const colorsGroup = new Adw.PreferencesGroup({
            title: 'Panel Style',
            description: 'Background colors and borders'
        });
        page.add(colorsGroup);

        const themeOptions = [{
            name: 'Custom Color',
            value: 'default'
        },
        {
            name: 'Wallpaper Color',
            value: 'chameleon'
        },
        {
            name: 'Carbon',
            value: 'carbon'
        },
        {
            name: 'Nord',
            value: 'nord'
        },
        {
            name: 'Catppuccin Mocha',
            value: 'catppuccin'
        },
        {
            name: 'Gruvbox Dark',
            value: 'gruvbox'
        },
        {
            name: 'Ash Glass',
            value: 'ash'
        },
        {
            name: 'Dracula',
            value: 'dracula'
        },
        {
            name: 'Tokyo Night',
            value: 'tokyo-night'
        },
        {
            name: 'Aurora',
            value: 'aurora'
        },
        {
            name: 'Sunset',
            value: 'sunset'
        },
        {
            name: 'Slate Ocean',
            value: 'slate-ocean'
        },
        ];

        this._addComboRow(colorsGroup, settings, 'dock-theme', 'Dock Theme', 'Choose a preset theme or use custom colors', 'preferences-desktop-theme-symbolic', themeOptions, null);

        const chameleonBanner = new Adw.ActionRow({
            title: 'Chameleon Active',
            subtitle: 'Dock color &amp; indicator auto-update from your wallpaper',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            css_classes: ['success']
        });
        colorsGroup.add(chameleonBanner);

        const bgColorRow = this._addColorRow(colorsGroup, settings, 'background-color', 'Primary Color', 'preferences-desktop-appearance-symbolic');
        const useGradRow = this._addSwitchRow(colorsGroup, settings, 'use-gradient', 'Use Gradient', 'Blend with a second color', 'view-continuous-symbolic', null);
        const bgGradColorRow = this._addColorRow(colorsGroup, settings, 'background-gradient-color', 'Secondary Color', 'preferences-desktop-appearance-symbolic');
        const gradDirRow = this._addSegmentedRow(colorsGroup, settings, 'gradient-direction', 'Gradient Direction', 'Flow of the gradient', 'view-refresh-symbolic', [{
            name: 'Vertical',
            value: 'vertical'
        },
        {
            name: 'Horizontal',
            value: 'horizontal'
        }
        ]);

        this._addCustomSpinRow(colorsGroup, settings, 'background-opacity', 'Background Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 5
        }, createResetBtn);

        const radiusRow = this._addCustomSpinRow(colorsGroup, settings, 'border-radius', 'Border Radius', 'Corner roundness', 'media-record-symbolic', {
            lower: 0,
            upper: 50,
            step_increment: 1
        }, createResetBtn);

        const strokeExpander = new Adw.ExpanderRow({
            title: 'Border Outline (Stroke)',
            subtitle: 'Draw an outer line around the dock',
            icon_name: 'format-text-strikethrough-symbolic',
            show_enable_switch: false
        });
        strokeExpander.add_suffix(createGroupReset(['stroke-width', 'stroke-color', 'stroke-opacity']));
        colorsGroup.add(strokeExpander);

        this._addCustomSpinRow(strokeExpander, settings, 'stroke-width', 'Stroke Width', 'Thickness in pixels (0 to disable)', 'format-text-strikethrough-symbolic', {
            lower: 0,
            upper: 10,
            step_increment: 1
        }, createResetBtn);

        this._addColorRow(strokeExpander, settings, 'stroke-color', 'Stroke Color', 'preferences-desktop-appearance-symbolic');

        this._addCustomSpinRow(strokeExpander, settings, 'stroke-opacity', 'Stroke Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 5
        }, createResetBtn);

        const syncRadiusVisibility = () => {
            const isFull = settings.get_boolean('full-width');
            radiusRow.set_visible(!isFull);
            strokeExpander.set_visible(!isFull);
        };
        this._settingsSignals.push(settings.connect('changed::full-width', syncRadiusVisibility));
        syncRadiusVisibility();

        const sepGroup = new Adw.PreferencesGroup({
            title: 'Separators',
            description: 'Divider lines between dock items'
        });
        page.add(sepGroup);

        const modSepExp = new Adw.ExpanderRow({
            title: 'Module Separator',
            subtitle: 'Divides clock, grid, and system icons',
            icon_name: 'format-text-strikethrough-symbolic'
        });
        modSepExp.add_suffix(createGroupReset(['separator-width', 'separator-height', 'separator-color', 'separator-opacity']));
        sepGroup.add(modSepExp);
        this._addCustomSpinRow(modSepExp, settings, 'separator-width', 'Thickness', 'Width in pixels', 'format-text-strikethrough-symbolic', {
            lower: 0,
            upper: 10,
            step_increment: 1
        }, createResetBtn);
        this._addCustomSpinRow(modSepExp, settings, 'separator-height', 'Height / Length', 'Percentage of dock size (10-100)', 'format-justify-fill-symbolic', {
            lower: 10,
            upper: 100,
            step_increment: 5
        }, createResetBtn);
        this._addColorRow(modSepExp, settings, 'separator-color', 'Color', 'preferences-desktop-appearance-symbolic');
        this._addCustomSpinRow(modSepExp, settings, 'separator-opacity', 'Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 5
        }, createResetBtn);

        const appSepExp = new Adw.ExpanderRow({
            title: 'App Separator',
            subtitle: 'Divides pinned apps from running apps',
            icon_name: 'format-justify-center-symbolic'
        });
        appSepExp.add_suffix(createGroupReset(['running-separator-width', 'running-separator-height', 'running-separator-color', 'running-separator-opacity']));
        sepGroup.add(appSepExp);
        this._addCustomSpinRow(appSepExp, settings, 'running-separator-width', 'Thickness', 'Width in pixels', 'format-text-strikethrough-symbolic', {
            lower: 0,
            upper: 10,
            step_increment: 1
        }, createResetBtn);
        this._addCustomSpinRow(appSepExp, settings, 'running-separator-height', 'Height / Length', 'Percentage of dock size (10-100)', 'format-justify-fill-symbolic', {
            lower: 10,
            upper: 100,
            step_increment: 5
        }, createResetBtn);
        this._addColorRow(appSepExp, settings, 'running-separator-color', 'Color', 'preferences-desktop-appearance-symbolic');
        this._addCustomSpinRow(appSepExp, settings, 'running-separator-opacity', 'Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
            lower: 0,
            upper: 100,
            step_increment: 5
        }, createResetBtn);

        const badgesGroup = new Adw.PreferencesGroup({
            title: 'App Notifications',
            description: 'Unread message counters'
        });
        page.add(badgesGroup);
        this._addSwitchRow(badgesGroup, settings, 'show-notification-badges', 'Show Notification Badges', 'Display unread message counts on app icons', 'user-available-symbolic');

        const indGroup = new Adw.PreferencesGroup({
            title: 'Indicators',
            description: 'Styles for currently active applications'
        });
        page.add(indGroup);

        const indExpander = new Adw.ExpanderRow({
            title: 'Running Indicators',
            subtitle: 'Settings for the active app dots/lines',
            icon_name: 'media-record-symbolic',
            expanded: true
        });
        const masterIndReset = createGroupReset(['show-running-indicators', 'indicator-style', 'indicator-color', 'indicator-size', 'indicator-spacing', 'indicator-glow']);
        masterIndReset.valign = Gtk.Align.CENTER;
        indExpander.add_suffix(masterIndReset);
        indGroup.add(indExpander);

        this._addSwitchRow(indExpander, settings, 'show-running-indicators', 'Show Indicators', 'Display active marks under icons', 'media-record-symbolic', createResetBtn);
        this._addComboRow(indExpander, settings, 'indicator-style', 'Indicator Style', 'Shape of the indicator', 'view-list-symbolic', [{
            name: 'Dot',
            value: 'dot'
        },
        {
            name: 'Dash',
            value: 'dash'
        },
        {
            name: 'Line',
            value: 'line'
        },
        {
            name: 'Square',
            value: 'square'
        }
        ], null);

        let indColorRow = null;
        indColorRow = this._addColorRow(indExpander, settings, 'indicator-color', 'Indicator Color', 'preferences-desktop-appearance-symbolic');

        this._addCustomSpinRow(indExpander, settings, 'indicator-size', 'Indicator Size', 'Limit: 2px to 12px', 'zoom-in-symbolic', {
            lower: 2,
            upper: 12,
            step_increment: 1
        }, createResetBtn);
        this._addCustomSpinRow(indExpander, settings, 'indicator-spacing', 'Indicator Spacing', 'Gap between icon and indicator', 'format-indent-more-symbolic', {
            lower: 0,
            upper: 20,
            step_increment: 1
        }, createResetBtn);
        this._addSwitchRow(indExpander, settings, 'indicator-glow', 'Indicator Glow', 'Add a shining shadow effect', 'display-brightness-symbolic', null);

        const syncThemeVisibility = () => {
            const theme = settings.get_string('dock-theme');
            const isDefault = theme === 'default';
            const isChameleon = theme === 'chameleon';
            const useGrad = settings.get_boolean('use-gradient');

            chameleonBanner.set_visible(isChameleon);
            bgColorRow.set_visible(isDefault);
            useGradRow.set_visible(isDefault);
            bgGradColorRow.set_visible(isDefault && useGrad);
            gradDirRow.set_visible(isDefault && useGrad);

            if (indColorRow) indColorRow.set_visible(!isChameleon);
        };

        this._settingsSignals.push(settings.connect('changed::dock-theme', syncThemeVisibility));
        this._settingsSignals.push(settings.connect('changed::use-gradient', syncThemeVisibility));
        syncThemeVisibility();
    }

    _buildBehaviorPage(window, settings, createResetBtn) {
        const page = new Adw.PreferencesPage({
            title: 'Behavior',
            icon_name: 'applications-engineering-symbolic'
        });
        window.add(page);

        const visGroup = new Adw.PreferencesGroup({
            title: 'Visibility Rules',
            description: 'When and how the dock hides itself'
        });
        page.add(visGroup);

        const hideModeRow = this._addComboRow(visGroup, settings, 'hide-mode', 'Hide Mode', 'Intelligent dodge is recommended', 'go-bottom-symbolic', [{
            name: 'Intelligent (Dodge Active)',
            value: 'intelligent'
        },
        {
            name: 'Dodge All Windows',
            value: 'dodge-all'
        },
        {
            name: 'Dodge Active Window',
            value: 'active'
        },
        {
            name: 'Dodge Maximized',
            value: 'maximized'
        },
        {
            name: 'Always Hide',
            value: 'always'
        },
        {
            name: 'Never Hide',
            value: 'none'
        }
        ], null);

        const hideDelayRow = this._addCustomSpinRow(visGroup, settings, 'hide-delay', 'Hide Delay', 'Milliseconds before hiding', 'preferences-system-time-symbolic', {
            lower: 0,
            upper: 2000,
            step_increment: 50
        }, createResetBtn);
        const unhideDelayRow = this._addCustomSpinRow(visGroup, settings, 'unhide-delay', 'Unhide Delay', 'Milliseconds before showing', 'preferences-system-time-symbolic', {
            lower: 0,
            upper: 2000,
            step_increment: 50
        }, createResetBtn);
        const dwellDelayRow = this._addCustomSpinRow(visGroup, settings, 'edge-dwell-delay', 'Edge Reveal Delay (Pressure)', 'Hold mouse at the edge for this long to reveal (ms)', 'timer-symbolic', {
            lower: 0,
            upper: 1500,
            step_increment: 50
        }, createResetBtn);

        const syncDelayVisibility = () => {
            const isFloating = settings.get_boolean('enable-floating-dock');
            const isNone = settings.get_string('hide-mode') === 'none';

            const showDelays = !isNone && !isFloating;

            if (visGroup) visGroup.set_visible(!isFloating);

            if (hideModeRow) hideModeRow.set_visible(!isFloating);
            hideDelayRow.set_visible(showDelays);
            unhideDelayRow.set_visible(showDelays);
            dwellDelayRow.set_visible(showDelays);
        };

        this._settingsSignals.push(settings.connect('changed::hide-mode', syncDelayVisibility));
        this._settingsSignals.push(settings.connect('changed::enable-floating-dock', syncDelayVisibility));
        syncDelayVisibility();

        const animGroup = new Adw.PreferencesGroup({
            title: 'Animations &amp; Effects'
        });
        page.add(animGroup);

        this._addComboRow(animGroup, settings, 'click-effect', 'Icon Click Effect', 'Animation when an app is clicked', 'input-mouse-symbolic', [{
            name: 'None',
            value: 'none'
        },
        {
            name: 'Bounce',
            value: 'bounce'
        },
        {
            name: 'Jump',
            value: 'jump'
        },
        {
            name: 'Heartbeat',
            value: 'heartbeat'
        },
        {
            name: 'Spin',
            value: 'spin'
        },
        {
            name: 'Flip',
            value: 'flip'
        },
        {
            name: 'Squeeze',
            value: 'squeeze'
        },
        {
            name: 'Glow',
            value: 'glow'
        },
        {
            name: 'Shake',
            value: 'shake'
        },
        {
            name: 'Jelly',
            value: 'jelly'
        },
        {
            name: 'Tada',
            value: 'tada'
        },
        {
            name: 'Swing',
            value: 'swing'
        },
        {
            name: 'Dim',
            value: 'dim'
        },
        {
            name: 'Move Up',
            value: 'move_up'
        },
        {
            name: 'Move Down',
            value: 'move_down'
        },
        {
            name: 'Move Left',
            value: 'move_left'
        },
        {
            name: 'Move Right',
            value: 'move_right'
        },
        {
            name: 'Enlarge',
            value: 'enlarge'
        },
        {
            name: 'Shrink',
            value: 'shrink'
        },
        {
            name: 'Roll (Wheel)',
            value: 'roll'
        },
        {
            name: 'Squish (Drop)',
            value: 'squish'
        },
        {
            name: 'Zoom Fade (Ghost)',
            value: 'zoom_fade'
        },
        {
            name: '3D Spin (Coin)',
            value: 'spin_3d'
        }
        ], null);

        this._addComboRow(animGroup, settings, 'minimize-effect', 'Window Minimize Effect', 'Animation when minimizing or restoring', 'window-minimize-symbolic', [{
            name: 'Magic Lamp',
            value: 'magic-lamp'
        },
        {
            name: 'Snake',
            value: 'snake'
        },
        {
            name: 'Vortex (Black Hole)',
            value: 'crt'
        },
        {
            name: 'Origami (3D Fold)',
            value: 'origami'
        },
        {
            name: 'Jelly (Squash & Stretch)',
            value: 'jelly'
        },
        {
            name: 'None',
            value: 'none'
        }
        ], null);

        const hoverGroup = new Adw.PreferencesGroup({
            title: 'Interaction &amp; Previews'
        });
        page.add(hoverGroup);

        this._addSwitchRow(hoverGroup, settings, 'hover-zoom', 'Hover Zoom', 'Magnification effect on hover', 'zoom-in-symbolic', null);
        const zoomFactorRow = this._addCustomSpinRow(hoverGroup, settings, 'hover-zoom-factor', 'Zoom Factor', 'Maximum multiplier', 'zoom-fit-best-symbolic', {
            lower: 1.1,
            upper: 3.0,
            step_increment: 0.1
        }, createResetBtn, 2);

        const syncZoomFactor = () => zoomFactorRow.set_visible(settings.get_boolean('hover-zoom'));
        this._settingsSignals.push(settings.connect('changed::hover-zoom', syncZoomFactor));
        syncZoomFactor();

        this._addSwitchRow(hoverGroup, settings, 'show-apps-preview', 'Show App Previews', 'Display interactive window thumbnails on hover', 'dialog-information-symbolic', null);

        this._addCustomSpinRow(hoverGroup, settings, 'context-menu-size', 'Thumbnail Width', 'Max width of window thumbnails', 'image-x-generic-symbolic', {
            lower: 100,
            upper: 500,
            step_increment: 10
        }, createResetBtn);
        this._addCustomSpinRow(hoverGroup, settings, 'big-preview-size', 'Live Preview Scale (%)', 'Screen percentage for the big center preview', 'view-fullscreen-symbolic', {
            lower: 40,
            upper: 95,
            step_increment: 5
        }, createResetBtn);

        const peekRow = this._addSwitchRow(
            hoverGroup,
            settings,
            'peek-effect',
            'Window Aero Peek',
            'Make other windows transparent when hovering thumbnails',
            'view-reveal-symbolic',
            null
        );

        const peekSpeedRow = this._addCustomSpinRow(
            hoverGroup,
            settings,
            'peek-animation-speed',
            'Peek Animation Speed',
            'Higher = slower animation (ms)',
            'preferences-system-time-symbolic', {
            lower: 200,
            upper: 3000,
            step_increment: 50
        },
            createResetBtn
        );

        const updateSpeedSubtitle = () => {
            const val = settings.get_int('peek-animation-speed');
            if (peekSpeedRow?.subtitle)
                peekSpeedRow.subtitle = `${val} ms`;
        };
        updateSpeedSubtitle();
        this._settingsSignals.push(
            settings.connect('changed::peek-animation-speed', updateSpeedSubtitle)
        );

        const syncPeekSpeedVisibility = () => {
            const enabled = settings.get_boolean('peek-effect');
            peekSpeedRow.set_visible(enabled);
        };

        this._settingsSignals.push(
            settings.connect('changed::peek-effect', syncPeekSpeedVisibility)
        );
        syncPeekSpeedVisibility();

        const utilGroup = new Adw.PreferencesGroup({
            title: 'Multitasking &amp; Utilities'
        });
        page.add(utilGroup);

        this._addSwitchRow(utilGroup, settings, 'lock-icons', 'Lock Icons', 'Prevent drag and drop reordering', 'system-lock-screen-symbolic', null);
        this._addSwitchRow(utilGroup, settings, 'show-unpinned-apps', 'Show Unpinned Apps', 'Display running apps that are not pinned to the dock', 'view-paged-symbolic', null);
        const qlRow = new Adw.ActionRow({
            title: 'Quick launch',
            subtitle: 'Super + 1–9 targets the first nine dock apps (registered as keyboard shortcuts). Change under Settings → Keyboard. If Super + number still runs “Switch to application”, disable that binding in system shortcuts so Dhruva can own it.',
        });
        qlRow.add_prefix(new Gtk.Image({
            icon_name: 'input-keyboard-symbolic'
        }));
        utilGroup.add(qlRow);

        this._addSwitchRow(utilGroup, settings, 'isolate-workspaces', 'Isolate Workspaces', 'Only show apps running on the current workspace', 'focus-windows-symbolic', null);



        this._addSwitchRow(utilGroup, settings, 'scroll-action-dock', 'Dock Scroll Action', 'Scroll on empty dock area to switch workspaces', 'input-mouse-symbolic', null);
        this._addSwitchRow(utilGroup, settings, 'scroll-action-app', 'App Scroll Action', 'Scroll on app icons to cycle through its windows', 'view-restore-symbolic', null);
    }

    _buildModulesPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Modules',
            icon_name: 'application-x-addon-symbolic'
        });
        window.add(page);

        const modGroup = new Adw.PreferencesGroup({
            title: 'Dock Modules',
            description: 'Enable extra shortcuts on your dock'
        });
        page.add(modGroup);

        this._addSwitchRow(modGroup, settings, 'show-trash', 'Recycle Bin (Trash)', 'Show a shortcut to the trash folder', 'user-trash-symbolic', null);
        this._addSwitchRow(modGroup, settings, 'show-desktop-button', 'Show Desktop Button', 'Quickly minimize all windows', 'computer-symbolic', null);

        this._addSwitchRow(modGroup, settings, 'show-grid-button', 'Show Applications Button', 'App drawer launcher', 'view-app-grid-symbolic', null);
        const gridPosRow = this._addSegmentedRow(modGroup, settings, 'grid-button-position', 'Application Button Position', 'Where to place the launcher', 'go-next-symbolic', [{
            name: 'Start',
            value: 'START'
        },
        {
            name: 'End',
            value: 'END'
        }
        ]);

        const gridColorRow = this._addColorRow(modGroup, settings, 'grid-icon-color', 'App Grid Button Color', 'preferences-desktop-appearance-symbolic');

        const oldGridIconRow = this._addSwitchRow(modGroup, settings, 'use-old-grid-icon', 'Use Old App Grid Icon', 'Show default dotted grid icon instead of Dhruva logo', 'view-app-grid-symbolic', null);

        const customIconRow = new Adw.ActionRow({
            title: 'Custom App Grid Icon',
            subtitle: 'Size: 256x256 or 512x512 (.png, .svg, .ico)',
            icon_name: 'image-x-generic-symbolic'
        });

        const iconBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER
        });
        const chooseBtn = new Gtk.Button({
            label: 'Browse...'
        });

        chooseBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: 'Select App Custom Grid Icon'
            });
            const filter = new Gtk.FileFilter();
            filter.set_name('Images (.png, .svg, .ico)');
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/svg+xml');
            filter.add_mime_type('image/x-icon');
            filter.add_mime_type('image/vnd.microsoft.icon');

            const filterList = Gio.ListStore.new(Gtk.FileFilter);
            filterList.append(filter);
            dialog.set_filters(filterList);

            dialog.open(window, null, (dlg, res) => {
                const file = dlg.open_finish(res);
                if (file) {
                    const ext = file.get_basename().split('.').pop().toLowerCase();

                    if (!['png', 'svg', 'ico'].includes(ext)) {
                        return;
                    }

                    const configDir = GLib.get_user_config_dir() + '/dhruva@narkagni/icon';
                    GLib.mkdir_with_parents(configDir, 0o755);
                    const dir = Gio.File.new_for_path(configDir);
                    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                    let fileInfo;
                    while ((fileInfo = enumerator.next_file(null))) {
                        dir.get_child(fileInfo.get_name()).delete(null);
                    }

                    const timestamp = Date.now();
                    const destPath = `${configDir}/custom_grid_icon_${timestamp}.${ext}`;
                    const destFile = Gio.File.new_for_path(destPath);

                    file.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                    settings.set_string('custom-grid-icon', destPath);
                }

            });
        });

        const resetIconBtn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            css_classes: ['flat', 'circular'],
            tooltip_text: 'Reset to default icon'
        });
        resetIconBtn.connect('clicked', () => {
            settings.set_string('custom-grid-icon', '');
        });

        iconBox.append(chooseBtn);
        iconBox.append(resetIconBtn);
        customIconRow.add_suffix(iconBox);
        modGroup.add(customIconRow);

        const customIconScaleRow = this._addCustomSpinRow(
            modGroup,
            settings,
            'custom-grid-icon-scale',
            'Custom Icon Scale (%)',
            'Adjust size multiplier (Default: 125)',
            'zoom-in-symbolic', {
            lower: 50,
            upper: 300,
            step_increment: 5
        },
            this._makeResetBtn(settings)
        );

        const syncGridSettingsVisibility = () => {
            const showGrid = settings.get_boolean('show-grid-button');
            const hasCustomIcon = settings.get_string('custom-grid-icon') !== '';
            const useOldIcon = settings.get_boolean('use-old-grid-icon');

            gridPosRow.set_visible(showGrid);
            customIconRow.set_visible(showGrid);

            oldGridIconRow.set_visible(showGrid && !hasCustomIcon);
            customIconScaleRow.set_visible(showGrid && hasCustomIcon);

            gridColorRow.set_visible(showGrid && !hasCustomIcon && useOldIcon);

            resetIconBtn.set_sensitive(hasCustomIcon);
        };

        this._settingsSignals.push(settings.connect('changed::custom-grid-icon', syncGridSettingsVisibility));
        this._settingsSignals.push(settings.connect('changed::show-grid-button', syncGridSettingsVisibility));

        this._settingsSignals.push(settings.connect('changed::use-old-grid-icon', syncGridSettingsVisibility));

        syncGridSettingsVisibility();

        const syncGridBtn = () => gridPosRow.set_visible(settings.get_boolean('show-grid-button'));
        this._settingsSignals.push(settings.connect('changed::show-grid-button', syncGridBtn));
        syncGridBtn();

        const defaultFolderGroup = new Adw.PreferencesGroup({
            title: 'Standard Folders',
            description: 'Add quick access folders to the dock'
        });
        page.add(defaultFolderGroup);

        this._addSwitchRow(defaultFolderGroup, settings, 'show-home', 'Home', 'Shortcut to Home directory', 'user-home-symbolic', null);
        this._addSwitchRow(defaultFolderGroup, settings, 'show-downloads', 'Downloads', 'Shortcut to Downloads', 'folder-download-symbolic', null);
        this._addSwitchRow(defaultFolderGroup, settings, 'show-documents', 'Documents', 'Shortcut to Documents', 'folder-documents-symbolic', null);
        this._addSwitchRow(defaultFolderGroup, settings, 'show-pictures', 'Pictures', 'Shortcut to Pictures', 'folder-pictures-symbolic', null);
        this._addSwitchRow(defaultFolderGroup, settings, 'show-videos', 'Videos', 'Shortcut to Videos', 'folder-videos-symbolic', null);
        this._addSwitchRow(defaultFolderGroup, settings, 'show-music', 'Music', 'Shortcut to Music', 'folder-music-symbolic', null);

        const mountRow = new Adw.ActionRow({
            title: 'Show USB &amp; Mounted Drives',
            subtitle: 'Automatically show connected drives and partitions on the dock',
            icon_name: 'drive-harddisk-symbolic'
        });

        const mountToggle = new Gtk.Switch({
            active: settings.get_boolean('show-mounts'),
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            'show-mounts',
            mountToggle,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        mountRow.add_suffix(mountToggle);

        defaultFolderGroup.add(mountRow);

        const customFoldersGroup = new Adw.PreferencesGroup({
            title: 'Custom Quick Folders',
            description: 'Add your own directory shortcuts to the dock'
        });
        page.add(customFoldersGroup);

        let customFolders = [];
        try {
            customFolders = JSON.parse(settings.get_string('custom-folders') || '[]');
        } catch (e) { }

        const buildFolderList = () => {
            if (customFoldersGroup._rows) {
                customFoldersGroup._rows.forEach(r => customFoldersGroup.remove(r));
            }
            customFoldersGroup._rows = [];

            customFolders.forEach((f, idx) => {
                const row = new Adw.ActionRow({
                    title: f.name,
                    subtitle: f.path,
                    icon_name: f.icon || 'folder-symbolic'
                });

                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'circular', 'destructive-action']
                });

                delBtn.connect('clicked', () => {
                    customFolders.splice(idx, 1);
                    settings.set_string('custom-folders', JSON.stringify(customFolders));
                    buildFolderList();
                });

                row.add_suffix(delBtn);
                customFoldersGroup.add(row);
                customFoldersGroup._rows.push(row);
            });

            const addRow = new Adw.ActionRow();
            addRow.set_activatable(true);
            const centerLabel = new Gtk.Label({
                label: '<b>+ Add Custom Folder</b>',
                use_markup: true,
                halign: Gtk.Align.CENTER,
                margin_top: 14,
                margin_bottom: 14,
                css_classes: ['accent']
            });
            addRow.set_child(centerLabel);

            addRow.connect('activated', () => {
                const isGnome45 = !Adw.AlertDialog;
                let dialog;

                if (isGnome45) {
                    dialog = new Adw.MessageDialog({
                        heading: 'Add Quick Folder',
                        transient_for: window,
                        modal: true
                    });
                } else {
                    dialog = new Adw.AlertDialog({
                        heading: 'Add Quick Folder'
                    });
                }

                dialog.add_response('cancel', 'Cancel');
                dialog.add_response('add', 'Add');
                dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

                const vbox = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: 12
                });
                const inputGrp = new Adw.PreferencesGroup();

                const nameInput = new Adw.EntryRow({
                    title: 'Name (e.g. Projects)'
                });
                const pathInput = new Adw.EntryRow({
                    title: 'Path (e.g. /home/user/Projects)'
                });

                const iconOptions = [{
                    name: 'Default Folder',
                    value: 'folder-symbolic'
                },
                {
                    name: 'Downloads',
                    value: 'folder-download-symbolic'
                },
                {
                    name: 'Documents',
                    value: 'folder-documents-symbolic'
                },
                {
                    name: 'Pictures',
                    value: 'folder-pictures-symbolic'
                },
                {
                    name: 'Videos',
                    value: 'folder-videos-symbolic'
                },
                {
                    name: 'Music',
                    value: 'folder-music-symbolic'
                },
                {
                    name: 'Public Share',
                    value: 'folder-publicshare-symbolic'
                },
                {
                    name: 'Templates',
                    value: 'folder-templates-symbolic'
                },
                {
                    name: 'Desktop',
                    value: 'user-desktop-symbolic'
                },
                {
                    name: 'Favorite (Heart)',
                    value: 'emblem-favorite-symbolic'
                },
                {
                    name: 'Star / Bookmark',
                    value: 'bookmark-symbolic'
                },
                {
                    name: 'Games',
                    value: 'applications-games-symbolic'
                },
                {
                    name: 'Code / Projects',
                    value: 'applications-engineering-symbolic'
                },
                {
                    name: 'Cloud / Remote',
                    value: 'folder-remote-symbolic'
                }
                ];

                const iconModel = Gtk.StringList.new(iconOptions.map(opt => opt.name));
                const iconInput = new Adw.ComboRow({
                    title: 'Folder Icon',
                    model: iconModel
                });

                inputGrp.add(nameInput);
                inputGrp.add(pathInput);
                inputGrp.add(iconInput);
                vbox.append(inputGrp);
                dialog.set_extra_child(vbox);

                dialog.connect('response', (dlg, response) => {
                    if (response === 'add') {
                        customFolders.push({
                            name: nameInput.get_text().trim() || 'Custom Folder',
                            path: pathInput.get_text().trim() || '/',
                            icon: iconOptions[iconInput.get_selected()].value
                        });
                        settings.set_string('custom-folders', JSON.stringify(customFolders));
                        buildFolderList();
                    }
                    if (isGnome45) dlg.close();
                });

                if (isGnome45) {
                    dialog.present();
                } else {
                    dialog.present(window);
                }
            });

            customFoldersGroup.add(addRow);
            customFoldersGroup._rows.push(addRow);
        };

        buildFolderList();

        const clockGroup = new Adw.PreferencesGroup({
            title: 'Clock &amp; Date',
            description: 'Display time on horizontal docks'
        });
        page.add(clockGroup);

        this._addSwitchRow(clockGroup, settings, 'show-clock', 'Show Clock', 'Hidden automatically on left/right docks', 'document-open-recent-symbolic', null);


        const use24hRow = this._addSwitchRow(clockGroup, settings, 'use-24h-clock', 'Use 24-Hour Clock', 'Display time in 24-hour format', 'preferences-system-time-symbolic', null);

        const createResetBtn = this._makeResetBtn(settings);
        const clockSizeRow = this._addCustomSpinRow(clockGroup, settings, 'clock-font-size', 'Clock Text Size', 'Adjust font size', 'format-text-direction-symbolic', {
            lower: 10,
            upper: 36,
            step_increment: 1
        }, createResetBtn);
        const clockPosRow = this._addSegmentedRow(clockGroup, settings, 'clock-position', 'Clock Position', 'Separate from App Grid', 'format-justify-right-symbolic', [{
            name: 'Start',
            value: 'START'
        },
        {
            name: 'End',
            value: 'END'
        }
        ]);

        const syncClockVisibility = () => {
            const showClock = settings.get_boolean('show-clock');
            clockPosRow.set_visible(showClock);
            clockSizeRow.set_visible(showClock);
            use24hRow.set_visible(showClock);
        };

        this._settingsSignals.push(settings.connect('changed::show-clock', syncClockVisibility));
        syncClockVisibility();


        const dangerGroup = new Adw.PreferencesGroup({
            title: 'Danger Zone',
            description: 'Master controls for your settings'
        });
        page.add(dangerGroup);

        const backupGroup = new Adw.PreferencesGroup({
            title: 'Backup &amp; Restore',
            description: 'Import or export your dock layout, themes, custom folders, and pinned apps'
        });
        page.add(backupGroup);

        const exportRow = new Adw.ActionRow({
            title: 'Export Configuration',
            subtitle: 'Save your current settings and apps to a file',
            icon_name: 'document-export-symbolic'
        });

        const exportBtn = new Gtk.Button({
            label: 'Export',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
            width_request: 100
        });
        exportRow.add_suffix(exportBtn);

        exportBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: 'Export Dock Configuration' });
            dialog.set_initial_name('dhruva_config.json');

            dialog.save(window, null, (dlg, res) => {
                let file;
                try { file = dlg.save_finish(res); } catch (_) { return; }
                if (!file) return;

                const isIndependent = settings.get_boolean('independent-dock');
                const uuid = this.metadata.uuid || 'dhruva@narkagni';
                const extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid]);

                const config = { settings: {}, favorites: [], pinnedApps: null, folders: null };

                settings.list_keys().forEach(key => {
                    if (isIndependent && key === 'app-folders') return;
                    config.settings[key] = settings.get_value(key).deep_unpack();
                });

                if (isIndependent) {
                    try {
                        const appsPath = GLib.build_filenamev([extConfigDir, 'dhruva-apps.json']);
                        const [ok, contents] = GLib.file_get_contents(appsPath);
                        if (ok) config.pinnedApps = JSON.parse(new TextDecoder().decode(contents));
                    } catch (_) { config.pinnedApps = []; }

                    try {
                        const foldersPath = GLib.build_filenamev([extConfigDir, 'dhruva-folders.json']);
                        const [ok, contents] = GLib.file_get_contents(foldersPath);
                        if (ok) config.folders = JSON.parse(new TextDecoder().decode(contents));
                    } catch (_) { config.folders = []; }
                } else {
                    try {
                        const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
                        config.favorites = shellSettings.get_strv('favorite-apps');
                    } catch (_) { }
                }

                const jsonStr = JSON.stringify(config, null, 2);
                const path = file.get_path();
                if (path) GLib.file_set_contents(path, jsonStr);

            });
        });
        backupGroup.add(exportRow);

        const importRow = new Adw.ActionRow({
            title: 'Import Configuration',
            subtitle: 'Load a previously saved configuration file',
            icon_name: 'document-import-symbolic'
        });

        const importBtn = new Gtk.Button({
            label: 'Import',
            valign: Gtk.Align.CENTER,
            width_request: 100
        });
        importRow.add_suffix(importBtn);

        importBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: 'Import Dock Configuration' });
            const filter = new Gtk.FileFilter();
            filter.set_name('JSON Files');
            filter.add_mime_type('application/json');

            const filterList = Gio.ListStore.new(Gtk.FileFilter);
            filterList.append(filter);
            dialog.set_filters(filterList);

            dialog.open(window, null, (dlg, res) => {
                let file;
                try { file = dlg.open_finish(res); } catch (_) { return; }
                if (!file) return;

                file.load_contents_async(null, (f, r) => {
                    let success, contents;
                    try { [success, contents] = f.load_contents_finish(r); } catch (_) { return; }
                    if (!success) return;

                    let config;
                    try { config = JSON.parse(new TextDecoder().decode(contents)); } catch (_) { return; }

                    const isIndependent = settings.get_boolean('independent-dock');
                    const uuid = this.metadata.uuid || 'dhruva@narkagni';
                    const extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid]);

                    if (config.settings) {
                        Object.keys(config.settings).forEach(key => {
                            try {
                                if (settings.settings_schema.has_key(key)) {
                                    const typeStr = settings.settings_schema.get_key(key).get_value_type().dup_string();
                                    const variant = new GLib.Variant(typeStr, config.settings[key]);
                                    settings.set_value(key, variant);
                                }
                            } catch (_) { }
                        });
                    }

                    if (isIndependent) {
                        if (config.pinnedApps && Array.isArray(config.pinnedApps)) {
                            GLib.mkdir_with_parents(extConfigDir, 0o755);
                            const appsPath = GLib.build_filenamev([extConfigDir, 'dhruva-apps.json']);
                            GLib.file_set_contents(appsPath, JSON.stringify(config.pinnedApps, null, 2));
                        }
                        if (config.folders && Array.isArray(config.folders)) {
                            GLib.mkdir_with_parents(extConfigDir, 0o755);
                            const foldersPath = GLib.build_filenamev([extConfigDir, 'dhruva-folders.json']);
                            GLib.file_set_contents(foldersPath, JSON.stringify(config.folders, null, 2));
                        }
                    } else {
                        if (config.favorites && Array.isArray(config.favorites)) {
                            try {
                                const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
                                shellSettings.set_strv('favorite-apps', config.favorites);
                            } catch (_) { }
                        }
                    }
                });
            });
        });
        backupGroup.add(importRow);

        const resetAllRow = new Adw.ActionRow({
            title: 'Reset All Settings',
            subtitle: 'Restore all Dhruva Dock settings to their default values',
            icon_name: 'edit-delete-symbolic'
        });

        const resetAllBtn = new Gtk.Button({
            label: 'Reset Defaults',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        resetAllBtn.connect('clicked', () => {
            const isGnome45 = !Adw.AlertDialog;
            let dialog;

            if (isGnome45) {
                dialog = new Adw.MessageDialog({
                    heading: 'Reset All Settings?',
                    body: 'Are you sure you want to reset all settings to default? This action cannot be undone.',
                    transient_for: window,
                    modal: true
                });
            } else {
                dialog = new Adw.AlertDialog({
                    heading: 'Reset All Settings?',
                    body: 'Are you sure you want to reset all settings to default? This action cannot be undone.'
                });
            }

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('reset', 'Reset Settings');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);

            dialog.connect('response', (dlg, response) => {
                if (response === 'reset') {
                    settings.list_keys().forEach(k => settings.reset(k));
                }
                if (isGnome45) dlg.close();
            });

            if (isGnome45) {
                dialog.present();
            } else {
                dialog.present(window);
            }
        });

        resetAllRow.add_suffix(resetAllBtn);
        dangerGroup.add(resetAllRow);
    }

    _buildAboutHero(page) {
        const group = new Adw.PreferencesGroup();
        page.add(group);

        const heroBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.CENTER,
            margin_top: 24,
            margin_bottom: 12
        });

        const logo = Gtk.Image.new_from_file(`${this.path}/icons/logo.svg`);
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


    _buildAboutLinks(page, window) {
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


    _buildAboutAuthor(page) {
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
            subtitle: 'Floating dock with drag-to-move · D-shape drag handles · Per-app running indicators · ' +
                'Hover zoom magnification · Window minimize effects (Magic Lamp, Snake, Vortex &amp; more) · ' +
                'Icon click animations (Bounce, Jelly, Heartbeat &amp; 20+ styles) · ' +
                'Intelligent auto-hide with edge pressure reveal · ' +
                'Chameleon theme (wallpaper colour matching) · ' +
                'Full-width dock mode · Multi-monitor support · ' +
                'Custom folders, Trash, Desktop button &amp; App Grid · ' +
                'Workspace isolation · Aero Peek window previews · ' +
                'Adjustable floating dock opacity with hover-reveal · ' +
                'Lock icons to prevent accidental reorder',
            icon_name: 'starred-symbolic'
        }));

        group.add(new Adw.ActionRow({
            title: 'Disclaimer',
            subtitle: 'Dhruva Dock is an independent open-source project.',
            icon_name: 'dialog-information-symbolic'
        }));
    }


    _buildAboutDonations(page, window) {
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
}