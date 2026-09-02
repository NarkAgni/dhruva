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


import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { hexToRgba } from '../../core/Utils.js';
import FolderMenu from '../folder-menu/FolderMenu.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { animateIconClick } from '../effects/IconClickEffect.js';
import { setupDragAndDrop, applyIconFilter } from '../DragDrop.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { animateMinimize, animateRestore } from '../effects/WindowEffects.js';
import ScrollManager from '../../core/ScrollManager.js';


export function createSeparator(dockUI, iconSize, isVerticalDock, type = 'module', sepId = 'dhruva-sep-default') {
    const sep = new St.Widget({ style_class: 'dock-separator' });
    sep._sepId = sepId;

    const wKey = type === 'module' ? 'separator-width' : 'running-separator-width';
    const hKey = type === 'module' ? 'separator-height' : 'running-separator-height';
    const cKey = type === 'module' ? 'separator-color' : 'running-separator-color';
    const oKey = type === 'module' ? 'separator-opacity' : 'running-separator-opacity';

    const width = dockUI.settings.get_int(wKey);
    const heightPercent = dockUI.settings.get_int(hKey);
    const colorHex = dockUI.settings.get_string(cKey);
    const opacity = dockUI.settings.get_int(oKey) / 100.0;
    const rgba = hexToRgba(colorHex, opacity);
    const lengthPx = Math.max(1, Math.floor(iconSize * (heightPercent / 100.0)));

    if (isVerticalDock) {
        sep.set_style(`height: ${width}px; background-color: ${rgba}; border-radius: ${width}px; margin: 4px 0;`);
        if (heightPercent >= 100) {
            sep.set_x_align(Clutter.ActorAlign.FILL);
            sep.set_x_expand(true);
        } else {
            sep.set_x_align(Clutter.ActorAlign.CENTER);
            sep.set_x_expand(false);
            sep.set_width(lengthPx);
        }
    } else {
        sep.set_style(`width: ${width}px; background-color: ${rgba}; border-radius: ${width}px; margin: 0 8px;`);
        if (heightPercent >= 100) {
            sep.set_y_align(Clutter.ActorAlign.FILL);
            sep.set_y_expand(true);
        } else {
            sep.set_y_align(Clutter.ActorAlign.CENTER);
            sep.set_y_expand(false);
            sep.set_height(lengthPx);
        }
    }
    return sep;
}

