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
import cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { hexToRgba } from '../../core/Utils.js';
import { applyIconFilter } from '../DragDrop.js';
import { buildClockModule } from './ClockModule.js';
import { buildTrashModule } from './TrashModule.js';
import { buildAppGridModule } from './AppGridModule.js';
import ScrollManager from '../../core/ScrollManager.js';
import { Settings } from '../../core/SettingsManager.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import { getIndicatorProps } from '../dock/DockRenderer.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { animateIconClick } from '../effects/IconClickEffect.js';
import { buildSystemFoldersModule } from './SystemFoldersModule.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { animateMinimize, animateRestore } from '../effects/WindowEffects.js';
import { buildDesktopButtonModule, toggleDesktop } from './DesktopButtonModule.js';
import { createIndicatorBox, attachHoverBackground } from '../dock/DockButtonBase.js';


const EMOJI_TEXTURE_SIZE = 128;
const DRAG_MOVE_CANCEL_THRESHOLD = 35;
const APP_LAUNCH_RENDER_DELAYS = [300, 600, 1100];

function isWindowForFolder(w, folderPath, folderName) {
    if (!w || w.is_skip_taskbar()) return false;

    const tracker = Shell.WindowTracker.get_default();
    const app = tracker.get_window_app(w);
    const appId = app ? (app.get_id() || '').toLowerCase() : '';
    const wmClass = (w.get_wm_class() || '').toLowerCase();

    if (!appId.includes('nautilus') && !wmClass.includes('nautilus') && !wmClass.includes('files')) {
        return false;
    }

    const winTitle = (w.get_title() || '').toLowerCase().trim();
    if (!winTitle) return false;

    if (folderName && (folderName.toLowerCase().includes('trash') || folderName.toLowerCase().includes('recycle'))) {
        if (winTitle.includes('trash') || winTitle.includes('rubbish') || winTitle.includes('bin')) return true;
    }

    if (folderName) {
        const fn = folderName.toLowerCase().trim();
        if (winTitle === fn || winTitle.startsWith(`${fn} `) || winTitle.includes(fn)) return true;
    }

    if (folderPath) {
        const cleanPath = folderPath.replace(/\/+$/, '');
        const base = cleanPath.split('/').pop();
        if (base && winTitle.includes(base.toLowerCase())) return true;
    }

    return false;
}

function getCrispEmojiIcon(emojiText, renderSize) {
    const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), 'dhruva@narkagni', 'icon']);
    GLib.mkdir_with_parents(configDir, 0o755);

    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, emojiText, -1);
    const emojiFile = Gio.File.new_for_path(GLib.build_filenamev([configDir, `emoji_${hash}.png`]));

    if (!emojiFile.query_exists(null)) {
        try {
            const surface = new cairo.ImageSurface(cairo.Format.ARGB32, EMOJI_TEXTURE_SIZE, EMOJI_TEXTURE_SIZE);
            const cr = new cairo.Context(surface);

            const layout = PangoCairo.create_layout(cr);
            layout.set_text(emojiText, -1);

            const fontDesc = Pango.FontDescription.from_string('Noto Color Emoji 83px');
            layout.set_font_description(fontDesc);

            const [tw, th] = layout.get_pixel_size();
            cr.moveTo((EMOJI_TEXTURE_SIZE - tw) / 2, (EMOJI_TEXTURE_SIZE - th) / 2);
            PangoCairo.show_layout(cr, layout);

            surface.writeToPNG(emojiFile.get_path());
            cr.$dispose();
        } catch (_e) {
            return new St.Icon({
                icon_name: 'folder',
                icon_size: renderSize,
                style_class: 'dock-grid-icon'
            });
        }
    }

    return new St.Icon({
        gicon: Gio.FileIcon.new(emojiFile),
        icon_size: renderSize,
        style_class: 'dock-grid-icon'
    });
}

