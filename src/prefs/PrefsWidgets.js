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
import cairo from 'gi://cairo';

import { makeGroupResetBtn } from './ResetButtons.js';
import { onSettingChanged } from './SettingsSignals.js';


export const fmt = {
    px: value => `${Math.round(value)} px`,
    ms: value => `${Math.round(value)} ms`,
    percent: value => `${Math.round(value)}%`,
    fraction: value => `${Math.round(value * 100)}%`,
    times: value => `${value.toFixed(2)}×`,
    deg: value => `${Math.round(value)}°`,
    plain: value => `${Math.round(value)}`,
};

function appendRow(parent, row) {
    if (parent.add_row) parent.add_row(row);
    else parent.add(row);
    return row;
}

export function addGroup(page, title = '', description = '') {
    const group = new Adw.PreferencesGroup({
        title: title ?? '',
        description: description ?? '',
    });
    page.add(group);
    return group;
}

export function addGroupReset(group, settings, keys) {
    group.set_header_suffix(makeGroupResetBtn(settings)(keys));
}

export function showWhen(widget, settings, keys, isVisible) {
    const sync = () => widget.set_visible(isVisible());
    for (const key of keys) onSettingChanged(settings, key, sync);
    sync();
}

export function addSwitchRow(parent, settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({ title, subtitle: subtitle ?? '' });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return appendRow(parent, row);
}

let _sliderCssProvider = null;
function ensureSliderLabelCss() {
    if (_sliderCssProvider) return;
    _sliderCssProvider = new Gtk.CssProvider();
    _sliderCssProvider.load_from_string(`
        .dhruva-slider-value {
            color: #ffffff;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
        }
    `);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        _sliderCssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
}

const GNOME_ACCENT_HEX = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
};

function getSystemAccentRGBA() {
    const styleMgr = Adw.StyleManager.get_default();
    if (styleMgr && styleMgr.get_accent_color_rgba) {
        return styleMgr.get_accent_color_rgba();
    }

    try {
        const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = iface.get_string('accent-color');
        return parseColor(GNOME_ACCENT_HEX[name] || '#3584e4');
    } catch (_e) {
        return parseColor('#3584e4');
    }
}

