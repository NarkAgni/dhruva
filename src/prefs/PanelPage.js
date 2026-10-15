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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import { addGroup, showWhen, roundedRect, paintBackdrop, MOCK_ICON_COLORS } from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 130;
const BAR_HEIGHT = 46;

class PanelPreview {
    constructor(settings, clockSettings) {
        this._settings = settings;
        this._clock = clockSettings;
        this.widget = new Gtk.DrawingArea({ content_height: PREVIEW_HEIGHT, hexpand: true });
        this.widget.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));
    }

    redraw() {
        this.widget.queue_draw();
    }

    _draw(cr, w, h) {
        roundedRect(cr, 0, 0, w, h, 14);
        cr.clip();
        paintBackdrop(cr, w, h);

        const isOn = this._settings.get_boolean('hybrid-panel-mode');
        const barY = h - BAR_HEIGHT;

        if (!isOn) {
            cr.rectangle(0, 0, w, 18);
            cr.setSourceRGBA(0, 0, 0, 0.75);
            cr.fill();
            this._paintClock(cr, w / 2, 9, true);
            const dockW = 7 * 26 + 6 * 8 + 24;
            roundedRect(cr, (w - dockW) / 2, h - 50, dockW, 40, 14);
            cr.setSourceRGBA(0.1, 0.1, 0.13, 0.85);
            cr.fill();
            this._paintApps(cr, w / 2, h - 30, 26, 8);
            return;
        }

        cr.rectangle(0, barY, w, BAR_HEIGHT);
        if (this._settings.get_boolean('blur-enabled')) cr.setSourceRGBA(1, 1, 1, 0.16);
        else cr.setSourceRGBA(0.08, 0.08, 0.1, 0.9);
        cr.fill();

        const centerY = barY + BAR_HEIGHT / 2;
        this._paintWorkspaces(cr, 16, centerY);
        this._paintApps(cr, w / 2, centerY, 26, 8);
        this._paintStatus(cr, w - 14, centerY);
    }

    _paintWorkspaces(cr, x, y) {
        roundedRect(cr, x, y - 3, 18, 6, 3);
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.fill();
        for (let i = 0; i < 2; i++) {
            cr.arc(x + 26 + i * 10, y, 3, 0, 2 * Math.PI);
            cr.setSourceRGBA(1, 1, 1, 0.45);
            cr.fill();
        }
    }

    _paintApps(cr, centerX, centerY, size, gap) {
        const total = MOCK_ICON_COLORS.length * size + (MOCK_ICON_COLORS.length - 1) * gap;
        let x = centerX - total / 2;
        for (const [r, g, b] of MOCK_ICON_COLORS) {
            roundedRect(cr, x, centerY - size / 2, size, size, 7);
            cr.setSourceRGB(r, g, b);
            cr.fill();
            x += size + gap;
        }
    }

    _paintStatus(cr, right, y) {
        const clockW = this._paintClock(cr, right, y, false);
        let x = right - clockW - 18;

        cr.setSourceRGBA(1, 1, 1, 0.9);
        for (let i = 0; i < 3; i++) {
            roundedRect(cr, x - 12, y - 6, 12, 12, 3);
            cr.fill();
            x -= 20;
        }

        x -= 6;
        cr.moveTo(x - 10, y + 3);
        cr.lineTo(x - 5, y - 3);
        cr.lineTo(x, y + 3);
        cr.setLineWidth(1.8);
        cr.stroke();
    }

    _paintClock(cr, anchorX, y, isCentered) {
        const now = GLib.DateTime.new_now_local();
        const seconds = this._clock.get_boolean('clock-show-seconds');
        const is24h = this._clock.get_string('clock-format') === '24h';
        let time = is24h ? now.format(seconds ? '%H:%M:%S' : '%H:%M') : now.format(seconds ? '%I:%M:%S %p' : '%I:%M %p');
        if (!is24h) time = time.replace(/^0/, '');
        const showDate = this._clock.get_boolean('clock-show-date');

        cr.selectFontFace('Sans', 0, 1);
        cr.setSourceRGBA(1, 1, 1, 0.95);

        if (isCentered) {
            cr.setFontSize(10);
            const label = showDate ? `${now.format('%b %e')}  ${time}` : time;
            const width = cr.textExtents(label).width;
            cr.moveTo(anchorX - width / 2, y + 3.5);
            cr.showText(label);
            return width;
        }

        cr.setFontSize(showDate ? 10 : 11);
        const timeW = cr.textExtents(time).width;
        if (!showDate) {
            cr.moveTo(anchorX - timeW, y + 4);
            cr.showText(time);
            return timeW;
        }

        const date = now.format('%d/%m/%Y');
        const dateW = cr.textExtents(date).width;
        const width = Math.max(timeW, dateW);
        cr.moveTo(anchorX - width / 2 - timeW / 2, y - 2);
        cr.showText(time);
        cr.moveTo(anchorX - width / 2 - dateW / 2, y + 11);
        cr.showText(date);
        return width;
    }
}