export function buildModules(dockUI, iconSize) {
    const systemModules = [];
    let clockModule = null;
    let gridModule = null;
    let desktopModule = null;
    const settings = dockUI.settings;
    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const hoverZoom = Settings.hoverZoom;
    const zoomFactor = Settings.hoverZoomFactor;
    const actualMaxZoom = hoverZoom ? (1.0 + (zoomFactor - 1.0) * 2.0) : 1.0;

    const toggleAppWindow = (uri, folderPath, folderName, btnActor) => {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows();
        const focusWin = global.display.get_focus_window();

        const targetWin = windows.find(w => isWindowForFolder(w, folderPath, folderName));

        if (targetWin) {
            if (targetWin === focusWin && !targetWin.minimized) {
                animateMinimize(targetWin, btnActor, dockUI.dockPosition);
            } else {
                animateRestore(targetWin, btnActor, dockUI.dockPosition);
                Main.activateWindow(targetWin);
            }
        } else {
            Gio.AppInfo.launch_default_for_uri(uri, null);

            APP_LAUNCH_RENDER_DELAYS.forEach(delay => {
                dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, delay, () => {
                    dockUI.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }
    };

    const createBtn = (iconOrName, tooltipName, clickAction, folderPath = null) => {
        const isString = typeof iconOrName === 'string';
        const isEmoji = isString && iconOrName.startsWith('emoji:');
        const isCustomFile = isString && !isEmoji && (iconOrName.startsWith('/') || iconOrName.startsWith('file://'));

        const modIconSize = (isString && iconOrName.startsWith('user-trash')) ? Math.floor(iconSize * 0.95) : iconSize;
        const renderSize = Math.ceil(modIconSize * actualMaxZoom);

        let iconActor;

        if (isEmoji) {
            const cleanEmoji = iconOrName.replace('emoji:', '');
            iconActor = getCrispEmojiIcon(cleanEmoji, renderSize);
            iconActor.set_size(modIconSize, modIconSize);
        } else if (isCustomFile) {
            const cleanPath = iconOrName.replace('file://', '');
            const gfile = Gio.File.new_for_path(cleanPath);

            if (gfile.query_exists(null)) {
                iconActor = new St.Icon({
                    gicon: Gio.FileIcon.new(gfile),
                    icon_size: renderSize,
                    style_class: 'dock-grid-icon'
                });
            } else {
                iconActor = new St.Icon({
                    icon_name: 'folder',
                    icon_size: renderSize,
                    style_class: 'dock-grid-icon'
                });
            }
            iconActor.set_size(modIconSize, modIconSize);
        } else {
            const finalName = iconOrName || 'folder';
            const gicon = isString ? Gio.ThemedIcon.new(finalName) : finalName;
            iconActor = new St.Icon({
                gicon,
                icon_size: renderSize,
                style_class: 'dock-grid-icon'
            });
            iconActor.set_size(modIconSize, modIconSize);
        }

        const iconBin = new St.Bin({
            child: iconActor,
            width: iconSize,
            height: iconSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        iconBin.set_pivot_point(0.5, 0.5);

        const colorTarget = (typeof iconOrName === 'string' && iconOrName.startsWith('/')) ? iconOrName : (iconActor || iconOrName);
        const indProps = getIndicatorProps(dockUI, colorTarget);
        iconBin.translation_x = indProps.iconTx;
        iconBin.translation_y = indProps.iconTy;
        iconBin._baseTx = indProps.iconTx;
        iconBin._baseTy = indProps.iconTy;

        const appBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: false,
            x_expand: true,
            y_expand: true
        });
        appBox._isModule = true;
        appBox.set_pivot_point(0.5, 0.5);

        const getMatchingWindows = () => {
            let wins = [];
            const nWorkspaces = global.workspace_manager.get_n_workspaces();

            for (let i = 0; i < nWorkspaces; i++) {
                wins = wins.concat(global.workspace_manager.get_workspace_by_index(i).list_windows());
            }

            const filteredWins = wins.filter(w => isWindowForFolder(w, folderPath, tooltipName));
            let finalWins = WorkspaceFilter.filterWindows(filteredWins);

            if (Settings.isolateMonitors && dockUI.monitorManager) {
                const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
                finalWins = finalWins.filter(w => w.get_monitor() === currentMonitorIndex);
            }

            return finalWins;
        };

        const dockHeightPad = Settings.dockHeight || 6;
        const pad = Math.max(dockHeightPad, 4);
        const expandedDim = iconSize + pad * 2;
        const collapsedDim = iconSize + 2;

        const activeWins = getMatchingWindows();
        const isRunning = activeWins.length > 0;

        const focusWin = global.display.get_focus_window();
        const isFocused = Array.isArray(activeWins) && activeWins.some(w => w === focusWin);

        if (isRunning && Settings.showRunningIndicators) {
            const indStyle = Settings.indicatorStyle || 'dot';
            const count = (indStyle === 'line' || indStyle === 'windows') ? 1 : (activeWins.length > 1 ? 2 : 1);

            const dotBox = createIndicatorBox(
                dockUI.dockPosition,
                isVertical,
                indProps,
                count,
                expandedDim,
                isFocused
            );

            appBox.add_child(iconBin);
            appBox.add_child(dotBox);
        } else {
            appBox.add_child(iconBin);
        }

        const isExpanded = isRunning && Settings.showRunningIndicators && !hoverZoom;
        const targetW = isVertical ? iconSize : (isExpanded ? expandedDim : collapsedDim);
        const targetH = isVertical ? (isExpanded ? expandedDim : collapsedDim) : iconSize;

        let baseBg = 'transparent';
        if (isExpanded && !hoverZoom) {
            baseBg = hexToRgba(indProps.indColor, 0.25);
        }

        const hoverBg = new St.Widget({
            reactive: false,
            style: `background-color: ${baseBg}; border-radius: 0px; transition-duration: 150ms;`
        });

        hoverBg.set_pivot_point(0.5, 0.5);
        hoverBg.scale_x = isVertical ? (iconSize + pad * 2) / iconSize : 1.0;
        hoverBg.scale_y = isVertical ? 1.0 : (iconSize + pad * 2) / iconSize;

        if (isVertical) {
            hoverBg.set_x_expand(true);
            hoverBg.set_x_align(Clutter.ActorAlign.FILL);
            hoverBg.set_y_align(Clutter.ActorAlign.CENTER);
            hoverBg.height = targetH;
        } else {
            hoverBg.set_y_expand(true);
            hoverBg.set_y_align(Clutter.ActorAlign.FILL);
            hoverBg.set_x_align(Clutter.ActorAlign.CENTER);
            hoverBg.width = targetW;
        }

        appBox.insert_child_at_index(hoverBg, 0);

        const btnStyleClass = `dock-app-button ${isVertical ? 'dock-module-btn-vertical' : 'dock-module-btn-horizontal'}`;
        const btn = new St.Bin({
            child: appBox,
            style_class: btnStyleClass,
            reactive: true,
            track_hover: true,
            can_focus: false,
            clip_to_allocation: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL
        });

        btn._isModule = true;
        btn.set_pivot_point(0.5, 0.5);
        btn._hasRunningIndicator = isExpanded;
        btn.set_style('background-color: transparent;');
        btn._baseBg = baseBg;

        btn.connectObject('notify::hover', () => {
            if (Settings.hoverZoom) return;

            const expanded = isExpanded || btn.hover;
            const currentDim = expanded ? expandedDim : collapsedDim;

            if (isVertical) {
                hoverBg.ease({ height: currentDim, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            } else {
                hoverBg.ease({ width: currentDim, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            }

            if (btn.hover) {
                if (isExpanded) {
                    hoverBg.set_style(`background-color: ${hexToRgba(indProps.indColor, 0.35)}; border-radius: 0px; transition-duration: 150ms;`);
                } else {
                    hoverBg.set_style(`background-color: rgba(255, 255, 255, 0.15); border-radius: 0px; transition-duration: 150ms;`);
                }
            } else {
                hoverBg.set_style(`background-color: ${btn._baseBg}; border-radius: 0px; transition-duration: 150ms;`);
            }
        }, btn);

        const safeId = `dhruva-module-${tooltipName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        btn._delegate = {
            app: {
                is_module: true,
                get_id: () => safeId,
                get_name: () => tooltipName,
                get_state: () => (getMatchingWindows().length > 0 ? Shell.AppState.RUNNING : 0),
                get_windows: () => getMatchingWindows(),
                get_app_info: () => null,
                can_open_new_window: () => false,
                request_quit: () => {
                    getMatchingWindows().forEach(w => {
                        if (w.delete) w.delete(global.get_current_time());
                    });
                },
                open: () => clickAction(btn)
            },
            updateRunningState: () => {
                const wins = getMatchingWindows();
                const running = wins.length > 0;
                const focusWin = global.display.get_focus_window();
                const isFocused = wins.some(w => w === focusWin);
                const currentProps = getIndicatorProps(dockUI, colorTarget);
                attachHoverBackground.updateState(btn, running, wins, currentProps, dockUI, isFocused);
            }
        };

        if (Settings.hoverZoom) applyIconFilter(btn);

        btn.connectObject('button-press-event', (_actor, event) => {
            if (dockUI._activeContextMenu) return Clutter.EVENT_STOP;
            const [px, py] = event.get_coords();
            btn._pressX = px;
            btn._pressY = py;
            return Clutter.EVENT_PROPAGATE;
        }, btn);

        btn._activateCallback = (buttonNum, state = 0) => {
            if (buttonNum === 1) {
                dockUI.actor._lastIconClickTime = Date.now();
                animateIconClick(iconBin, Settings.clickEffect);
                clickAction(btn);

                if (dockUI.actor) {
                    dockUI.actor._suppressZoom = false;
                    setMagnifierPauseState(dockUI.actor, 'app-launch', false);
                }
            } else if (buttonNum === 3) {
                const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
                if (dockUI._activeContextMenu) {
                    if (dockUI._activeContextMenu._forceDestroy) {
                        dockUI._activeContextMenu._forceDestroy();
                    }
                    dockUI._activeContextMenu = null;
                }
                new AppContextMenu(dockUI, btn._delegate.app, btn, isCtrl, dockUI.openPrefsCallback).show(dockUI.dockPosition);
            }
        };

        btn.connectObject('button-release-event', (_actor, event) => {
            if (dockUI._activeContextMenu) {
                dockUI._activeContextMenu.hide();
                return Clutter.EVENT_STOP;
            }
            const button = event.get_button();
            const state = event.get_state();
            const [rx, ry] = event.get_coords();

            if (Math.abs(rx - (btn._pressX || rx)) > DRAG_MOVE_CANCEL_THRESHOLD || Math.abs(ry - (btn._pressY || ry)) > DRAG_MOVE_CANCEL_THRESHOLD) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (button === 1) {
                if (btn._wasDragged) {
                    btn._wasDragged = false;
                    return Clutter.EVENT_STOP;
                }
                btn._activateCallback(1, state);
                return Clutter.EVENT_STOP;
            } else if (button === 3) {
                btn._activateCallback(3, state);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, btn);

        ScrollManager.setupAppScroll(btn, getMatchingWindows);

        return btn;
    };

    if (Settings.showGridButton) {
        gridModule = buildAppGridModule(dockUI, iconSize, actualMaxZoom);
    }

    if (Settings.showDesktopButton) {
        if (Settings.fullWidth) {
            desktopModule = buildDesktopButtonModule(dockUI);
        } else {
            desktopModule = createBtn('user-desktop', _('Show Desktop'), () => {
                toggleDesktop(dockUI);
            });
        }
    }

    const folders = buildSystemFoldersModule(dockUI, createBtn, toggleAppWindow);
    systemModules.push(...folders);

    if (Settings.showTrash) {
        systemModules.push(buildTrashModule(createBtn, toggleAppWindow));
    }

    clockModule = buildClockModule(dockUI);

    return {
        systemModules,
        clockModule,
        gridModule,
        desktopModule
    };
}