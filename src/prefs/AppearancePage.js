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
import cairo from 'gi://cairo';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import {
    fmt, addGroup, addGroupReset, showWhen, addSwitchRow, addSliderRow, addComboRow, addSegmentedRow,
    addColorRow, addToggleExpander, parseColor, roundedRect, paintBackdrop, MOCK_ICON_COLORS,
} from './PrefsWidgets.js';


const THEMES = () => [
    { name: _('Custom Color'), value: 'default' },
    { name: _('Wallpaper Color'), value: 'chameleon' },
    { name: _('Carbon'), value: 'carbon' },
    { name: _('Nord'), value: 'nord' },
    { name: _('Catppuccin Mocha'), value: 'catppuccin' },
    { name: _('Gruvbox Dark'), value: 'gruvbox' },
    { name: _('Ash Glass'), value: 'ash' },
    { name: _('Dracula'), value: 'dracula' },
    { name: _('Tokyo Night'), value: 'tokyo-night' },
    { name: _('Aurora'), value: 'aurora' },
    { name: _('Sunset'), value: 'sunset' },
    { name: _('Slate Ocean'), value: 'slate-ocean' },
];

const BACKGROUND_KEYS = ['background-color', 'use-gradient', 'background-gradient-color', 'gradient-direction', 'background-opacity', 'context-menu-opacity'];
const SHAPE_KEYS = ['border-radius', 'stroke-width', 'stroke-color', 'stroke-opacity'];
const INDICATOR_KEYS = ['indicator-style', 'indicator-color-mode', 'indicator-color', 'indicator-size', 'indicator-glow'];

const RUNNING_ICONS = [0, 2, 3];
const BADGE_ICON = 2;
const APP_SEPARATOR_AFTER = 4;
const MODULE_SEPARATOR_AFTER = 5;

const PREVIEW_HEIGHT = 150;
const PREVIEW_INDICATOR_GAP = 6;