function addClockFormatRow(group, clockSettings) {
    const row = new Adw.SwitchRow({ title: _('24-Hour Time') });
    const sync = () => {
        const is24h = clockSettings.get_string('clock-format') === '24h';
        if (row.get_active() !== is24h) row.set_active(is24h);
    };
    row.connect('notify::active', () => {
        const value = row.get_active() ? '24h' : '12h';
        if (clockSettings.get_string('clock-format') !== value) clockSettings.set_string('clock-format', value);
    });
    onSettingChanged(clockSettings, 'clock-format', sync);
    sync();
    group.add(row);
}

function addClockSwitch(group, clockSettings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({ title, subtitle: subtitle ?? '' });
    clockSettings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
}


export function buildPanelPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Panel'),
        icon_name: 'preferences-system-windows-symbolic',
    });

    const clockSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
    const preview = new PanelPreview(settings, clockSettings);
    const isPanel = () => settings.get_boolean('hybrid-panel-mode');

    const heroGroup = addGroup(page, _('Panel Mode'),
        _('Moves the GNOME top bar into the dock: workspaces, tray, Quick Settings and the clock in one bar'));
    const enableSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('hybrid-panel-mode', enableSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    heroGroup.set_header_suffix(enableSwitch);
    heroGroup.add(preview.widget);

    const clockGroup = addGroup(page, _('Clock'), _('These are GNOME’s own clock settings, so the lock screen follows too'));
    addClockSwitch(clockGroup, clockSettings, 'clock-show-date', _('Date'), _('Second line under the time'));
    addClockSwitch(clockGroup, clockSettings, 'clock-show-seconds', _('Seconds'));
    addClockFormatRow(clockGroup, clockSettings);
    showWhen(clockGroup, settings, ['hybrid-panel-mode'], isPanel);

    const trayGroup = addGroup(page, _('Tray'),
        _('Small icons from other extensions live behind the arrow. Wide ones like CPU or network speed stay on the bar'));
    const resetRow = new Adw.ActionRow({
        title: _('Tidy Up Tray'),
        subtitle: _('Move every pinned icon back behind the arrow, in the default order'),
    });
    const resetBtn = new Gtk.Button({ label: _('Reset'), valign: Gtk.Align.CENTER });
    const syncReset = () => {
        const isDefault = settings.get_strv('tray-panel-indicators').length === 0 &&
            settings.get_strv('tray-order').length === 0;
        resetBtn.set_sensitive(!isDefault);
    };
    resetBtn.connect('clicked', () => {
        settings.set_strv('tray-panel-indicators', []);
        settings.set_strv('tray-order', []);
    });
    onSettingChanged(settings, 'tray-panel-indicators', syncReset);
    onSettingChanged(settings, 'tray-order', syncReset);
    syncReset();
    resetRow.add_suffix(resetBtn);
    trayGroup.add(resetRow);
    trayGroup.add(new Adw.ActionRow({
        title: _('Pin an icon to the bar'),
        subtitle: _('Open the tray from the arrow to pin or reorder icons'),
    }));
    showWhen(trayGroup, settings, ['hybrid-panel-mode'], isPanel);

    for (const key of ['hybrid-panel-mode', 'blur-enabled'])
        onSettingChanged(settings, key, () => preview.redraw());
    for (const key of ['clock-show-date', 'clock-show-seconds', 'clock-format'])
        onSettingChanged(clockSettings, key, () => preview.redraw());

    window.add(page);
}