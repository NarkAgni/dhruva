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
import Pango from 'gi://Pango';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import {
    fmt, addGroup, showWhen, addSwitchRow, addSliderRow, addSegmentedRow, roundedRect, paintBackdrop, MOCK_ICON_COLORS,
} from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 130;
const BAR_HEIGHT = 46;
const WORKSPACES_W = 40;
const STATUS_ICONS_W = 94;
const ITEM_GAP = 16;
const DYN_PAD = 12;
const DATE_FORMAT_KEY = 'panel-date-format';
const DEFAULT_DATE_FORMAT = '%d/%m/%Y';
const WEB_SEARCH_URL_KEY = 'start-menu-web-search-url';

const DATE_FORMATS = () => [
    { name: _('System Default'), value: '%x' },
    { name: 'DD/MM/YYYY', value: '%d/%m/%Y' },
    { name: 'MM/DD/YYYY', value: '%m/%d/%Y' },
    { name: 'YYYY/MM/DD', value: '%Y/%m/%d' },
    { name: 'YYYY/DD/MM', value: '%Y/%d/%m' },
    { name: 'YYYY-MM-DD (ISO 8601)', value: '%Y-%m-%d' },
    { name: 'DD-MM-YYYY', value: '%d-%m-%Y' },
    { name: 'MM-DD-YYYY', value: '%m-%d-%Y' },
    { name: 'DD.MM.YYYY', value: '%d.%m.%Y' },
    { name: 'YYYY.MM.DD', value: '%Y.%m.%d' },
    { name: 'D/M/YYYY', value: '%-d/%-m/%Y' },
    { name: 'M/D/YYYY', value: '%-m/%-d/%Y' },
    { name: 'DD/MM/YY', value: '%d/%m/%y' },
    { name: 'MM/DD/YY', value: '%m/%d/%y' },
    { name: 'YY/MM/DD', value: '%y/%m/%d' },
    { name: 'DD.MM.YY', value: '%d.%m.%y' },
    { name: 'DD/MM', value: '%d/%m' },
    { name: 'MM/DD', value: '%m/%d' },
    { name: 'DD Mon YYYY', value: '%d %b %Y' },
    { name: 'Mon DD, YYYY', value: '%b %d, %Y' },
    { name: 'DD Month YYYY', value: '%d %B %Y' },
    { name: 'Month DD, YYYY', value: '%B %d, %Y' },
    { name: 'Day DD Mon', value: '%a %d %b' },
    { name: 'Day, Mon DD', value: '%a, %b %d' },
    { name: 'Day DD/MM', value: '%a %d/%m' },
    { name: 'Weekday, DD Month YYYY', value: '%A, %d %B %Y' },
    { name: 'Weekday, Month DD, YYYY', value: '%A, %B %d, %Y' },
];

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

        const isDynamic = this._settings.get_boolean('dynamic-panel');
        const dynLen = this._settings.get_int('dynamic-panel-length');

        if (isDynamic) {
            const appSize = 20;
            const appGap = 6;
            const statusW = this._clockWidth(cr) + STATUS_ICONS_W;
            const contentW = DYN_PAD * 2 + WORKSPACES_W + ITEM_GAP * 2 + this._appsWidth(appSize, appGap) + statusW;
            const minBarW = Math.min(w - 16, Math.max(360, contentW));
            const targetW = dynLen > 0 ? Math.max(minBarW, Math.round(w * (dynLen / 100.0))) : minBarW;
            const barW = Math.min(w - 12, targetW);
            const dynPos = this._settings.get_string('dynamic-panel-position') || 'CENTER';
            let barX = (w - barW) / 2;
            if (dynPos === 'START') barX = 6;
            else if (dynPos === 'END') barX = w - barW - 6;

            const dynY = h - BAR_HEIGHT - 4;
            const radius = Math.min(this._settings.get_int('border-radius'), BAR_HEIGHT / 2);

            roundedRect(cr, barX, dynY, barW, BAR_HEIGHT, radius);
            if (this._settings.get_boolean('blur-enabled')) cr.setSourceRGBA(1, 1, 1, 0.16);
            else cr.setSourceRGBA(0.08, 0.08, 0.1, 0.9);
            cr.fill();

            const centerY = dynY + BAR_HEIGHT / 2;
            const corridorStart = barX + DYN_PAD + WORKSPACES_W + ITEM_GAP;
            const corridorEnd = barX + barW - DYN_PAD - statusW - ITEM_GAP;
            this._paintWorkspaces(cr, barX + DYN_PAD, centerY);
            this._paintApps(cr, (corridorStart + corridorEnd) / 2, centerY, appSize, appGap);
            this._paintStatus(cr, barX + barW - DYN_PAD, centerY);
            return;
        }

        cr.rectangle(0, barY, w, BAR_HEIGHT);
        if (this._settings.get_boolean('blur-enabled')) cr.setSourceRGBA(1, 1, 1, 0.16);
        else cr.setSourceRGBA(0.08, 0.08, 0.1, 0.9);
        cr.fill();

        const centerY = barY + BAR_HEIGHT / 2;
        const appsHalf = this._appsWidth(26, 8) / 2;
        const statusStart = w - 14 - this._clockWidth(cr) - STATUS_ICONS_W;
        const appsCenter = Math.max(16 + WORKSPACES_W + ITEM_GAP + appsHalf, Math.min(w / 2, statusStart - ITEM_GAP - appsHalf));
        this._paintWorkspaces(cr, 16, centerY);
        this._paintApps(cr, appsCenter, centerY, 26, 8);
        this._paintStatus(cr, w - 14, centerY);
    }

    _appsWidth(size, gap) {
        return MOCK_ICON_COLORS.length * size + (MOCK_ICON_COLORS.length - 1) * gap;
    }

    _clockText() {
        const now = GLib.DateTime.new_now_local();
        const seconds = this._clock.get_boolean('clock-show-seconds');
        const is24h = this._clock.get_string('clock-format') === '24h';
        let time = is24h ? now.format(seconds ? '%H:%M:%S' : '%H:%M') : now.format(seconds ? '%I:%M:%S %p' : '%I:%M %p');
        if (!is24h) time = time.replace(/^0/, '');
        const showDate = this._clock.get_boolean('clock-show-date');
        const date = showDate ? (now.format(this._settings.get_string(DATE_FORMAT_KEY)) || now.format(DEFAULT_DATE_FORMAT)) : '';
        return { time, date, showDate };
    }

    _clockWidth(cr) {
        const { time, date, showDate } = this._clockText();
        cr.selectFontFace('Sans', 0, 1);
        cr.setFontSize(showDate ? 10 : 11);
        return Math.max(cr.textExtents(time).width, showDate ? cr.textExtents(date).width : 0);
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
        let x = centerX - this._appsWidth(size, gap) / 2;
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
        const { time, date, showDate } = this._clockText();

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

function addDateFormatRow(group, settings) {
    const now = GLib.DateTime.new_now_local();
    const formats = DATE_FORMATS().map(format => ({ ...format, example: now.format(format.value) }));
    const formatOf = item => formats.find(format => format.name === item.get_item().get_string());

    const makeLabel = cssClass => {
        const label = new Gtk.Label({ xalign: 0, ellipsize: Pango.EllipsizeMode.NONE });
        if (cssClass) label.add_css_class(cssClass);
        return label;
    };

    const listFactory = new Gtk.SignalListItemFactory();
    listFactory.connect('setup', (_factory, item) => {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, margin_top: 4, margin_bottom: 4 });
        box.append(makeLabel(null));
        box.append(makeLabel('dim-label'));
        item.set_child(box);
    });
    listFactory.connect('bind', (_factory, item) => {
        const format = formatOf(item);
        const nameLabel = item.get_child().get_first_child();
        nameLabel.set_label(format.name);
        nameLabel.get_next_sibling().set_label(format.example);
    });

    const valueFactory = new Gtk.SignalListItemFactory();
    valueFactory.connect('setup', (_factory, item) => item.set_child(makeLabel(null)));
    valueFactory.connect('bind', (_factory, item) => item.get_child().set_label(formatOf(item).example));

    const row = new Adw.ComboRow({
        title: _('Date Format'),
        subtitle: _('How the date under the clock is written'),
        model: Gtk.StringList.new(formats.map(format => format.name)),
        factory: valueFactory,
        list_factory: listFactory,
    });

    const sync = () => {
        const index = formats.findIndex(format => format.value === settings.get_string(DATE_FORMAT_KEY));
        const target = index === -1 ? formats.findIndex(format => format.value === DEFAULT_DATE_FORMAT) : index;
        if (row.get_selected() !== target) row.set_selected(target);
    };
    row.connect('notify::selected', () => {
        const format = formats[row.get_selected()];
        if (format && settings.get_string(DATE_FORMAT_KEY) !== format.value) settings.set_string(DATE_FORMAT_KEY, format.value);
    });
    onSettingChanged(settings, DATE_FORMAT_KEY, sync);
    sync();
    group.add(row);
    return row;
}

