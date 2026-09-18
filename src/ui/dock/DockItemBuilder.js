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

import { getIndicatorProps } from './DockRenderer.js';
import FolderMenu from '../folder-menu/FolderMenu.js';
import ScrollManager from '../../core/ScrollManager.js';
import { Settings } from '../../core/SettingsManager.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import { hexToRgba, isActorAlive } from '../../core/Utils.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { animateIconClick } from '../effects/IconClickEffect.js';
import { setupDragAndDrop, applyIconFilter } from '../DragDrop.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { animateMinimize, animateRestore } from '../effects/WindowEffects.js';
import { createBaseButtonContainer, createIndicatorBox, attachHoverBackground } from './DockButtonBase.js';


const DRAG_CANCEL_DELTA_PX = 15;
const LAUNCH_PAUSE_TIMEOUT_MS = 150;

function setupCommonEvents(btn, dockUI) {
    btn.connectObject('button-press-event', (_actor, event) => {
        const [px, py] = event.get_coords();
        btn._pressX = px;
        btn._pressY = py;

        if (event.get_button() === 2) {
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }, btn);

    btn.connectObject('button-release-event', (_actor, event) => {
        const button = event.get_button();
        const state = event.get_state();

        if (dockUI._activeContextMenu) {
            dockUI._activeContextMenu.hide();
            return Clutter.EVENT_STOP;
        }

        if (Settings.lockIcons) {
            const [rx, ry] = event.get_coords();
            const dx = Math.abs(rx - (btn._pressX || rx));
            const dy = Math.abs(ry - (btn._pressY || ry));
            if (dx > DRAG_CANCEL_DELTA_PX || dy > DRAG_CANCEL_DELTA_PX) return Clutter.EVENT_STOP;
        }

        if (button === 1 || button === 2) {
            if (btn._wasDragged) {
                btn._wasDragged = false;
                return Clutter.EVENT_STOP;
            }
            if (button === 1) dockUI.actor._lastIconClickTime = Date.now();
            btn._activateCallback(button, state);
            return Clutter.EVENT_STOP;
        }

        if (button === 3) {
            btn._activateCallback(3, state);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }, btn);
}

export function createSeparator(dockUI, iconSize, isVerticalDock, type = 'module', sepId = 'dhruva-sep-default') {
    const sep = new St.Widget({ style_class: 'dock-separator' });
    sep._sepId = sepId;
    sep._isStatic = true;
    sep.opacity = 255;

    const prefix = type === 'module' ? 'separator' : 'running-separator';
    const width = dockUI.settings.get_int(`${prefix}-width`);
    const heightPercent = dockUI.settings.get_int(`${prefix}-height`);
    const colorHex = dockUI.settings.get_string(`${prefix}-color`);
    const opacity = dockUI.settings.get_int(`${prefix}-opacity`) / 100.0;
    const rgba = hexToRgba(colorHex, opacity);
    const lengthPx = Math.max(1, Math.floor(iconSize * (heightPercent / 100.0)));

    if (isVerticalDock) {
        sep.set_style(`height: ${width}px; background-color: ${rgba}; border-radius: ${width}px; margin: 4px 0;`);
        const fill = heightPercent >= 100;
        sep.set_x_align(fill ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER);
        sep.set_x_expand(fill);
        if (!fill) sep.set_width(lengthPx);
    } else {
        sep.set_style(`width: ${width}px; background-color: ${rgba}; border-radius: ${width}px; margin: 0 8px;`);
        const fill = heightPercent >= 100;
        sep.set_y_align(fill ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER);
        sep.set_y_expand(fill);
        if (!fill) sep.set_height(lengthPx);
    }
    return sep;
}

export function buildAppButton(dockUI, app, isRunning, finalActiveWindows) {
    const indProps = getIndicatorProps(dockUI, app);
    const iconSize = Settings.iconSize;
    const showIndicators = Settings.showRunningIndicators;
    const hoverZoom = Settings.hoverZoom;
    const zoomFactor = Settings.hoverZoomFactor;
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

    iconWrapper.translation_x = indProps.iconTx;
    iconWrapper.translation_y = indProps.iconTy;
    iconWrapper._baseTx = indProps.iconTx;
    iconWrapper._baseTy = indProps.iconTy;
    iconWrapper.add_child(iconBin);

    if (Settings.showNotificationBadges) {
        const count = dockUI.notificationManager.getUnreadCount(app);
        if (count > 0) {
            const badge = dockUI.notificationManager.createBadgeActor(count, iconSize);
            if (badge) iconWrapper.add_child(badge);
        }
    }

    const dockHeightPad = Settings.dockHeight || 6;
    const pad = Math.max(dockHeightPad, 4);
    const expandedDim = iconSize + pad * 2;
    const collapsedDim = iconSize + 2;
    const isIndicatorActive = isRunning && showIndicators;

    appBox.add_child(iconWrapper);

    let dotBox = null;
    if (isIndicatorActive) {
        const indStyle = Settings.indicatorStyle || 'dot';
        const count = (indStyle === 'line' || indStyle === 'windows') ? 1 : finalActiveWindows.length;
        const focusWin = global.display.get_focus_window();
        const isFocused = Array.isArray(finalActiveWindows) && finalActiveWindows.some(w => w === focusWin);

        dotBox = createIndicatorBox(dockUI.dockPosition, isVerticalDock, indProps, count, expandedDim, isFocused);
        appBox.add_child(dotBox);
    }

    const btn = createBaseButtonContainer(appBox);
    btn.opacity = 255;
    btn.set_scale(1.0, 1.0);
    btn._appBox = appBox;
    btn._iconWrapper = iconWrapper;
    btn._indicatorActor = dotBox;
    btn._hasRunningIndicator = isIndicatorActive;

    const dims = { iconSize, pad, expandedDim, collapsedDim, isVerticalDock };
    btn._dims = dims;

    attachHoverBackground(dockUI, btn, appBox, isIndicatorActive, indProps, dims);

    btn._delegate = {
        app,
        get_parent: () => (btn.get_parent ? btn.get_parent() : null),
        updateRunningState: (running, activeWindows = [], isFocused = false) => {
            const currentIndProps = getIndicatorProps(dockUI, app);
            attachHoverBackground.updateState(
                btn,
                running,
                finalActiveWindows ? activeWindows : [],
                currentIndProps,
                dockUI,
                isFocused
            );
        }
    };

    setupDragAndDrop(btn, app, dockUI);
    if (hoverZoom) applyIconFilter(btn);

    setupCommonEvents(btn, dockUI);
    ScrollManager.setupAppScroll(btn, () => app.get_windows());

    btn._activateCallback = (buttonNum, state = 0) => {
        const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const newWindowAction = Settings.newWindowAction || 'ctrl-click';

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

            dockUI.actor._launchTimeoutId = dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, LAUNCH_PAUSE_TIMEOUT_MS, () => {
                dockUI.actor._launchTimeoutId = null;
                if (!isActorAlive(dockUI.actor)) return GLib.SOURCE_REMOVE;

                const tempUnpauseTarget = {};
                global.stage.connectObject('captured-event', (_stage, event) => {
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
            animateIconClick(iconBin, Settings.clickEffect);
            return;
        }

        if (buttonNum === 1) {
            Main.overview.hide();
            let windows = app.get_windows();
            windows = WorkspaceFilter.filterWindows(windows);

            if (Settings.isolateMonitors) {
                const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
                windows = windows.filter(w => w.get_monitor() === currentMonitorIndex);
            }

            animateIconClick(iconBin, Settings.clickEffect);

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

export function buildFolderButton(dockUI, folder) {
    const iconName = folder.icon || 'folder-symbolic';
    const iconSize = Settings.iconSize;
    const showIndicators = Settings.showRunningIndicators;
    const hoverZoom = Settings.hoverZoom;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    const appBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true
    });
    appBox.set_pivot_point(0.5, 0.5);

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

    let runningAppsCount = 0;
    let firstRunningApp = null;
    let focusedAppInFolder = null;
    let isAnyFolderAppFocused = false;
    const folderRunningApps = [];
    const focusWin = global.display.get_focus_window();

    folder.apps.forEach(appId => {
        const app = dockUI.appManager.appSystem.lookup_app(appId);
        if (app && (app.get_state() === Shell.AppState.RUNNING || app.get_windows().length > 0)) {
            let isValid = true;
            const windows = app.get_windows();

            if (windows.length > 0) {
                let filtered = WorkspaceFilter.filterWindows(windows);
                if (Settings.isolateMonitors) {
                    const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
                    filtered = filtered.filter(w => w.get_monitor() === currentMonitorIndex);
                }
                if ((Settings.isolateWorkspaces || Settings.isolateMonitors) && filtered.length === 0) {
                    isValid = false;
                }
                if (filtered.some(w => w === focusWin)) {
                    isAnyFolderAppFocused = true;
                    focusedAppInFolder = app;
                }
            }

            if (isValid) {
                runningAppsCount++;
                folderRunningApps.push(app);
                if (!firstRunningApp) firstRunningApp = app;
            }
        }
    });

    const activeColorSource = isAnyFolderAppFocused
        ? (focusedAppInFolder || firstRunningApp || iconName)
        : (firstRunningApp || iconName);
    const indProps = getIndicatorProps(dockUI, activeColorSource);

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

    iconWrapper.translation_x = indProps.iconTx;
    iconWrapper.translation_y = indProps.iconTy;
    iconWrapper._baseTx = indProps.iconTx;
    iconWrapper._baseTy = indProps.iconTy;
    iconWrapper.add_child(iconBin);

    const dockHeightPad = Settings.dockHeight || 6;
    const pad = Math.max(dockHeightPad, 4);
    const expandedDim = iconSize + pad * 2;
    const collapsedDim = iconSize + 2;
    const isIndicatorActive = runningAppsCount > 0 && showIndicators;

    appBox.add_child(iconWrapper);

    let dotBox = null;
    const indStyle = Settings.indicatorStyle || 'dot';

    if (isIndicatorActive) {
        const count = (indStyle === 'line' || indStyle === 'windows') ? 1 : Math.min(runningAppsCount, 3);
        dotBox = createIndicatorBox(dockUI.dockPosition, isVerticalDock, indProps, count, expandedDim, isAnyFolderAppFocused);

        if (!isAnyFolderAppFocused && indStyle !== 'line' && indStyle !== 'windows' && folderRunningApps.length > 1) {
            const dots = dotBox.get_children();
            dots.forEach((dot, idx) => {
                const appForDot = folderRunningApps[idx] || folderRunningApps[0];
                const dotProps = getIndicatorProps(dockUI, appForDot);
                dot.set_style(dotProps.style);
            });
        }

        appBox.add_child(dotBox);
    }

    const btn = createBaseButtonContainer(appBox);
    btn.opacity = 255;
    btn.set_scale(1.0, 1.0);
    btn._appBox = appBox;
    btn._iconWrapper = iconWrapper;
    btn._indicatorActor = dotBox;
    btn._isFolder = true;
    btn._folderData = folder;

    const dims = { iconSize, pad, expandedDim, collapsedDim, isVerticalDock };
    btn._dims = dims;

    attachHoverBackground(dockUI, btn, appBox, isIndicatorActive, indProps, dims);

    btn._delegate = {
        app: null,
        isFolder: true,
        folderData: folder,
        button: btn,
        get_parent: () => (btn.get_parent ? btn.get_parent() : null),
        updateRunningState: (rApps = [], isFoc = false, focApp = null) => {
            let appsList = rApps;
            let focused = isFoc;
            let targetFocusedApp = focApp;

            if (arguments.length === 0 || !Array.isArray(rApps) || rApps.length === 0) {
                appsList = [];
                focused = false;
                const currentFocusWin = global.display.get_focus_window();
                folder.apps.forEach(appId => {
                    const a = dockUI.appManager.appSystem.lookup_app(appId);
                    if (a && (a.get_state() === Shell.AppState.RUNNING || a.get_windows().length > 0)) {
                        const wins = WorkspaceFilter.filterWindows(a.get_windows());
                        if (wins.length > 0) {
                            appsList.push(a);
                            if (wins.some(w => w === currentFocusWin)) {
                                focused = true;
                                targetFocusedApp = a;
                            }
                        }
                    }
                });
            }

            const isRunningNow = appsList.length > 0;
            const activeApp = focused ? (targetFocusedApp || appsList[0]) : (appsList[0] || null);
            const currentProps = activeApp ? getIndicatorProps(dockUI, activeApp) : getIndicatorProps(dockUI, iconName);

            attachHoverBackground.updateState(
                btn,
                isRunningNow,
                appsList,
                currentProps,
                dockUI,
                focused
            );

            if (isRunningNow && btn._indicatorActor && isActorAlive(btn._indicatorActor)) {
                const dots = btn._indicatorActor.get_children();
                const curStyle = Settings.indicatorStyle || 'dot';

                if (focused || curStyle === 'line' || curStyle === 'windows' || appsList.length <= 1) {
                    dots.forEach(dot => {
                        if (isActorAlive(dot)) dot.set_style(currentProps.style);
                    });
                } else {
                    dots.forEach((dot, idx) => {
                        if (!isActorAlive(dot)) return;
                        const dotApp = appsList[idx] || appsList[0];
                        const p = getIndicatorProps(dockUI, dotApp);
                        dot.set_style(p.style);
                    });
                }
            }
        }
    };

    setupDragAndDrop(btn, null, dockUI);
    if (hoverZoom) applyIconFilter(btn);

    btn._activateCallback = (buttonNum) => {
        if (buttonNum === 3) {
            if (dockUI._activeContextMenu && dockUI._activeContextMenu.buttonActor === btn) {
                dockUI._activeContextMenu.hide();
            } else {
                if (dockUI._activeContextMenu) dockUI._activeContextMenu.hide();
                if (dockUI._activeFolderMenu) dockUI._activeFolderMenu.hide();
                dockUI._activeContextMenu = new AppContextMenu(dockUI, null, btn);
                dockUI._activeContextMenu.show(dockUI.dockPosition);
            }
        } else if (buttonNum === 1) {
            if (dockUI._activeFolderMenu && dockUI._activeFolderMenu.folderData && dockUI._activeFolderMenu.folderData.id === folder.id) {
                dockUI._activeFolderMenu.hide();
            } else {
                if (dockUI._activeFolderMenu) dockUI._activeFolderMenu.hide();
                if (dockUI._activeContextMenu) dockUI._activeContextMenu.hide();
                dockUI._activeFolderMenu = new FolderMenu(dockUI, folder, btn);
                dockUI._activeFolderMenu.show(dockUI.dockPosition);
            }
        }
    };

    setupCommonEvents(btn, dockUI);
    return btn;
}