export function buildAppButton(dockUI, app, isRunning, finalActiveWindows, indPropsGlobal) {
    const iconSize = dockUI.settings.get_int('icon-size');
    const showIndicators = dockUI.settings.get_boolean('show-running-indicators');
    const hoverZoom = dockUI.settings.get_boolean('hover-zoom');
    const zoomFactor = dockUI.settings.get_double('hover-zoom-factor');
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    const appBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true
    });
    appBox.set_pivot_point(0.5, 0.5);

    const actualMaxZoom = hoverZoom ? (1.0 + (zoomFactor - 1.0) * 2.0) : 1.0;
    const renderSize = Math.ceil(iconSize * actualMaxZoom);
    const icon = app.create_icon_texture(renderSize);
    icon.set_size(iconSize, iconSize);

    const iconBin = new St.Bin({
        child: icon,
        width: iconSize,
        height: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true
    });
    iconBin.set_pivot_point(0.5, 0.5);

    const iconWrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: iconSize,
        height: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true
    });

    iconWrapper.translation_x = indPropsGlobal.iconTx;
    iconWrapper.translation_y = indPropsGlobal.iconTy;
    iconWrapper._baseTx = indPropsGlobal.iconTx;
    iconWrapper._baseTy = indPropsGlobal.iconTy;
    iconWrapper.add_child(iconBin);

    if (dockUI.settings.get_boolean('show-notification-badges')) {
        const count = dockUI.notificationManager.getUnreadCount(app);
        if (count > 0) {
            const badge = dockUI.notificationManager.createBadgeActor(count, iconSize);
            if (badge) iconWrapper.add_child(badge);
        }
    }

    const dockHeightPad = dockUI.settings.get_int('dock-height') || 6;
    const pad = Math.max(dockHeightPad, 4);
    const expandedDim = iconSize + pad * 2;
    const collapsedDim = iconSize + 2;

    if (isRunning && showIndicators) {
        let dotX = Clutter.ActorAlign.CENTER;
        let dotY = Clutter.ActorAlign.CENTER;
        if (dockUI.dockPosition === 'BOTTOM') dotY = Clutter.ActorAlign.END;
        else if (dockUI.dockPosition === 'TOP') dotY = Clutter.ActorAlign.START;
        else if (dockUI.dockPosition === 'LEFT') dotX = Clutter.ActorAlign.START;
        else if (dockUI.dockPosition === 'RIGHT') dotX = Clutter.ActorAlign.END;

        const indStyle = dockUI.settings.get_string('indicator-style') || 'dot';
        const dotSize = isVerticalDock ? indPropsGlobal.dh : indPropsGlobal.dw;
        const maxDots = indStyle === 'line' ? 1 : Math.max(1, Math.floor((expandedDim + 4) / (dotSize + 4)));
        const numDots = indStyle === 'line' ? 1 : Math.max(1, Math.min(finalActiveWindows.length, maxDots));

        const dotBox = new St.BoxLayout({
            x_align: dotX,
            y_align: dotY,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: false
        });
        dotBox.set_vertical(isVerticalDock);
        dotBox._isIndicator = true;
        dotBox._baseTx = indPropsGlobal.tx;
        dotBox._baseTy = indPropsGlobal.ty;
        dotBox.translation_x = indPropsGlobal.tx;
        dotBox.translation_y = indPropsGlobal.ty;
        dotBox.set_style('spacing: 4px;');

        for (let i = 0; i < numDots; i++) {
            const dot = new St.Widget();
            dot.set_size(indPropsGlobal.dw, indPropsGlobal.dh);
            dot.set_style(indPropsGlobal.style);
            dotBox.add_child(dot);
        }

        appBox.add_child(iconWrapper);
        appBox.add_child(dotBox);
    } else {
        appBox.add_child(iconWrapper);
    }

    const btn = new St.Bin({
        child: appBox,
        style_class: 'dock-app-button',
        reactive: true,
        track_hover: true,
        can_focus: false,
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL
    });

    btn.set_pivot_point(0.5, 0.5);
    btn._hasRunningIndicator = isRunning && showIndicators;
    btn._delegate = { app };

    const boxOp = dockUI.settings.get_int('tooltip-opacity');
    const baseAlpha = Math.max(0.02, boxOp / 100.0); 
    const hoverAlpha = Math.min(1.0, baseAlpha + 0.15);

    let baseBg = 'transparent';
    if (isRunning && showIndicators && !hoverZoom) {
        baseBg = hexToRgba(indPropsGlobal.indColor, baseAlpha);
    }

    const isExpanded = (isRunning && showIndicators) && !hoverZoom;
    const targetW = isVerticalDock ? iconSize : (isExpanded ? expandedDim : collapsedDim);
    const targetH = isVerticalDock ? (isExpanded ? expandedDim : collapsedDim) : iconSize;

    const hoverBg = new St.Widget({
        reactive: false,
        style: `background-color: ${baseBg}; border-radius: 0px; transition-duration: 150ms;`,
        x_expand: true,
        y_expand: true
    });
    
    hoverBg.set_pivot_point(0.5, 0.5);
    hoverBg.scale_x = isVerticalDock ? (iconSize + pad * 2) / iconSize : 1.0;
    hoverBg.scale_y = isVerticalDock ? 1.0 : (iconSize + pad * 2) / iconSize;
    
    hoverBg.set_size(targetW, targetH);
    hoverBg.set_x_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_y_align(Clutter.ActorAlign.CENTER);

    appBox.insert_child_at_index(hoverBg, 0);

    btn.set_style('background-color: transparent;');
    btn._baseBg = baseBg;

    btn.connectObject('notify::hover', () => {
        if (btn.hover) dockUI._hoveredAppButton = btn;
        else if (dockUI._hoveredAppButton === btn) dockUI._hoveredAppButton = null;

        if (dockUI.settings.get_boolean('hover-zoom')) return;

        const expanded = (isRunning && showIndicators) || btn.hover;
        const currentDim = expanded ? expandedDim : collapsedDim;

        if (isVerticalDock) {
            hoverBg.ease({ height: currentDim, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            hoverBg.ease({ width: currentDim, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }

        if (btn.hover) {
            if (isRunning && showIndicators) {
                hoverBg.set_style(`background-color: ${hexToRgba(indPropsGlobal.indColor, hoverAlpha)}; border-radius: 0px; transition-duration: 150ms;`);
            } else {
                hoverBg.set_style(`background-color: rgba(255, 255, 255, ${Math.max(0.05, baseAlpha * 0.4)}); border-radius: 0px; transition-duration: 150ms;`);
            }
        } else {
            hoverBg.set_style(`background-color: ${btn._baseBg}; border-radius: 0px; transition-duration: 150ms;`);
        }
    }, btn);

    setupDragAndDrop(btn, app, dockUI);
    if (hoverZoom) applyIconFilter(btn);

    btn.connectObject('button-release-event', (_actor, event) => {
        const button = event.get_button();
        const state = event.get_state();

        if (dockUI._activeContextMenu) {
            dockUI._activeContextMenu.hide();
            return Clutter.EVENT_STOP;
        }

        if (dockUI.settings.get_boolean('lock-icons')) {
            const [rx, ry] = event.get_coords();
            const dx = Math.abs(rx - (btn._pressX || rx));
            const dy = Math.abs(ry - (btn._pressY || ry));
            if (dx > 15 || dy > 15) return Clutter.EVENT_STOP;
        }

        if (button === 1) {
            if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
            dockUI.actor._lastIconClickTime = Date.now();
            btn._activateCallback(1, state);
            return Clutter.EVENT_STOP;
        }
        if (button === 3) {
            btn._activateCallback(3, state);
            return Clutter.EVENT_STOP;
        }
        if (button === 2) {
            if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
            btn._activateCallback(2, state);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }, btn);

    ScrollManager.setupAppScroll(btn, () => app.get_windows(), dockUI.settings);

    btn._activateCallback = (buttonNum, state = 0) => {
        const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const newWindowAction = dockUI.settings.get_string('new-window-action') || 'ctrl-click';

        const triggerNewWindow = 
            (newWindowAction === 'ctrl-click' && buttonNum === 1 && isCtrl) ||
            (newWindowAction === 'middle-click' && buttonNum === 2) ||
            (newWindowAction === 'both' && ((buttonNum === 1 && isCtrl) || buttonNum === 2));

        const shouldPauseMagnifier = (buttonNum === 1) || (buttonNum === 2 && (newWindowAction === 'middle-click' || newWindowAction === 'both'));

        if (shouldPauseMagnifier) {
            setMagnifierPauseState(dockUI.actor, 'app-launch', true);

            if (dockUI.actor._launchTimeoutId) {
                dockUI.registry.remove(dockUI.actor._launchTimeoutId);
                dockUI.actor._launchTimeoutId = null;
            }

            dockUI.actor._launchTimeoutId = dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
                dockUI.actor._launchTimeoutId = null;
                if (!dockUI.isActorAlive(dockUI.actor)) return GLib.SOURCE_REMOVE;
                
                const tempUnpauseTarget = {}; 
                global.stage.connectObject('captured-event', (stage, event) => {
                    if (event.type() === Clutter.EventType.MOTION) {
                        setMagnifierPauseState(dockUI.actor, 'app-launch', false);
                        global.stage.disconnectObject(tempUnpauseTarget); 
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, tempUnpauseTarget);

                return GLib.SOURCE_REMOVE;
            });
        }

        if (triggerNewWindow) {
            Main.overview.hide();
            const appState = app.get_state();
            
            if (appState === Shell.AppState.RUNNING && app.can_open_new_window && app.can_open_new_window()) {
                app.open_new_window(-1);
            } else {
                app.activate();
            }

            dockUI._scheduleCursorResetBurst();
            animateIconClick(iconBin, dockUI.settings.get_string('click-effect'));
            return;
        }

        if (buttonNum === 1) {
            Main.overview.hide();
            let windows = app.get_windows();
            windows = WorkspaceFilter.filterWindows(windows, dockUI.settings);
            
            if (dockUI.settings.get_boolean('isolate-monitors')) {
                const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
                windows = windows.filter(w => w.get_monitor() === currentMonitorIndex);
            }

            animateIconClick(iconBin, dockUI.settings.get_string('click-effect'));

            const focusWin = global.display.get_focus_window();
            const activeWin = windows.find(w => w === focusWin);
            const firstUnminimized = windows.find(w => !w.minimized);

            if (activeWin && !activeWin.minimized) {
                animateMinimize(activeWin, btn, dockUI.dockPosition);
            } else if (firstUnminimized) {
                animateRestore(firstUnminimized, btn, dockUI.dockPosition);
            } else if (windows[0]) {
                animateRestore(windows[0], btn, dockUI.dockPosition);
            } else {
                if (app.get_state() === Shell.AppState.RUNNING && app.can_open_new_window && app.can_open_new_window()) {
                    app.open_new_window(-1);
                } else {
                    app.activate();
                }

                dockUI._scheduleCursorResetBurst();

                if (!dockUI._pendingLaunches) dockUI._pendingLaunches = [];
                dockUI._pendingLaunches.push({
                    appId: app.get_id(),
                    btn,
                    iconRect: dockUI._captureActorRect(btn),
                    createdAt: Date.now(),
                });
            }
        } else if (buttonNum === 3) {
            new AppContextMenu(dockUI, app, btn, isCtrl, dockUI.openPrefsCallback).show(dockUI.dockPosition);
        }
    };

    return btn;
}

export function buildFolderButton(dockUI, folder, indPropsGlobal) {
    const iconSize = dockUI.settings.get_int('icon-size');
    const showIndicators = dockUI.settings.get_boolean('show-running-indicators');
    const hoverZoom = dockUI.settings.get_boolean('hover-zoom');
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    const appBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true
    });
    appBox.set_pivot_point(0.5, 0.5);

    const iconName = folder.icon || 'folder-symbolic';
    const isEmoji = iconName.startsWith('emoji:');
    const isCustomFile = !isEmoji && (iconName.startsWith('/') || iconName.startsWith('file://'));

    let folderIcon;

    if (isEmoji) {
        const actualEmoji = iconName.replace('emoji:', '');
        const emojiFontSize = Math.max(18, Math.floor(iconSize * 0.76));
        const emojiLabel = new St.Label({
            text: actualEmoji,
            style: `font-size: ${emojiFontSize}px; padding: 0; margin: 0; text-align: center;`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: false
        });

        if (emojiLabel.clutter_text) {
            emojiLabel.clutter_text.set_font_name(`Noto Color Emoji ${emojiFontSize}`);
            emojiLabel.clutter_text.ellipsize = 0;
            emojiLabel.clutter_text.line_wrap = false;
            emojiLabel.clutter_text.selectable = false;
            emojiLabel.clutter_text.reactive = false;
            emojiLabel.clutter_text.cursor_visible = false;
        }

        folderIcon = new St.Bin({
            child: emojiLabel,
            width: iconSize,
            height: iconSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
            reactive: false
        });
    } else {
        const baseRes = isCustomFile ? 256 : iconSize;
        const folderIconParams = { icon_size: baseRes };

        if (isCustomFile) {
            const iconFile = Gio.File.new_for_path(iconName.replace('file://', ''));
            if (iconFile.query_exists(null)) {
                folderIconParams.gicon = new Gio.FileIcon({ file: iconFile });
            } else {
                folderIconParams.icon_name = 'folder-symbolic';
            }
        } else {
            folderIconParams.icon_name = iconName;
        }

        folderIcon = new St.Icon(folderIconParams);
        folderIcon.reactive = false;

        const applySmoothFilter = () => {
            if (folderIcon.set_content_scaling_filters) folderIcon.set_content_scaling_filters(2, 2);
            const content = folderIcon.get_content();
            if (content && content.set_min_filter) {
                content.set_min_filter(2);
                content.set_mag_filter(2);
            }
        };
        folderIcon.connectObject('notify::content', applySmoothFilter, folderIcon);
        applySmoothFilter();
    }

    const iconBin = new St.Bin({
        child: folderIcon,
        width: iconSize,
        height: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        reactive: false
    });
    iconBin.set_pivot_point(0.5, 0.5);

    const iconWrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: iconSize,
        height: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true,
        reactive: false
    });

    iconWrapper.translation_x = indPropsGlobal.iconTx;
    iconWrapper.translation_y = indPropsGlobal.iconTy;
    iconWrapper._baseTx = indPropsGlobal.iconTx;
    iconWrapper._baseTy = indPropsGlobal.iconTy;
    iconWrapper.add_child(iconBin);

    let runningAppsCount = 0;
    folder.apps.forEach(appId => {
        const app = dockUI.appManager.appSystem.lookup_app(appId);
        if (app && (app.get_state() === Shell.AppState.RUNNING || app.get_windows().length > 0)) {
            let isValid = true;
            let windows = app.get_windows();
            
            if (windows.length > 0) {
                let filtered = WorkspaceFilter.filterWindows(windows, dockUI.settings);
                if (dockUI.settings.get_boolean('isolate-monitors')) {
                    const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
                    filtered = filtered.filter(w => w.get_monitor() === currentMonitorIndex);
                }
                if ((dockUI.settings.get_boolean('isolate-workspaces') || dockUI.settings.get_boolean('isolate-monitors')) && filtered.length === 0) {
                    isValid = false;
                }
            }
            
            if (isValid) {
                runningAppsCount++;
            }
        }
    });

    const dockHeightPad = dockUI.settings.get_int('dock-height') || 6;
    const pad = Math.max(dockHeightPad, 4);
    const expandedDim = iconSize + pad * 2; 
    const collapsedDim = iconSize + 2;

    if (runningAppsCount > 0 && showIndicators) {
        let dotX = Clutter.ActorAlign.CENTER;
        let dotY = Clutter.ActorAlign.CENTER;
        if (dockUI.dockPosition === 'BOTTOM') dotY = Clutter.ActorAlign.END;
        else if (dockUI.dockPosition === 'TOP') dotY = Clutter.ActorAlign.START;
        else if (dockUI.dockPosition === 'LEFT') dotX = Clutter.ActorAlign.START;
        else if (dockUI.dockPosition === 'RIGHT') dotX = Clutter.ActorAlign.END;

        const indStyle = dockUI.settings.get_string('indicator-style') || 'dot';
        const dotSize = isVerticalDock ? indPropsGlobal.dh : indPropsGlobal.dw;
        const maxDots = indStyle === 'line' ? 1 : Math.max(1, Math.floor((expandedDim + 4) / (dotSize + 4)));
        const numDots = indStyle === 'line' ? 1 : Math.max(1, Math.min(runningAppsCount, maxDots));

        const dotBox = new St.BoxLayout({
            x_align: dotX,
            y_align: dotY,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: false,
            reactive: false
        });
        
        dotBox.set_vertical(isVerticalDock);
        dotBox._isIndicator = true;
        dotBox._baseTx = indPropsGlobal.tx;
        dotBox._baseTy = indPropsGlobal.ty;
        dotBox.translation_x = indPropsGlobal.tx;
        dotBox.translation_y = indPropsGlobal.ty;
        dotBox.set_style('spacing: 4px;');

        for (let i = 0; i < numDots; i++) {
            const dot = new St.Widget({
                reactive: false
            });
            dot.set_size(indPropsGlobal.dw, indPropsGlobal.dh);
            dot.set_style(indPropsGlobal.style);
            dotBox.add_child(dot);
        }

        appBox.add_child(iconWrapper);
        appBox.add_child(dotBox);
    } else {
        appBox.add_child(iconWrapper);
    }

    const btn = new St.Bin({
        child: appBox,
        style_class: 'dock-app-button',
        reactive: true,
        track_hover: true,
        can_focus: false,
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL, 
        y_align: Clutter.ActorAlign.FILL
    });

    btn.set_pivot_point(0.5, 0.5);
    btn._isFolder = true;
    btn._folderData = folder;

    const boxOp = dockUI.settings.get_int('tooltip-opacity');
    const baseAlpha = Math.max(0.02, boxOp / 100.0); 
    const hoverAlpha = Math.min(1.0, baseAlpha + 0.15);

    let baseBg = 'transparent';
    if (runningAppsCount > 0 && showIndicators && !hoverZoom) {
        baseBg = hexToRgba(indPropsGlobal.indColor, baseAlpha);
    }

    const isExpanded = (runningAppsCount > 0 && showIndicators) && !hoverZoom;

    const targetW = isVerticalDock ? iconSize : (isExpanded ? expandedDim : collapsedDim);
    const targetH = isVerticalDock ? (isExpanded ? expandedDim : collapsedDim) : iconSize;

    const hoverBg = new St.Widget({
        reactive: false,
        style: `background-color: ${baseBg}; border-radius: 0px; transition-duration: 150ms;`,
        x_expand: true,
        y_expand: true
    });
    
    hoverBg.set_pivot_point(0.5, 0.5);
    hoverBg.scale_x = isVerticalDock ? (iconSize + pad * 2) / iconSize : 1.0;
    hoverBg.scale_y = isVerticalDock ? 1.0 : (iconSize + pad * 2) / iconSize;
    
    hoverBg.set_size(targetW, targetH);
    hoverBg.set_x_align(Clutter.ActorAlign.CENTER);
    hoverBg.set_y_align(Clutter.ActorAlign.CENTER);

    appBox.insert_child_at_index(hoverBg, 0);

    btn.set_style('background-color: transparent;');
    btn._baseBg = baseBg;

    btn.connectObject('notify::hover', () => {
        if (dockUI.settings.get_boolean('hover-zoom')) return;

        const expanded = (runningAppsCount > 0 && showIndicators) || btn.hover;
        const currentDim = expanded ? expandedDim : collapsedDim;

        if (isVerticalDock) {
            hoverBg.ease({ height: currentDim, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        } else {
            hoverBg.ease({ width: currentDim, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }

        if (btn.hover) {
            if (runningAppsCount > 0 && showIndicators) {
                hoverBg.set_style(`background-color: ${hexToRgba(indPropsGlobal.indColor, hoverAlpha)}; border-radius: 0px; transition-duration: 150ms;`);
            } else {
                hoverBg.set_style(`background-color: rgba(255, 255, 255, ${Math.max(0.05, baseAlpha * 0.4)}); border-radius: 0px; transition-duration: 150ms;`);
            }
        } else {
            hoverBg.set_style(`background-color: ${btn._baseBg}; border-radius: 0px; transition-duration: 150ms;`);
        }
    }, btn);

    setupDragAndDrop(btn, null, dockUI);
    if (hoverZoom) applyIconFilter(btn);

    btn.connectObject('button-press-event', (_actor, event) => {
        if (dockUI._activeContextMenu && event.get_button() !== 3) return Clutter.EVENT_STOP;
        
        const button = event.get_button();
        if (button === 1) dockUI.actor._lastIconClickTime = Date.now();
        
        const [px, py] = event.get_coords();
        btn._pressX = px;
        btn._pressY = py;

        if (button === 2) return Clutter.EVENT_STOP; 

        return Clutter.EVENT_PROPAGATE;
    }, btn);

    btn._activateCallback = (buttonNum) => {
        if (buttonNum === 3) {
            if (dockUI._activeContextMenu && dockUI._activeContextMenu.buttonActor === btn) dockUI._activeContextMenu.hide();
            else {
                if (dockUI._activeContextMenu) dockUI._activeContextMenu.hide();
                dockUI._activeContextMenu = new AppContextMenu(dockUI, null, btn);
                dockUI._activeContextMenu.show(dockUI.dockPosition);
            }
        } else if (buttonNum === 1) {
            if (dockUI._activeFolderMenu && dockUI._activeFolderMenu.folderData.id === folder.id) dockUI._activeFolderMenu.hide();
            else {
                if (dockUI._activeFolderMenu) dockUI._activeFolderMenu.hide();
                if (dockUI._activeContextMenu) dockUI._activeContextMenu.hide();
                dockUI._activeFolderMenu = new FolderMenu(dockUI, folder, btn);
                dockUI._activeFolderMenu.show(dockUI.dockPosition);
            }
        }
    };

    btn.connectObject('button-release-event', (_actor, event) => {
        const button = event.get_button();
        const state = event.get_state();
        
        if (dockUI.settings.get_boolean('lock-icons')) {
            const [rx, ry] = event.get_coords();
            const dx = Math.abs(rx - (btn._pressX || rx));
            const dy = Math.abs(ry - (btn._pressY || ry));
            if (dx > 15 || dy > 15) return Clutter.EVENT_STOP;
        }

        if (button === 1) {
            if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
            dockUI.actor._lastIconClickTime = Date.now();
            btn._activateCallback(1, state);
            return Clutter.EVENT_STOP;
        }

        if (button === 3) {
            btn._activateCallback(3, state);
            return Clutter.EVENT_STOP;
        }

        if (button === 2) {
            if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
            btn._activateCallback(2, state);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }, btn);

    return btn;
}