class DockPreview {
    constructor(settings) {
        this._settings = settings;
        this.widget = new Gtk.DrawingArea({ content_height: PREVIEW_HEIGHT, hexpand: true });
        this.widget.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));
    }

    redraw() {
        this.widget.queue_draw();
    }

    _num(key) {
        return this._settings.get_value(key).unpack();
    }

    _draw(cr, w, h) {
        const s = this._settings;
        roundedRect(cr, 0, 0, w, h, 14);
        cr.clip();
        paintBackdrop(cr, w, h);

        const isDynamicPanel = s.get_boolean('hybrid-panel-mode') && s.get_boolean('dynamic-panel');
        const isBar = s.get_boolean('full-width') || (s.get_boolean('hybrid-panel-mode') && !isDynamicPanel);
        const iconSize = 32;
        const gap = 10;
        const count = MOCK_ICON_COLORS.length;
        const separatorRoom = 2 * (gap + 2);
        const contentW = count * iconSize + (count - 1) * gap + separatorRoom;
        const dockH = iconSize + 26;
        const dockW = isBar ? w : contentW + 36;
        const dockX = (w - dockW) / 2;
        const dockY = isBar ? h - dockH : h - dockH - 20;
        const radius = isBar ? 0 : Math.min(this._num('border-radius'), dockH / 2);

        this._paintBackground(cr, dockX, dockY, dockW, dockH, radius, isBar);
        const iconsX = (w - contentW) / 2;
        const iconsY = dockY + (dockH - iconSize) / 2 - 2;
        this._paintIcons(cr, iconsX, iconsY, iconSize, gap);

        if (isDynamicPanel && s.get_boolean('show-panel-separator')) {
            this._paintSeparator(cr, iconsX + contentW + gap / 2 + 1, iconsY, iconSize, 'panel-separator');
        }
    }

    _paintBackground(cr, x, y, w, h, r, isBar) {
        const s = this._settings;
        roundedRect(cr, x, y, w, h, r);

        if (s.get_boolean('blur-enabled')) {
            cr.setSourceRGBA(1, 1, 1, 0.16);
            cr.fillPreserve();
        } else if (s.get_string('dock-theme') === 'default') {
            const opacity = this._num('background-opacity') / 100;
            const start = parseColor(s.get_string('background-color'));
            if (s.get_boolean('use-gradient')) {
                const end = parseColor(s.get_string('background-gradient-color'));
                const isVertical = s.get_string('gradient-direction') === 'vertical';
                const gradient = new cairo.LinearGradient(x, y, isVertical ? x : x + w, isVertical ? y + h : y);
                gradient.addColorStopRGBA(0, start.red, start.green, start.blue, opacity);
                gradient.addColorStopRGBA(1, end.red, end.green, end.blue, opacity);
                cr.setSource(gradient);
            } else {
                cr.setSourceRGBA(start.red, start.green, start.blue, opacity);
            }
            cr.fillPreserve();
        } else {
            cr.setSourceRGBA(0.1, 0.1, 0.13, 0.8);
            cr.fillPreserve();
        }

        const strokeWidth = isBar ? 0 : this._num('stroke-width');
        if (strokeWidth > 0) {
            const stroke = parseColor(s.get_string('stroke-color'));
            cr.setSourceRGBA(stroke.red, stroke.green, stroke.blue, this._num('stroke-opacity') / 100);
            cr.setLineWidth(strokeWidth);
            cr.stroke();
        } else {
            cr.newPath();
        }
    }

    _paintIcons(cr, startX, y, size, gap) {
        const s = this._settings;
        let x = startX;

        MOCK_ICON_COLORS.forEach(([r, g, b], index) => {
            roundedRect(cr, x, y, size, size, 8);
            cr.setSourceRGB(r, g, b);
            cr.fill();

            if (RUNNING_ICONS.includes(index) && s.get_boolean('show-running-indicators'))
                this._paintIndicator(cr, x + size / 2, y + size, [r, g, b], index === 0);
            if (index === BADGE_ICON && s.get_boolean('show-notification-badges'))
                this._paintBadge(cr, x + size - 4, y + 4);

            x += size + gap;
            if (index === APP_SEPARATOR_AFTER - 1 && s.get_boolean('show-app-separator')) {
                this._paintSeparator(cr, x - gap / 2 + 1, y, size, 'running-separator');
                x += gap + 2;
            } else if (index === MODULE_SEPARATOR_AFTER - 1 && s.get_boolean('show-module-separator')) {
                this._paintSeparator(cr, x - gap / 2 + 1, y, size, 'separator');
                x += gap + 2;
            } else if (index === APP_SEPARATOR_AFTER - 1 || index === MODULE_SEPARATOR_AFTER - 1) {
                x += gap + 2;
            }
        });
    }

    _paintSeparator(cr, centerX, iconY, size, prefix) {
        const s = this._settings;
        const width = Math.max(1, this._num(`${prefix}-width`));
        const length = size * this._num(`${prefix}-height`) / 100;
        const color = parseColor(s.get_string(`${prefix}-color`));
        roundedRect(cr, centerX - width / 2, iconY + (size - length) / 2, width, length, width / 2);
        cr.setSourceRGBA(color.red, color.green, color.blue, this._num(`${prefix}-opacity`) / 100);
        cr.fill();
    }

    _paintIndicator(cr, centerX, iconBottom, iconColor, isFocused) {
        const s = this._settings;
        const style = s.get_string('indicator-style');
        const size = this._num('indicator-size');
        const top = iconBottom + PREVIEW_INDICATOR_GAP;

        let color = { red: iconColor[0], green: iconColor[1], blue: iconColor[2] };
        if (s.get_string('indicator-color-mode') === 'custom') color = parseColor(s.get_string('indicator-color'));

        let w = size;
        let h = size;
        let r = size / 2;
        if (style === 'dash') w = size * 2.5;
        else if (style === 'line') {
            w = 22;
            h = Math.max(2, size / 2);
        } else if (style === 'square') r = 1;
        else if (style === 'windows') {
            w = isFocused ? 18 : 8;
            h = Math.max(2, size / 2);
        }

        if (s.get_boolean('indicator-glow')) {
            roundedRect(cr, centerX - w / 2 - 2, top - 2, w + 4, h + 4, r + 2);
            cr.setSourceRGBA(color.red, color.green, color.blue, 0.35);
            cr.fill();
        }
        roundedRect(cr, centerX - w / 2, top, w, h, Math.min(r, h / 2));
        cr.setSourceRGBA(color.red, color.green, color.blue, 1);
        cr.fill();
    }

    _paintBadge(cr, centerX, centerY) {
        cr.arc(centerX, centerY, 7, 0, 2 * Math.PI);
        cr.setSourceRGB(0.9, 0.22, 0.24);
        cr.fill();
        cr.setSourceRGB(1, 1, 1);
        cr.selectFontFace('Sans', 0, 1);
        cr.setFontSize(9);
        cr.moveTo(centerX - 2.7, centerY + 3.2);
        cr.showText('3');
    }
}


