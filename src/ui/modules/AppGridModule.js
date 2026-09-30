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
* along with this program. If not, see .
*/


import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { applyIconFilter } from '../DragDrop.js';
import { Settings } from '../../core/SettingsManager.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { animateIconClick } from '../effects/IconClickEffect.js';
import { getHoverBgRadius } from '../dock/DockButtonBase.js';


const DEFAULT_HOVER_DURATION_MS = 200;
const OVERVIEW_APPS_EASE_DURATION_MS = 250;

export function buildAppGridModule(dockUI, iconSize, actualMaxZoom) {
    const hoverZoom = Settings.hoverZoom;

    const customIconPath = Settings.customGridIcon;
    const hasCustomIcon = customIconPath && GLib.file_test(customIconPath, GLib.FileTest.EXISTS);
    const useOldIcon = Settings.useOldGridIcon;

    const moduleFile = Gio.File.new_for_uri(import.meta.url);
    const rootDir = moduleFile.get_parent().get_parent().get_parent().get_parent();
    const logoPath = rootDir.get_child('icons').get_child('logo.svg').get_path();
    const hasLogo = GLib.file_test(logoPath, GLib.FileTest.EXISTS);

    let scaleMultiplier;
    if (hasCustomIcon) {
        scaleMultiplier = Settings.customGridIconScale / 100.0;
    } else if (useOldIcon || !hasLogo) {
        scaleMultiplier = 1.25;
    } else {
        scaleMultiplier = 0.90;
    }

    const gridIconSize = Math.floor(iconSize * scaleMultiplier);
    const gridRenderSize = Math.ceil(gridIconSize * actualMaxZoom);
    const gridColor = Settings.gridIconColor || '#ffffff';

    let gridIcon;
    if (hasCustomIcon) {
        const gfile = Gio.File.new_for_path(customIconPath);
        gridIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: gfile }),
            icon_size: 256,
            style_class: 'dock-grid-icon'
        });
    } else if (useOldIcon || !hasLogo) {
        gridIcon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: gridRenderSize,
            style_class: 'dock-grid-icon'
        });
    } else {
        const gfile = Gio.File.new_for_path(logoPath);
        gridIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: gfile }),
            icon_size: gridRenderSize,
            style_class: 'dock-grid-icon'
        });
    }

    if (useOldIcon || (!hasCustomIcon && !hasLogo)) {
        gridIcon.set_style('color: ' + gridColor + ';');
    }

    gridIcon.set_pivot_point(0.5, 0.5);
    gridIcon.set_size(gridIconSize, gridIconSize);

    const gridIconBin = new St.Bin({
        child: gridIcon,
        width: iconSize,
        height: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER
    });
    gridIconBin.set_pivot_point(0.5, 0.5);

    const gridIndProps = dockUI._getIndicatorProps();
    gridIconBin.translation_x = gridIndProps.iconTx;
    gridIconBin.translation_y = gridIndProps.iconTy;
    gridIconBin._baseTx = gridIndProps.iconTx;
    gridIconBin._baseTy = gridIndProps.iconTy;

    const appBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true
    });
    appBox.set_pivot_point(0.5, 0.5);

    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const compactExpanded = iconSize + 4;
    const compactCollapsed = iconSize;
    const tightCross = iconSize + 4;
    const radius = getHoverBgRadius(iconSize);

    const targetW = isVerticalDock ? tightCross : compactCollapsed;
    const targetH = isVerticalDock ? compactCollapsed : tightCross;

    const hoverBg = new St.Widget({
        style_class: 'dock-hover-bg',
        reactive: false,
        clip_to_allocation: false
    });

    hoverBg._isHoverBg = true;
    hoverBg.set_pivot_point(0.5, 0.5);
    hoverBg.set_size(targetW, targetH);
    hoverBg.set_x_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_y_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_style(
        'background-color: transparent; ' +
        'border-radius: ' + radius + 'px; ' +
        'transition-duration: 150ms;'
    );

    appBox.insert_child_at_index(hoverBg, 0);
    appBox.add_child(gridIconBin);

    const gridModule = new St.Bin({
        child: appBox,
        style_class: 'dock-app-button',
        reactive: true,
        track_hover: true,
        can_focus: false,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL
    });

    gridModule.set_pivot_point(0.5, 0.5);
    gridModule._hasRunningIndicator = false;
    gridModule.set_style('background-color: transparent;');

    gridModule.connectObject('notify::hover', () => {
        if (Settings.hoverZoom) return;

        const dim = gridModule.hover ? compactExpanded : compactCollapsed;

        if (isVerticalDock) {
            hoverBg.ease({ height: dim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            hoverBg.ease({ width: dim, duration: DEFAULT_HOVER_DURATION_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }

        const curRadius = getHoverBgRadius(iconSize);
        if (gridModule.hover) {
            const rawOp = Settings.tooltipOpacity;
            const boxOp = (rawOp !== undefined && rawOp !== null && !Number.isNaN(rawOp)) ? rawOp : 25;
            const alpha = Math.max(0.18, (boxOp / 100.0) * 0.75);
            hoverBg.set_style(
                'background-color: rgba(255, 255, 255, ' + alpha + '); ' +
                'border-radius: ' + curRadius + 'px; ' +
                'transition-duration: 150ms;'
            );
        } else {
            hoverBg.set_style(
                'background-color: transparent; ' +
                'border-radius: ' + curRadius + 'px; ' +
                'transition-duration: 150ms;'
            );
        }
    }, gridModule);

    if (hoverZoom) applyIconFilter(gridModule);

    const resetGridHoverBg = () => {
        const curRadius = getHoverBgRadius(iconSize);
        hoverBg.remove_all_transitions();
        if (isVerticalDock) {
            hoverBg.set_height(compactCollapsed);
        } else {
            hoverBg.set_width(compactCollapsed);
        }
        hoverBg.set_style(
            'background-color: transparent; ' +
            'border-radius: ' + curRadius + 'px; ' +
            'transition-duration: 0ms;'
        );
    };

    gridModule._activateCallback = (buttonNum, state = 0) => {
        resetGridHoverBg();

        if (buttonNum === 1) {
            animateIconClick(gridIconBin, Settings.clickEffect);

            if (Settings.independentDock) {
                if (dockUI.appGridUI) {
                    dockUI.appGridUI.toggle(dockUI.dockPosition);
                }
                if (dockUI.actor) dockUI.actor._suppressZoom = true;
                return;
            }

            const controls = Main.overview._overview && Main.overview._overview._controls;

            if (!Main.overview.visible) {
                Main.overview.showApps();
            } else if (controls && controls._stateAdjustment) {
                const currentState = Math.round(controls._stateAdjustment.value);
                if (currentState !== 2) {
                    if (controls._searchController && controls._searchController.reset) {
                        controls._searchController.reset();
                    }
                    controls._stateAdjustment.ease(2, {
                        duration: OVERVIEW_APPS_EASE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                } else {
                    Main.overview.hide();
                }
            } else {
                Main.overview.hide();
            }

            if (dockUI.actor) dockUI.actor._suppressZoom = true;
        } else if (buttonNum === 3) {
            const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (dockUI._activeContextMenu) {
                if (dockUI._activeContextMenu._forceDestroy) {
                    dockUI._activeContextMenu._forceDestroy();
                }
                dockUI._activeContextMenu = null;
            }
            new AppContextMenu(
                dockUI,
                gridModule._delegate.app,
                gridModule,
                isCtrl,
                dockUI.openPrefsCallback
            ).show(dockUI.dockPosition);
        }
    };

    gridModule.connectObject('button-press-event', () => {
        resetGridHoverBg();
        if (dockUI._activeContextMenu) return Clutter.EVENT_STOP;
        return Clutter.EVENT_PROPAGATE;
    }, gridModule);

    gridModule.connectObject('button-release-event', (_actor, event) => {
        resetGridHoverBg();
        if (dockUI._activeContextMenu) {
            dockUI._activeContextMenu.hide();
            return Clutter.EVENT_STOP;
        }

        const button = event.get_button();
        const state = event.get_state();

        if (button === 1) {
            if (dockUI.actor && dockUI.actor._lastIconClickTime !== undefined) {
                dockUI.actor._lastIconClickTime = Date.now();
            }
            gridModule._activateCallback(1, state);
            return Clutter.EVENT_STOP;
        } else if (button === 3) {
            gridModule._activateCallback(3, state);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }, gridModule);

    gridModule._delegate = {
        app: {
            is_module: true,
            get_id: () => 'dhruva-grid-button',
            get_name: () => _('Applications'),
            get_state: () => 0,
            get_windows: () => []
        }
    };

    return gridModule;
}