function addWebSearchUrlRow(group, settings) {
    const row = new Adw.EntryRow({
        title: _('Web Search Address (%s is the search text)'),
        show_apply_button: true,
        text: settings.get_string(WEB_SEARCH_URL_KEY),
    });
    row.connect('apply', () => {
        const value = row.get_text().trim();
        if (value) settings.set_string(WEB_SEARCH_URL_KEY, value);
        else settings.reset(WEB_SEARCH_URL_KEY);
        row.set_text(settings.get_string(WEB_SEARCH_URL_KEY));
    });
    onSettingChanged(settings, WEB_SEARCH_URL_KEY, () => {
        const value = settings.get_string(WEB_SEARCH_URL_KEY);
        if (row.get_text() !== value) row.set_text(value);
    });
    group.add(row);
    return row;
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

    const dynamicGroup = addGroup(page, _('Dynamic Panel (Dock + Panel)'),
        _('Shrink the panel to fit its contents like a floating dock while keeping all panel applets and controls'));

    const dynamicRow = new Adw.SwitchRow({
        title: _('Dynamic Panel'),
        subtitle: _('Use dock-style compact background, rounded corners, and borders for the panel'),
    });
    settings.bind('dynamic-panel', dynamicRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    dynamicGroup.add(dynamicRow);

    const lengthRow = new Adw.ActionRow({
        title: _('Panel Length'),
        subtitle: _('0% automatically hugs contents; higher values set a custom minimum length'),
    });
    const lengthAdj = new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 5,
        page_increment: 10,
        value: settings.get_int('dynamic-panel-length'),
    });
    const lengthScale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: lengthAdj,
        draw_value: true,
        value_pos: Gtk.PositionType.LEFT,
         digits: 0,
        width_request: 180,
        valign: Gtk.Align.CENTER,
    });
    lengthScale.set_format_value_func((_scale, val) => (val <= 0 ? _('Auto') : `${Math.round(val)}%`));
    settings.bind('dynamic-panel-length', lengthAdj, 'value', Gio.SettingsBindFlags.DEFAULT);
    lengthRow.add_suffix(lengthScale);
    dynamicGroup.add(lengthRow);

    const positionRow = addSegmentedRow(dynamicGroup, settings, 'dynamic-panel-position', _('Position'),
        _('Placement of the dynamic panel along the screen edge'), [
            { name: _('Left'), value: 'START' },
            { name: _('Center'), value: 'CENTER' },
            { name: _('Right'), value: 'END' },
        ]);

    const radiusRow = addSliderRow(dynamicGroup, settings, 'border-radius', _('Corner Radius'),
        null, { lower: 0, upper: 50, step: 1 }, fmt.px);

    const isDynamicActive = () => settings.get_boolean('hybrid-panel-mode') && settings.get_boolean('dynamic-panel');
    showWhen(lengthRow, settings, ['hybrid-panel-mode', 'dynamic-panel'], isDynamicActive);
    showWhen(positionRow, settings, ['hybrid-panel-mode', 'dynamic-panel'], isDynamicActive);
    showWhen(radiusRow, settings, ['hybrid-panel-mode', 'dynamic-panel'], isDynamicActive);
    showWhen(dynamicGroup, settings, ['hybrid-panel-mode'], isPanel);

    const startGroup = addGroup(page, _('App Grid Button'), _('What the App Grid button opens in Panel mode'));
    addSwitchRow(startGroup, settings, 'start-menu', _('Dhruva Start Menu'),
        _('Pinned apps, recent apps and files, search, Lock and Power. Turn off to open GNOME’s app grid instead'));
    const isStartMenu = () => settings.get_boolean('start-menu');
    const recentAppsRow = addSwitchRow(startGroup, settings, 'start-menu-recent-apps', _('Recent Apps'),
        _('Show the apps you use most under Pinned'));
    const continueRow = addSwitchRow(startGroup, settings, 'start-menu-continue', _('Continue Where You Left Off'),
        _('Show the files you opened recently'));
    const recentRow = addSliderRow(startGroup, settings, 'start-menu-recent-files', _('Recent Files'),
        _('How many files Continue where you left off shows'), { lower: 1, upper: 50, step: 1 }, value => `${Math.round(value)}`);
    const providersRow = addSwitchRow(startGroup, settings, 'start-menu-search-providers', _('Search Providers'),
        _('Results from apps like Characters, Calendar and Calculator'));
    const webRow = addSwitchRow(startGroup, settings, 'start-menu-web-search', _('Web Search'),
        _('Offer to search the web for what you type'));
    const webUrlRow = addWebSearchUrlRow(startGroup, settings);
    showWhen(recentAppsRow, settings, ['start-menu'], isStartMenu);
    showWhen(continueRow, settings, ['start-menu'], isStartMenu);
    showWhen(recentRow, settings, ['start-menu', 'start-menu-continue'], () => isStartMenu() && settings.get_boolean('start-menu-continue'));
    showWhen(providersRow, settings, ['start-menu'], isStartMenu);
    showWhen(webRow, settings, ['start-menu'], isStartMenu);
    showWhen(webUrlRow, settings, ['start-menu', 'start-menu-web-search'], () => isStartMenu() && settings.get_boolean('start-menu-web-search'));
    showWhen(startGroup, settings, ['hybrid-panel-mode'], isPanel);

    const clockGroup = addGroup(page, _('Clock'), _('These are GNOME’s own clock settings, so the lock screen follows too'));
    addClockSwitch(clockGroup, clockSettings, 'clock-show-date', _('Date'), _('Second line under the time'));
    const dateFormatRow = addDateFormatRow(clockGroup, settings);
    showWhen(dateFormatRow, clockSettings, ['clock-show-date'], () => clockSettings.get_boolean('clock-show-date'));
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

    for (const key of ['hybrid-panel-mode', 'dynamic-panel', 'dynamic-panel-length', 'dynamic-panel-position', 'border-radius', 'blur-enabled', DATE_FORMAT_KEY])
        onSettingChanged(settings, key, () => preview.redraw());
    for (const key of ['clock-show-date', 'clock-show-seconds', 'clock-format'])
        onSettingChanged(clockSettings, key, () => preview.redraw());

    window.add(page);
}