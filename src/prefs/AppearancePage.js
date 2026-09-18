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
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { addComboRow, addColorRow, addSwitchRow, addSegmentedRow, addCustomSpinRow } from './PrefsWidgets.js';


export function buildAppearancePage(window, settings, createResetBtn, createGroupReset) {
    const page = new Adw.PreferencesPage({
        title: _('Appearance'),
        icon_name: 'preferences-desktop-wallpaper-symbolic'
    });
    window.add(page);

    const colorsGroup = new Adw.PreferencesGroup({
        title: _('Panel Style'),
        description: _('Background colors and borders')
    });
    page.add(colorsGroup);

    const themeOptions = [
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

    addComboRow(colorsGroup, settings, 'dock-theme', _('Dock Theme'), _('Choose a preset theme or use custom colors'), 'preferences-desktop-theme-symbolic', themeOptions, null);

    const chameleonBanner = new Adw.ActionRow({
        title: _('Chameleon Active'),
        subtitle: _('Dock color &amp; indicator auto-update from your wallpaper'),
        icon_name: 'preferences-desktop-wallpaper-symbolic',
        css_classes: ['success']
    });
    colorsGroup.add(chameleonBanner);

    const bgColorRow = addColorRow(colorsGroup, settings, 'background-color', _('Primary Color'), 'preferences-desktop-appearance-symbolic');
    const useGradRow = addSwitchRow(colorsGroup, settings, 'use-gradient', _('Use Gradient'), _('Blend with a second color'), 'view-continuous-symbolic', null);
    const bgGradColorRow = addColorRow(colorsGroup, settings, 'background-gradient-color', _('Secondary Color'), 'preferences-desktop-appearance-symbolic');
    const gradDirRow = addSegmentedRow(colorsGroup, settings, 'gradient-direction', _('Gradient Direction'), _('Flow of the gradient'), 'view-refresh-symbolic', [
        { name: _('Vertical'), value: 'vertical' },
        { name: _('Horizontal'), value: 'horizontal' }
    ]);

    addCustomSpinRow(colorsGroup, settings, 'background-opacity', _('Background Opacity'), _('0 = Invisible, 100 = Solid'), 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const tooltipOpacityRow = addCustomSpinRow(colorsGroup, settings, 'tooltip-opacity', _('Hover Box Opacity'), _('App preview box background opacity (0-100)'), 'dialog-information-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const syncTooltipVisibility = () => {
        const hoverZoom = settings.get_boolean('hover-zoom');
        tooltipOpacityRow.set_visible(!hoverZoom);
    };
    settings.connect('changed::hover-zoom', syncTooltipVisibility);
    syncTooltipVisibility();

    const radiusRow = addCustomSpinRow(colorsGroup, settings, 'border-radius', _('Border Radius'), _('Corner roundness'), 'media-record-symbolic', {
        lower: 0,
        upper: 50,
        step_increment: 1
    }, createResetBtn);

    const strokeExpander = new Adw.ExpanderRow({
        title: _('Border Outline (Stroke)'),
        subtitle: _('Draw an outer line around the dock'),
        icon_name: 'format-text-strikethrough-symbolic',
        show_enable_switch: false
    });
    strokeExpander.add_suffix(createGroupReset(['stroke-width', 'stroke-color', 'stroke-opacity']));
    colorsGroup.add(strokeExpander);

    const desktopBtnExp = new Adw.ExpanderRow({
        title: _('Show Desktop Button Style'),
        subtitle: _('Customize the right-edge desktop button'),
        icon_name: 'computer-symbolic'
    });

    const masterDeskReset = createGroupReset(['desktop-btn-width', 'desktop-btn-opacity', 'desktop-btn-color']);
    masterDeskReset.valign = Gtk.Align.CENTER;
    desktopBtnExp.add_suffix(masterDeskReset);
    colorsGroup.add(desktopBtnExp);

    addCustomSpinRow(desktopBtnExp, settings, 'desktop-btn-width', _('Thickness'), _('Width in pixels'), 'format-text-strikethrough-symbolic', {
        lower: 2,
        upper: 100,
        step_increment: 1
    }, createResetBtn);

    addCustomSpinRow(desktopBtnExp, settings, 'desktop-btn-opacity', _('Opacity'), _('0 = Invisible, 100 = Solid'), 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    addColorRow(desktopBtnExp, settings, 'desktop-btn-color', _('Color'), 'preferences-desktop-appearance-symbolic');

    const syncDesktopBtnVisibility = () => {
        const isFull = settings.get_boolean('full-width');
        desktopBtnExp.set_visible(isFull);
    };
    settings.connect('changed::full-width', syncDesktopBtnVisibility);
    syncDesktopBtnVisibility();

    addCustomSpinRow(strokeExpander, settings, 'stroke-width', _('Stroke Width'), _('Thickness in pixels (0 to disable)'), 'format-text-strikethrough-symbolic', {
        lower: 0,
        upper: 10,
        step_increment: 1
    }, createResetBtn);

    addColorRow(strokeExpander, settings, 'stroke-color', _('Stroke Color'), 'preferences-desktop-appearance-symbolic');

    addCustomSpinRow(strokeExpander, settings, 'stroke-opacity', _('Stroke Opacity'), _('0 = Invisible, 100 = Solid'), 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const syncRadiusVisibility = () => {
        const isFull = settings.get_boolean('full-width');
        radiusRow.set_visible(!isFull);
        strokeExpander.set_visible(!isFull);
    };
    settings.connect('changed::full-width', syncRadiusVisibility);
    syncRadiusVisibility();

    const sepGroup = new Adw.PreferencesGroup({
        title: _('Separators'),
        description: _('Divider lines between dock items')
    });
    page.add(sepGroup);

    const modSepExp = new Adw.ExpanderRow({
        title: _('Module Separator'),
        subtitle: _('Divides clock, grid, and system icons'),
        icon_name: 'format-text-strikethrough-symbolic'
    });

    const masterModSepReset = createGroupReset(['show-module-separator', 'separator-width', 'separator-height', 'separator-color', 'separator-opacity']);
    masterModSepReset.valign = Gtk.Align.CENTER;
    modSepExp.add_suffix(masterModSepReset);
    sepGroup.add(modSepExp);

    addSwitchRow(modSepExp, settings, 'show-module-separator', _('Enable Module Separator'), _('Show a divider for system modules'), 'view-more-horizontal-symbolic', createResetBtn);

    addCustomSpinRow(modSepExp, settings, 'separator-width', _('Thickness'), _('Width in pixels'), 'format-text-strikethrough-symbolic', {
        lower: 0,
        upper: 10,
        step_increment: 1
    }, createResetBtn);
    addCustomSpinRow(modSepExp, settings, 'separator-height', _('Height / Length'), _('Percentage of dock size (10-100)'), 'format-justify-fill-symbolic', {
        lower: 10,
        upper: 100,
        step_increment: 5
    }, createResetBtn);
    addColorRow(modSepExp, settings, 'separator-color', _('Color'), 'preferences-desktop-appearance-symbolic');
    addCustomSpinRow(modSepExp, settings, 'separator-opacity', _('Opacity'), _('0 = Invisible, 100 = Solid'), 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const appSepExp = new Adw.ExpanderRow({
        title: _('App Separator'),
        subtitle: _('Divides pinned apps from running apps'),
        icon_name: 'format-justify-center-symbolic'
    });

    const masterAppSepReset = createGroupReset(['show-app-separator', 'running-separator-width', 'running-separator-height', 'running-separator-color', 'running-separator-opacity']);
    masterAppSepReset.valign = Gtk.Align.CENTER;
    appSepExp.add_suffix(masterAppSepReset);
    sepGroup.add(appSepExp);

    addSwitchRow(appSepExp, settings, 'show-app-separator', _('Enable App Separator'), _('Show a divider between pinned and unpinned apps'), 'view-more-horizontal-symbolic', createResetBtn);

    addCustomSpinRow(appSepExp, settings, 'running-separator-width', _('Thickness'), _('Width in pixels'), 'format-text-strikethrough-symbolic', {
        lower: 0,
        upper: 10,
        step_increment: 1
    }, createResetBtn);
    addCustomSpinRow(appSepExp, settings, 'running-separator-height', _('Height / Length'), _('Percentage of dock size (10-100)'), 'format-justify-fill-symbolic', {
        lower: 10,
        upper: 100,
        step_increment: 5
    }, createResetBtn);
    addColorRow(appSepExp, settings, 'running-separator-color', _('Color'), 'preferences-desktop-appearance-symbolic');
    addCustomSpinRow(appSepExp, settings, 'running-separator-opacity', _('Opacity'), _('0 = Invisible, 100 = Solid'), 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const badgesGroup = new Adw.PreferencesGroup({
        title: _('App Notifications'),
        description: _('Unread message counters')
    });
    page.add(badgesGroup);
    addSwitchRow(badgesGroup, settings, 'show-notification-badges', _('Show Notification Badges'), _('Display unread message counts on app icons'), 'user-available-symbolic');

    const indGroup = new Adw.PreferencesGroup({
        title: _('Indicators'),
        description: _('Styles for currently active applications')
    });
    page.add(indGroup);

    const indExpander = new Adw.ExpanderRow({
        title: _('Running Indicators'),
        subtitle: _('Settings for the active app dots/lines'),
        icon_name: 'media-record-symbolic',
        expanded: true
    });
    const masterIndReset = createGroupReset(['show-running-indicators', 'indicator-style', 'indicator-color', 'indicator-size', 'indicator-spacing', 'indicator-glow', 'indicator-color-mode']);
    masterIndReset.valign = Gtk.Align.CENTER;
    indExpander.add_suffix(masterIndReset);
    indGroup.add(indExpander);

    addSwitchRow(indExpander, settings, 'show-running-indicators', _('Show Indicators'), _('Display active marks under icons'), 'media-record-symbolic', createResetBtn);

    addComboRow(indExpander, settings, 'indicator-style', _('Indicator Style'), _('Shape of the indicator'), 'view-list-symbolic', [
        { name: _('Dot'), value: 'dot' },
        { name: _('Dash'), value: 'dash' },
        { name: _('Line'), value: 'line' },
        { name: _('Square'), value: 'square' },
        { name: _('Dynamic'), value: 'windows' }
    ], null);

    const colorModeRow = addComboRow(indExpander, settings, 'indicator-color-mode', _('Color Mode'), _('Match indicator color with icon or use custom'), 'preferences-desktop-appearance-symbolic', [
        { name: _('Match Icon Color'), value: 'dominant' },
        { name: _('Custom Color'), value: 'custom' }
    ], null);

    const indColorRow = addColorRow(indExpander, settings, 'indicator-color', _('Indicator Color'), 'preferences-desktop-appearance-symbolic');

    addCustomSpinRow(indExpander, settings, 'indicator-size', _('Indicator Size'), _('Limit: 2px to 12px'), 'zoom-in-symbolic', {
        lower: 2,
        upper: 12,
        step_increment: 1
    }, createResetBtn);
    addCustomSpinRow(indExpander, settings, 'indicator-spacing', _('Indicator Spacing'), _('Gap between icon and indicator'), 'format-indent-more-symbolic', {
        lower: 0,
        upper: 20,
        step_increment: 1
    }, createResetBtn);
    addSwitchRow(indExpander, settings, 'indicator-glow', _('Indicator Glow'), _('Add a shining shadow effect'), 'display-brightness-symbolic', null);

    const syncThemeVisibility = () => {
        const theme = settings.get_string('dock-theme');
        const isDefault = theme === 'default';
        const isChameleon = theme === 'chameleon';
        const useGrad = settings.get_boolean('use-gradient');
        const colorMode = settings.get_string('indicator-color-mode');

        chameleonBanner.set_visible(isChameleon);
        bgColorRow.set_visible(isDefault);
        useGradRow.set_visible(isDefault);
        bgGradColorRow.set_visible(isDefault && useGrad);
        gradDirRow.set_visible(isDefault && useGrad);
        colorModeRow.set_visible(!isChameleon);
        indColorRow.set_visible(!isChameleon && colorMode === 'custom');
    };

    settings.connect('changed::dock-theme', syncThemeVisibility);
    settings.connect('changed::use-gradient', syncThemeVisibility);
    settings.connect('changed::indicator-color-mode', syncThemeVisibility);
    syncThemeVisibility();
}