export function buildAppearancePage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Appearance'),
        icon_name: 'preferences-desktop-wallpaper-symbolic',
    });

    const preview = new DockPreview(settings);
    const isBlur = () => settings.get_boolean('blur-enabled');
    const isFullBar = () => settings.get_boolean('full-width') ||
        (settings.get_boolean('hybrid-panel-mode') && !settings.get_boolean('dynamic-panel'));

    const heroGroup = addGroup(page, _('Your Dock'), _('Changes show up here as you make them'));
    heroGroup.add(preview.widget);

    const themeGroup = addGroup(page, _('Background'));
    addGroupReset(themeGroup, settings, ['dock-theme', ...BACKGROUND_KEYS]);
    addComboRow(themeGroup, settings, 'dock-theme', _('Theme'), _('A ready palette, or your own colours'), THEMES());

    const chameleonRow = new Adw.ActionRow({
        title: _('Matching your wallpaper'),
        subtitle: _('Dock and indicator colours follow the current wallpaper'),
        css_classes: ['success'],
    });
    themeGroup.add(chameleonRow);

    const isCustom = () => settings.get_string('dock-theme') === 'default';
    const useGradient = () => isCustom() && settings.get_boolean('use-gradient');

    const colorRow = addColorRow(themeGroup, settings, 'background-color', _('Colour'));
    const gradientRow = addSwitchRow(themeGroup, settings, 'use-gradient', _('Gradient'), _('Blend into a second colour'));
    const secondColorRow = addColorRow(themeGroup, settings, 'background-gradient-color', _('Second Colour'));
    const directionRow = addSegmentedRow(themeGroup, settings, 'gradient-direction', _('Direction'), null, [
        { name: _('Vertical'), value: 'vertical' },
        { name: _('Horizontal'), value: 'horizontal' },
    ]);
    addSliderRow(themeGroup, settings, 'background-opacity', _('Opacity'), _('Background opacity of dock and panel'), { lower: 0, upper: 100, step: 5 }, fmt.percent);
    addSliderRow(themeGroup, settings, 'context-menu-opacity', _('Menu &amp; Popup Opacity'),
        _('Background opacity of context menus, folders, tray and overflow popups'), { lower: 0, upper: 100, step: 5 }, fmt.percent);

    showWhen(chameleonRow, settings, ['dock-theme'], () => settings.get_string('dock-theme') === 'chameleon');
    showWhen(colorRow, settings, ['dock-theme'], isCustom);
    showWhen(gradientRow, settings, ['dock-theme'], isCustom);
    showWhen(secondColorRow, settings, ['dock-theme', 'use-gradient'], useGradient);
    showWhen(directionRow, settings, ['dock-theme', 'use-gradient'], useGradient);
    showWhen(themeGroup, settings, ['blur-enabled'], () => !isBlur());

    const glassNote = addGroup(page, _('Background'));
    glassNote.add(new Adw.ActionRow({
        title: _('Blur is on'),
        subtitle: _('The dock is made of glass now. Its look is set on the Blur page'),
    }));
    showWhen(glassNote, settings, ['blur-enabled'], isBlur);

    const shapeGroup = addGroup(page, _('Shape'));
    addGroupReset(shapeGroup, settings, SHAPE_KEYS);
    addSliderRow(shapeGroup, settings, 'border-radius', _('Corner Radius'), null, { lower: 0, upper: 50, step: 1 }, fmt.px);
    addSliderRow(shapeGroup, settings, 'stroke-width', _('Outline'), _('Line around the dock, 0 hides it'),
        { lower: 0, upper: 10, step: 1 }, fmt.px);
    const strokeColorRow = addColorRow(shapeGroup, settings, 'stroke-color', _('Outline Colour'));
    const strokeOpacityRow = addSliderRow(shapeGroup, settings, 'stroke-opacity', _('Outline Opacity'), null,
        { lower: 0, upper: 100, step: 5 }, fmt.percent);
    const hasStroke = () => preview._num('stroke-width') > 0;
    showWhen(strokeColorRow, settings, ['stroke-width'], hasStroke);
    showWhen(strokeOpacityRow, settings, ['stroke-width'], hasStroke);
    showWhen(shapeGroup, settings, ['full-width', 'hybrid-panel-mode', 'dynamic-panel'], () => !isFullBar());

    const indicatorGroup = addGroup(page, _('Running Apps'));
    addGroupReset(indicatorGroup, settings, INDICATOR_KEYS);
    const indicatorExpander = addToggleExpander(indicatorGroup, settings, 'show-running-indicators',
        _('Indicators'), _('Marks under apps that are open'));
    addComboRow(indicatorExpander, settings, 'indicator-style', _('Style'), null, [
        { name: _('Dot'), value: 'dot' },
        { name: _('Dash'), value: 'dash' },
        { name: _('Line'), value: 'line' },
        { name: _('Square'), value: 'square' },
        { name: _('Dynamic'), value: 'windows' },
    ]);
    const colorModeRow = addSegmentedRow(indicatorExpander, settings, 'indicator-color-mode', _('Colour'), null, [
        { name: _('From Icon'), value: 'dominant' },
        { name: _('Custom'), value: 'custom' },
    ]);
    const indicatorColorRow = addColorRow(indicatorExpander, settings, 'indicator-color', _('Custom Colour'));
    addSliderRow(indicatorExpander, settings, 'indicator-size', _('Size'), null, { lower: 2, upper: 12, step: 1 }, fmt.px);
    addSwitchRow(indicatorExpander, settings, 'indicator-glow', _('Glow'), _('A soft light around the indicator'));

    const isChameleon = () => settings.get_string('dock-theme') === 'chameleon' && !isBlur();
    showWhen(colorModeRow, settings, ['dock-theme', 'blur-enabled'], () => !isChameleon());
    showWhen(indicatorColorRow, settings, ['dock-theme', 'blur-enabled', 'indicator-color-mode'],
        () => !isChameleon() && settings.get_string('indicator-color-mode') === 'custom');

    addSwitchRow(indicatorGroup, settings, 'show-notification-badges', _('Notification Badges'),
        _('Unread counts on app icons'));
    const hoverRow = addSliderRow(indicatorGroup, settings, 'tooltip-opacity', _('Preview Box Opacity'),
        _('Background of the hover preview and app highlight'), { lower: 0, upper: 100, step: 5 }, fmt.percent);
    showWhen(hoverRow, settings, ['hover-zoom', 'hybrid-panel-mode'],
        () => !settings.get_boolean('hover-zoom') || settings.get_boolean('hybrid-panel-mode'));

    const separatorGroup = addGroup(page, _('Separators'));
    const addSeparatorRows = (expander, prefix) => {
        addSliderRow(expander, settings, `${prefix}-width`, _('Thickness'), null, { lower: 0, upper: 10, step: 1 }, fmt.px);
        addSliderRow(expander, settings, `${prefix}-height`, _('Length'), _('Share of the dock height'),
            { lower: 10, upper: 100, step: 5 }, fmt.percent);
        addColorRow(expander, settings, `${prefix}-color`, _('Colour'));
        addSliderRow(expander, settings, `${prefix}-opacity`, _('Opacity'), null, { lower: 0, upper: 100, step: 5 }, fmt.percent);
    };
    addSeparatorRows(addToggleExpander(separatorGroup, settings, 'show-app-separator',
        _('Between Pinned and Running'), _('Divides your pinned apps from other open apps')), 'running-separator');
    addSeparatorRows(addToggleExpander(separatorGroup, settings, 'show-module-separator',
        _('Before Modules'), _('Divides apps from clock, launcher and folders')), 'separator');
    const panelSeparatorExpander = addToggleExpander(separatorGroup, settings, 'show-panel-separator',
        _('Before Top Bar Items'), _('Centred between icons and the top bar status area in dynamic panel mode'));
    addSeparatorRows(panelSeparatorExpander, 'panel-separator');
    showWhen(panelSeparatorExpander, settings, ['hybrid-panel-mode', 'dynamic-panel'],
        () => settings.get_boolean('hybrid-panel-mode') && settings.get_boolean('dynamic-panel'));

    const previewKeys = [
        'blur-enabled', 'full-width', 'hybrid-panel-mode', 'dynamic-panel', 'dock-theme', ...BACKGROUND_KEYS, ...SHAPE_KEYS,
        ...INDICATOR_KEYS, 'show-running-indicators', 'show-notification-badges',
        'show-app-separator', 'running-separator-width', 'running-separator-height', 'running-separator-color',
        'running-separator-opacity', 'show-module-separator', 'separator-width', 'separator-height',
        'separator-color', 'separator-opacity', 'show-panel-separator', 'panel-separator-width',
        'panel-separator-height', 'panel-separator-color', 'panel-separator-opacity',
    ];
    for (const key of previewKeys) onSettingChanged(settings, key, () => preview.redraw());

    window.add(page);
}