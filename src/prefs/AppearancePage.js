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

import { addComboRow, addColorRow, addSwitchRow, addSegmentedRow, addCustomSpinRow } from './PrefsWidgets.js';


export function buildAppearancePage(prefs, window, settings, createResetBtn, createGroupReset) {
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

    addComboRow(prefs, colorsGroup, settings, 'dock-theme', 'Dock Theme', 'Choose a preset theme or use custom colors', 'preferences-desktop-theme-symbolic', themeOptions, null);

    const chameleonBanner = new Adw.ActionRow({
        title: 'Chameleon Active',
        subtitle: 'Dock color &amp; indicator auto-update from your wallpaper',
        icon_name: 'preferences-desktop-wallpaper-symbolic',
        css_classes: ['success']
    });
    colorsGroup.add(chameleonBanner);

    const bgColorRow = addColorRow(prefs, colorsGroup, settings, 'background-color', 'Primary Color', 'preferences-desktop-appearance-symbolic');
    const useGradRow = addSwitchRow(colorsGroup, settings, 'use-gradient', 'Use Gradient', 'Blend with a second color', 'view-continuous-symbolic', null);
    const bgGradColorRow = addColorRow(prefs, colorsGroup, settings, 'background-gradient-color', 'Secondary Color', 'preferences-desktop-appearance-symbolic');
    const gradDirRow = addSegmentedRow(prefs, colorsGroup, settings, 'gradient-direction', 'Gradient Direction', 'Flow of the gradient', 'view-refresh-symbolic', [{
        name: 'Vertical',
        value: 'vertical'
    },
    {
        name: 'Horizontal',
        value: 'horizontal'
    }
    ]);

    addCustomSpinRow(colorsGroup, settings, 'background-opacity', 'Background Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const tooltipOpacityRow = addCustomSpinRow(colorsGroup, settings, 'tooltip-opacity', 'Hover Box Opacity', 'App preview box background opacity (0-100)', 'dialog-information-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const syncTooltipVisibility = () => {
        tooltipOpacityRow.set_visible(!settings.get_boolean('hover-zoom'));
    };
    prefs._settingsSignals.push(settings.connect('changed::hover-zoom', syncTooltipVisibility));
    syncTooltipVisibility();

    const radiusRow = addCustomSpinRow(colorsGroup, settings, 'border-radius', 'Border Radius', 'Corner roundness', 'media-record-symbolic', {
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

    const desktopBtnExp = new Adw.ExpanderRow({
        title: 'Show Desktop Button Style',
        subtitle: 'Customize the right-edge desktop button',
        icon_name: 'computer-symbolic'
    });
    
    const masterDeskReset = createGroupReset(['desktop-btn-width', 'desktop-btn-opacity', 'desktop-btn-color']);
    masterDeskReset.valign = Gtk.Align.CENTER;
    desktopBtnExp.add_suffix(masterDeskReset);
    colorsGroup.add(desktopBtnExp);

    addCustomSpinRow(desktopBtnExp, settings, 'desktop-btn-width', 'Thickness', 'Width in pixels', 'format-text-strikethrough-symbolic', {
        lower: 2,
        upper: 100,
        step_increment: 1
    }, createResetBtn);

    addCustomSpinRow(desktopBtnExp, settings, 'desktop-btn-opacity', 'Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    addColorRow(prefs, desktopBtnExp, settings, 'desktop-btn-color', 'Color', 'preferences-desktop-appearance-symbolic');

    const syncDesktopBtnVisibility = () => {
        const isFull = settings.get_boolean('full-width');
        desktopBtnExp.set_visible(isFull);
    };
    prefs._settingsSignals.push(settings.connect('changed::full-width', syncDesktopBtnVisibility));
    syncDesktopBtnVisibility();

    addCustomSpinRow(strokeExpander, settings, 'stroke-width', 'Stroke Width', 'Thickness in pixels (0 to disable)', 'format-text-strikethrough-symbolic', {
        lower: 0,
        upper: 10,
        step_increment: 1
    }, createResetBtn);

    addColorRow(prefs, strokeExpander, settings, 'stroke-color', 'Stroke Color', 'preferences-desktop-appearance-symbolic');

    addCustomSpinRow(strokeExpander, settings, 'stroke-opacity', 'Stroke Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const syncRadiusVisibility = () => {
        const isFull = settings.get_boolean('full-width');
        radiusRow.set_visible(!isFull);
        strokeExpander.set_visible(!isFull);
    };
    prefs._settingsSignals.push(settings.connect('changed::full-width', syncRadiusVisibility));
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
    
    const masterModSepReset = createGroupReset(['show-module-separator', 'separator-width', 'separator-height', 'separator-color', 'separator-opacity']);
    masterModSepReset.valign = Gtk.Align.CENTER;
    modSepExp.add_suffix(masterModSepReset);
    sepGroup.add(modSepExp);

    addSwitchRow(modSepExp, settings, 'show-module-separator', 'Enable Module Separator', 'Show a divider for system modules', 'view-more-horizontal-symbolic', createResetBtn);

    addCustomSpinRow(modSepExp, settings, 'separator-width', 'Thickness', 'Width in pixels', 'format-text-strikethrough-symbolic', {
        lower: 0,
        upper: 10,
        step_increment: 1
    }, createResetBtn);
    addCustomSpinRow(modSepExp, settings, 'separator-height', 'Height / Length', 'Percentage of dock size (10-100)', 'format-justify-fill-symbolic', {
        lower: 10,
        upper: 100,
        step_increment: 5
    }, createResetBtn);
    addColorRow(prefs, modSepExp, settings, 'separator-color', 'Color', 'preferences-desktop-appearance-symbolic');
    addCustomSpinRow(modSepExp, settings, 'separator-opacity', 'Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const appSepExp = new Adw.ExpanderRow({
        title: 'App Separator',
        subtitle: 'Divides pinned apps from running apps',
        icon_name: 'format-justify-center-symbolic'
    });
    
    const masterAppSepReset = createGroupReset(['show-app-separator', 'running-separator-width', 'running-separator-height', 'running-separator-color', 'running-separator-opacity']);
    masterAppSepReset.valign = Gtk.Align.CENTER;
    appSepExp.add_suffix(masterAppSepReset);
    sepGroup.add(appSepExp);

    addSwitchRow(appSepExp, settings, 'show-app-separator', 'Enable App Separator', 'Show a divider between pinned and unpinned apps', 'view-more-horizontal-symbolic', createResetBtn);

    addCustomSpinRow(appSepExp, settings, 'running-separator-width', 'Thickness', 'Width in pixels', 'format-text-strikethrough-symbolic', {
        lower: 0,
        upper: 10,
        step_increment: 1
    }, createResetBtn);
    addCustomSpinRow(appSepExp, settings, 'running-separator-height', 'Height / Length', 'Percentage of dock size (10-100)', 'format-justify-fill-symbolic', {
        lower: 10,
        upper: 100,
        step_increment: 5
    }, createResetBtn);
    addColorRow(prefs, appSepExp, settings, 'running-separator-color', 'Color', 'preferences-desktop-appearance-symbolic');
    addCustomSpinRow(appSepExp, settings, 'running-separator-opacity', 'Opacity', '0 = Invisible, 100 = Solid', 'view-reveal-symbolic', {
        lower: 0,
        upper: 100,
        step_increment: 5
    }, createResetBtn);

    const badgesGroup = new Adw.PreferencesGroup({
        title: 'App Notifications',
        description: 'Unread message counters'
    });
    page.add(badgesGroup);
    addSwitchRow(badgesGroup, settings, 'show-notification-badges', 'Show Notification Badges', 'Display unread message counts on app icons', 'user-available-symbolic');

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

    addSwitchRow(indExpander, settings, 'show-running-indicators', 'Show Indicators', 'Display active marks under icons', 'media-record-symbolic', createResetBtn);
    addComboRow(prefs, indExpander, settings, 'indicator-style', 'Indicator Style', 'Shape of the indicator', 'view-list-symbolic', [{
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
    indColorRow = addColorRow(prefs, indExpander, settings, 'indicator-color', 'Indicator Color', 'preferences-desktop-appearance-symbolic');

    addCustomSpinRow(indExpander, settings, 'indicator-size', 'Indicator Size', 'Limit: 2px to 12px', 'zoom-in-symbolic', {
        lower: 2,
        upper: 12,
        step_increment: 1
    }, createResetBtn);
    addCustomSpinRow(indExpander, settings, 'indicator-spacing', 'Indicator Spacing', 'Gap between icon and indicator', 'format-indent-more-symbolic', {
        lower: 0,
        upper: 20,
        step_increment: 1
    }, createResetBtn);
    addSwitchRow(indExpander, settings, 'indicator-glow', 'Indicator Glow', 'Add a shining shadow effect', 'display-brightness-symbolic', null);

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

    prefs._settingsSignals.push(settings.connect('changed::dock-theme', syncThemeVisibility));
    prefs._settingsSignals.push(settings.connect('changed::use-gradient', syncThemeVisibility));
    syncThemeVisibility();
}