export function addSliderRow(parent, settings, key, title, subtitle, range, format) {
    ensureSliderLabelCss();

    const row = new Adw.ActionRow({ title, subtitle: subtitle || '' });
    const adjustment = new Gtk.Adjustment({
        lower: range.lower,
        upper: range.upper,
        step_increment: range.step,
        page_increment: range.step * 5,
    });
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

    let decimals = 0;
    if (range.step < 1) decimals = range.step < 0.1 ? 2 : 1;

    const snapToStep = raw => {
        const clamped = Math.max(range.lower, Math.min(range.upper, raw));
        const steps = Math.round((clamped - range.lower) / range.step);
        const snapped = range.lower + steps * range.step;
        return Math.max(range.lower, Math.min(range.upper, Number(snapped.toFixed(decimals))));
    };

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        valign: Gtk.Align.CENTER,
    });

    const valueLabel = new Gtk.Label({
        label: format(adjustment.get_value()),
        css_classes: ['dhruva-slider-value'],
        xalign: 1,
        width_chars: 6,
        valign: Gtk.Align.CENTER,
    });

    const SLIDER_W = 200;
    const SLIDER_H = 34;
    const PAD_X = 8;

    const area = new Gtk.DrawingArea({
        content_width: SLIDER_W,
        content_height: SLIDER_H,
        valign: Gtk.Align.CENTER,
        focusable: true,
    });

    const totalSteps = Math.max(1, Math.round((range.upper - range.lower) / range.step));
    const visualDotSteps = totalSteps <= 12 ? totalSteps : Math.min(10, totalSteps);

    area.set_draw_func((_area, cr, w, h) => {
        const trackX = PAD_X;
        const trackW = w - PAD_X * 2;
        const trackH = 14;
        const trackY = (h - trackH) / 2;
        const cy = h / 2;

        const val = adjustment.get_value();
        const ratio = Math.max(0, Math.min(1, (val - range.lower) / (range.upper - range.lower)));
        const thumbX = trackX + ratio * trackW;

        const thumbW = 4;
        const thumbH = 26;
        const thumbGap = 5;

        const accent = getSystemAccentRGBA();
        const ar = accent.red;
        const ag = accent.green;
        const ab = accent.blue;

        const activeColor = [ar, ag, ab, 1.0];
        const inactiveColor = [ar, ag, ab, 0.22];
        const activeDot = [1.0, 1.0, 1.0, 0.92];
        const inactiveDot = [ar, ag, ab, 0.85];

        const leftW = thumbX - thumbGap - trackX;
        if (leftW > 2) {
            const leftR = Math.min(trackH / 2, leftW / 2);
            cr.newSubPath();
            cr.arc(trackX + leftR, trackY + leftR, leftR, Math.PI, 1.5 * Math.PI);
            cr.arc(trackX + leftW - 2, trackY + 2, 2, -Math.PI / 2, 0);
            cr.arc(trackX + leftW - 2, trackY + trackH - 2, 2, 0, Math.PI / 2);
            cr.arc(trackX + leftR, trackY + trackH - leftR, leftR, 0.5 * Math.PI, Math.PI);
            cr.closePath();
            cr.setSourceRGBA(...activeColor);
            cr.fill();
        }

        const rightX = thumbX + thumbGap;
        const rightW = (trackX + trackW) - rightX;
        if (rightW > 2) {
            const rightR = Math.min(trackH / 2, rightW / 2);
            cr.newSubPath();
            cr.arc(rightX + 2, trackY + 2, 2, Math.PI, 1.5 * Math.PI);
            cr.arc(rightX + rightW - rightR, trackY + rightR, rightR, -Math.PI / 2, 0);
            cr.arc(rightX + rightW - rightR, trackY + trackH - rightR, rightR, 0, Math.PI / 2);
            cr.arc(rightX + 2, trackY + trackH - 2, 2, 0.5 * Math.PI, Math.PI);
            cr.closePath();
            cr.setSourceRGBA(...inactiveColor);
            cr.fill();
        }

        const innerStart = trackX + 6;
        const innerSpan = trackW - 12;
        for (let i = 0; i <= visualDotSteps; i++) {
            const dotX = innerStart + (i / visualDotSteps) * innerSpan;
            if (Math.abs(dotX - thumbX) < thumbGap + 3) continue;

            cr.arc(dotX, cy, 1.8, 0, 2 * Math.PI);
            if (dotX < thumbX) cr.setSourceRGBA(...activeDot);
            else cr.setSourceRGBA(...inactiveDot);
            cr.fill();
        }

        roundedRect(cr, thumbX - thumbW / 2, cy - thumbH / 2, thumbW, thumbH, thumbW / 2);
        cr.setSourceRGBA(ar, ag, ab, 1.0);
        cr.fill();
    });

    const styleMgr = Adw.StyleManager.get_default();
    if (styleMgr && styleMgr.get_accent_color_rgba) {
        const sigId = styleMgr.connect('notify::accent-color-rgba', () => area.queue_draw());
        area.connect('destroy', () => styleMgr.disconnect(sigId));
    }

    const updateFromX = x => {
        const w = area.get_width() || SLIDER_W;
        const trackW = w - PAD_X * 2;
        const ratio = Math.max(0, Math.min(1, (x - PAD_X) / trackW));
        const raw = range.lower + ratio * (range.upper - range.lower);
        const snapped = snapToStep(raw);
        if (Math.abs(adjustment.get_value() - snapped) > 1e-6) {
            adjustment.set_value(snapped);
        }
    };

    const drag = new Gtk.GestureDrag();
    let dragStartX = 0;
    drag.connect('drag-begin', (_g, startX) => {
        dragStartX = startX;
        area.grab_focus();
        updateFromX(startX);
    });
    drag.connect('drag-update', (_g, offsetX) => {
        updateFromX(dragStartX + offsetX);
    });
    area.add_controller(drag);

    const scroll = new Gtk.EventControllerScroll({ flags: Gtk.EventControllerScrollFlags.VERTICAL });
    scroll.connect('scroll', (_c, _dx, dy) => {
        const dir = dy < 0 ? 1 : -1;
        const next = snapToStep(adjustment.get_value() + dir * range.step);
        adjustment.set_value(next);
        return Gdk.EVENT_STOP;
    });
    area.add_controller(scroll);

    const keyCtrl = new Gtk.EventControllerKey();
    keyCtrl.connect('key-pressed', (_c, keyval) => {
        if (keyval === Gdk.KEY_Left || keyval === Gdk.KEY_Down) {
            adjustment.set_value(snapToStep(adjustment.get_value() - range.step));
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_Right || keyval === Gdk.KEY_Up) {
            adjustment.set_value(snapToStep(adjustment.get_value() + range.step));
            return Gdk.EVENT_STOP;
        }
        return Gdk.EVENT_PROPAGATE;
    });
    area.add_controller(keyCtrl);

    adjustment.connect('value-changed', () => {
        valueLabel.set_label(format(adjustment.get_value()));
        area.queue_draw();
    });

    box.append(valueLabel);
    box.append(area);
    row.add_suffix(box);
    return appendRow(parent, row);
}

export function addComboRow(parent, settings, key, title, subtitle, options) {
    const row = new Adw.ComboRow({
        title,
        subtitle: subtitle ?? '',
        model: Gtk.StringList.new(options.map(option => option.name)),
    });

    const sync = () => {
        const index = options.findIndex(option => option.value === settings.get_string(key));
        if (index >= 0 && row.get_selected() !== index) row.set_selected(index);
    };
    row.connect('notify::selected', () => {
        const option = options[row.get_selected()];
        if (option && option.value !== settings.get_string(key)) settings.set_string(key, option.value);
    });
    onSettingChanged(settings, key, sync);
    sync();

    return appendRow(parent, row);
}

export function bindChoice(settings, key, buttonsByValue) {
    const sync = () => {
        const button = buttonsByValue.get(settings.get_string(key));
        if (button && !button.get_active()) button.set_active(true);
    };
    for (const [value, button] of buttonsByValue) {
        button.connect('toggled', () => {
            if (button.get_active() && settings.get_string(key) !== value) settings.set_string(key, value);
        });
    }
    onSettingChanged(settings, key, sync);
    sync();
}

export function addSegmentedRow(parent, settings, key, title, subtitle, options) {
    const row = new Adw.ActionRow({ title, subtitle: subtitle ?? '' });
    const box = new Gtk.Box({ valign: Gtk.Align.CENTER, css_classes: ['linked'] });

    const buttonsByValue = new Map();
    let first = null;
    for (const { name, value } of options) {
        const button = new Gtk.ToggleButton({ label: name });
        if (first) button.set_group(first);
        else first = button;
        buttonsByValue.set(value, button);
        box.append(button);
    }
    bindChoice(settings, key, buttonsByValue);

    row.add_suffix(box);
    return appendRow(parent, row);
}

export function parseColor(hex) {
    const rgba = new Gdk.RGBA();
    if (!rgba.parse(hex)) rgba.parse('#ffffff');
    return rgba;
}

export function toHex(rgba) {
    const channel = value => Math.round(value * 255).toString(16).padStart(2, '0');
    return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
}

export function addColorRow(parent, settings, key, title, subtitle = '') {
    const row = new Adw.ActionRow({ title, subtitle: subtitle ?? '' });
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({ with_alpha: false }),
        rgba: parseColor(settings.get_string(key)),
        valign: Gtk.Align.CENTER,
    });

    button.connect('notify::rgba', () => {
        const hex = toHex(button.get_rgba());
        if (hex !== settings.get_string(key)) settings.set_string(key, hex);
    });
    onSettingChanged(settings, key, () => {
        const rgba = parseColor(settings.get_string(key));
        if (!rgba.equal(button.get_rgba())) button.set_rgba(rgba);
    });

    row.add_suffix(button);
    return appendRow(parent, row);
}

export function addToggleExpander(parent, settings, key, title, subtitle = '') {
    const expander = new Adw.ExpanderRow({ title, subtitle: subtitle ?? '', show_enable_switch: true });
    settings.bind(key, expander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);
    const syncExpanded = () => expander.set_expanded(settings.get_boolean(key));
    onSettingChanged(settings, key, syncExpanded);
    syncExpanded();
    return appendRow(parent, expander);
}

export function addChoiceCards(group, settings, key, options) {
    const box = new Gtk.Box({ spacing: 12, homogeneous: true });
    const buttonsByValue = new Map();
    let first = null;

    for (const option of options) {
        const content = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_top: 14,
            margin_bottom: 14,
            margin_start: 16,
            margin_end: 16,
        });

        if (option.art) content.append(option.art);
        else content.append(new Gtk.Image({ icon_name: option.icon, pixel_size: 28, halign: Gtk.Align.START }));

        content.append(new Gtk.Label({
            label: option.title,
            xalign: option.art ? 0.5 : 0,
            css_classes: ['heading'],
        }));
        if (option.description) {
            content.append(new Gtk.Label({
                label: option.description,
                xalign: 0,
                wrap: true,
                width_chars: 1,
                css_classes: ['dim-label', 'caption'],
            }));
        }

        const button = new Gtk.ToggleButton({ child: content, hexpand: true });
        if (first) button.set_group(first);
        else first = button;
        buttonsByValue.set(option.value, button);
        box.append(button);
    }

    bindChoice(settings, key, buttonsByValue);
    group.add(box);
    return box;
}

export function roundedRect(cr, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export const MOCK_ICON_COLORS = [
    [0.36, 0.62, 0.98], [0.98, 0.55, 0.24], [0.30, 0.80, 0.52],
    [0.86, 0.36, 0.62], [0.96, 0.80, 0.30], [0.52, 0.46, 0.94], [0.40, 0.82, 0.86],
];

export function paintBackdrop(cr, w, h) {
    const base = new cairo.LinearGradient(0, 0, w, h);
    base.addColorStopRGB(0, 0.13, 0.19, 0.34);
    base.addColorStopRGB(1, 0.27, 0.16, 0.36);
    cr.setSource(base);
    cr.paint();

    const glow = new cairo.RadialGradient(w * 0.3, h * 0.2, 0, w * 0.3, h * 0.2, w * 0.6);
    glow.addColorStopRGBA(0, 0.98, 0.62, 0.42, 0.45);
    glow.addColorStopRGBA(1, 0.98, 0.62, 0.42, 0);
    cr.setSource(glow);
    cr.paint();
}