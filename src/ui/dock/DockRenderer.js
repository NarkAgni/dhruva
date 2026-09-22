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


import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

import { MusicPill } from '../modules/MusicPill.js';
import { updateLayout } from './DockLayoutEngine.js';
import { Settings } from '../../core/SettingsManager.js';
import { buildModules } from '../modules/DockModules.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import { applyDynamicStyles } from './DockThemeResolver.js';
import { attachHoverBackground } from './DockButtonBase.js';
import { setupMagnification } from '../magnifier/Magnifier.js';
import { applyRealtimeFrame } from '../magnifier/MagnifierFrameEngine.js';
import { isPointerWithinDockBounds } from '../magnifier/MagnifierMath.js';
import { createSeparator, buildAppButton, buildFolderButton } from './DockItemBuilder.js';
import { resetMagnification, teardownMagnification } from '../magnifier/MagnifierReset.js';
import { isActorAlive, markActorDisposed, extractIconDominantColor } from '../../core/Utils.js';


const CLICK_THROTTLE_MS = 350;
const POST_CLICK_DELAY_MS = 860;
const ENTRY_DURATION_MS = 280;
const EXIT_DURATION_MS = 240;

export function getIndicatorProps(dockUI, appOrIcon = null) {
    const indStyle = Settings.indicatorStyle || 'dot';
    const indSize = Settings.indicatorSize || 4;
    const indGlow = Settings.indicatorGlow;
    const isVert = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const iconSize = Settings.iconSize || 48;
    const hoverZoom = Settings.hoverZoom;

    const currentTheme = Settings.dockTheme || 'default';
    const colorMode = Settings.indicatorColorMode || 'dominant';
    const fallbackColor = Settings.indicatorColor || '#ffffff';

    let indColor = fallbackColor;

    if (currentTheme === 'chameleon' && dockUI._chameleonAccent) {
        indColor = dockUI._chameleonAccent;
    } else if (colorMode === 'dominant' && appOrIcon) {
        indColor = extractIconDominantColor(appOrIcon, fallbackColor);
    }

    let dw = indSize;
    let dh = indSize;
    let br = '100px';

    const heightPad = Settings.dockHeight || 6;
    const safeHeightPad = Math.max(heightPad, 4);

    if (indStyle === 'square') {
        br = '2px';
    } else if (indStyle === 'dash' || indStyle === 'line' || indStyle === 'windows') {
        const squareSize = hoverZoom ? iconSize : (iconSize + safeHeightPad * 2);
        let len = indStyle === 'line' ? squareSize : Math.max(12, indSize * 2.5);
        if (indStyle === 'windows') {
            len = Math.max(12, Math.floor(indSize * 2.0));
            br = '4px';
        } else if (indStyle === 'dash' || indStyle === 'line') {
            br = '0px';
        }
        const thick = Math.max(2, Math.floor(indSize / (indStyle === 'line' ? 1.5 : 1.2)));
        dw = isVert ? thick : len;
        dh = isVert ? len : thick;
    }

    const edgeMargin = 4;
    const offset = Math.max(1, safeHeightPad - edgeMargin);

    let tx = 0;
    let ty = 0;
    if (dockUI.dockPosition === 'BOTTOM') ty = offset;
    else if (dockUI.dockPosition === 'TOP') ty = -offset;
    else if (dockUI.dockPosition === 'LEFT') tx = -offset;
    else if (dockUI.dockPosition === 'RIGHT') tx = offset;

    const shadowStr = indGlow ? `box-shadow: 0px 0px 8px ${indColor}CC;` : '';
    const style = `width: ${dw}px; height: ${dh}px; background-color: ${indColor}; border-radius: ${br}; ${shadowStr}`;

    return { dw, dh, style, tx, ty, iconTx: 0, iconTy: 0, indColor };
}

export function extractActorId(c) {
    if (!c) return null;
    if (c._entityId) return c._entityId;
    if (c._delegate && c._delegate.app && c._delegate.app.get_id) return c._delegate.app.get_id();
    if (c._delegate && c._delegate.isFolder && c._delegate.folderData) return `folder:${c._delegate.folderData.id}`;
    if (c._sepId) return c._sepId;
    if (c.has_style_class_name && c.has_style_class_name('dock-separator')) return c._sepId || 'dhruva-sep-default';
    if (c.has_style_class_name && c.has_style_class_name('clock-module')) return 'dhruva-clock';

    const sClass = c.get_style_class_name ? c.get_style_class_name() : (c.style_class || '');
    if (sClass.includes('dock-grid-button') || sClass.includes('grid-button') || c._isGridBtn) return 'dhruva-grid-button';

    const child = c.get_child ? c.get_child() : null;
    if (child) {
        const childClass = child.get_style_class_name ? child.get_style_class_name() : (child.style_class || '');
        if (childClass.includes('dock-grid-icon') || childClass.includes('grid-button')) return 'dhruva-grid-button';
    }

    if (sClass.includes('desktop-module') || c._isDesktopBtn) return 'dhruva-desktop-module';
    if (sClass.includes('dhruva-music-pill') || c._isMusicPill) return 'dhruva-music-pill';
    if (c._modType) return `dhruva-sys-${c._modType}`;

    return null;
}

export function _computeDesiredState(dockUI) {
    const isFullWidth = Settings.fullWidth;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const showClock = Settings.showClock && !dockUI._isOverviewActive;

    const showGridBtnSetting = Settings.showGridButton;
    const rawGridPos = Settings.gridButtonPosition || 'END';
    const gridPos = (rawGridPos === 'LEFT_EDGE' && !isFullWidth) ? 'START' : rawGridPos;

    const rawClockPos = Settings.clockPosition || 'END';
    const clockPos = (rawClockPos === 'RIGHT_END' && !isFullWidth) ? 'END' : rawClockPos;

    const extractClock = isFullWidth && clockPos === 'RIGHT_END';
    const extractGrid = isFullWidth && gridPos === 'LEFT_EDGE';

    const showMusicPill = Settings.showMusicPill;
    const musicPillPos = Settings.musicPillPosition || 'START';

    const desiredState = [];

    if (!extractClock && clockPos === 'START' && showClock) {
        desiredState.push({ key: 'dhruva-clock', type: 'clock', entity: null });
    }

    if (desiredState.length > 0 && Settings.showModuleSeparator) {
        desiredState.push({ key: 'dhruva-sep-start', type: 'separator', position: 'start' });
    }

    if (showGridBtnSetting && gridPos === 'START' && !extractGrid) {
        desiredState.push({ key: 'dhruva-grid-button', type: 'grid', entity: null });
    }

    if (showMusicPill && musicPillPos === 'START' && !isVerticalDock) {
        desiredState.push({ key: 'dhruva-music-pill', type: 'music-pill', entity: null });
    }

    const displayAppsRaw = dockUI.appManager.getDisplayApps();
    let displayApps = displayAppsRaw;

    const folders = (dockUI.folderManager && dockUI.folderManager.getFolders && dockUI.folderManager.getFolders()) || [];
    const appsInFolders = new Set();
    folders.forEach(f => {
        if (Array.isArray(f.apps)) {
            f.apps.forEach(appId => appsInFolders.add(appId));
        }
    });

    if (dockUI._ignoringApps && dockUI._ignoringApps.size > 0) {
        displayApps = displayAppsRaw.filter(app => {
            if (!app.get_id) return true;
            if (dockUI.appManager.hasApp(app)) return true;
            return !dockUI._ignoringApps.has(app.get_id());
        });
    }

    displayApps = displayApps.filter(app => !appsInFolders.has(app.get_id ? app.get_id() : ''));

    const pinnedItemsMap = new Map();
    const unpinnedItems = [];

    const focusWin = global.display.get_focus_window();

    displayApps.forEach(app => {
        let isRunning = app.get_state() === Shell.AppState.RUNNING;
        let finalActiveWindows = WorkspaceFilter.filterWindows(app.get_windows());

        if (Settings.isolateMonitors) {
            const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
            finalActiveWindows = finalActiveWindows.filter(w => w.get_monitor() === currentMonitorIndex);
        }

        if ((Settings.isolateWorkspaces || Settings.isolateMonitors) && finalActiveWindows.length === 0) {
            isRunning = false;
        }

        if (dockUI._ignoringApps && app.get_id && dockUI._ignoringApps.has(app.get_id())) {
            isRunning = false;
        }

        const isFocused = Array.isArray(finalActiveWindows) && finalActiveWindows.some(w => w === focusWin);

        const appItem = {
            key: app.get_id(),
            type: 'app',
            entity: app,
            isRunning,
            isFocused,
            windowCount: finalActiveWindows.length,
            windows: finalActiveWindows
        };

        if (dockUI.appManager.hasApp(app)) {
            pinnedItemsMap.set(app.get_id(), appItem);
        } else {
            unpinnedItems.push(appItem);
        }
    });

    folders.forEach(folder => {
        let runningApps = [];
        let isFocused = false;
        let focusedApp = null;
        const focusWin = global.display.get_focus_window();

        if (Array.isArray(folder.apps)) {
            folder.apps.forEach(appId => {
                const app = dockUI.appManager.appSystem.lookup_app(appId);
                if (app && (app.get_state() === Shell.AppState.RUNNING || app.get_windows().length > 0)) {
                    let wins = WorkspaceFilter.filterWindows(app.get_windows());
                    if (Settings.isolateMonitors) {
                        const curMon = dockUI.monitorManager.getCurrentMonitor().index;
                        wins = wins.filter(w => w.get_monitor() === curMon);
                    }
                    if (wins.length > 0) {
                        runningApps.push(app);
                        if (wins.some(w => w === focusWin)) {
                            isFocused = true;
                            focusedApp = app;
                        }
                    }
                }
            });
        }

        const isRunning = runningApps.length > 0;
        const targetColorApp = isFocused ? (focusedApp || runningApps[0]) : (runningApps[0] || null);

        pinnedItemsMap.set(`folder:${folder.id}`, {
            key: `folder:${folder.id}`,
            type: 'folder',
            entity: folder,
            isRunning,
            isFocused,
            focusedApp: targetColorApp,
            runningApps,
            windowCount: runningApps.length
        });
    });

    const savedOrder = dockUI.appManager.getDockOrder ? dockUI.appManager.getDockOrder() : [];
    const orderedPinned = [];

    savedOrder.forEach(key => {
        if (pinnedItemsMap.has(key)) {
            orderedPinned.push(pinnedItemsMap.get(key));
            pinnedItemsMap.delete(key);
        }
    });

    pinnedItemsMap.forEach(item => orderedPinned.push(item));
    orderedPinned.forEach(item => desiredState.push(item));

    if (orderedPinned.length > 0 && unpinnedItems.length > 0 && Settings.showAppSeparator) {
        desiredState.push({ key: 'dhruva-sep-running', type: 'separator', position: 'running' });
    }

    unpinnedItems.forEach(item => desiredState.push(item));

    const endModuleKeys = [];
    if (!isFullWidth && Settings.showDesktopButton) {
        endModuleKeys.push({ key: 'dhruva-desktop-module', type: 'desktop', entity: null });
    }

    const sysMods = ['home', 'downloads', 'documents', 'pictures', 'videos', 'music', 'trash'];
    const modIconMap = {
        'home': 'user-home',
        'downloads': 'folder-download',
        'documents': 'folder-documents',
        'pictures': 'folder-pictures',
        'videos': 'folder-videos',
        'music': 'folder-music',
        'trash': 'user-trash'
    };
    sysMods.forEach(m => {
        if (dockUI.settings.get_boolean(`show-${m}`)) {
            const actualIcon = modIconMap[m] || 'folder';
            endModuleKeys.push({ key: `dhruva-sys-${m}`, type: 'module', entity: actualIcon });
        }
    });

    if (Settings.showMounts) {
        const volumeMonitor = Gio.VolumeMonitor.get();
        const mounts = volumeMonitor.get_mounts();
        mounts.forEach(mount => {
            const mKey = `dhruva-sys-mount-${mount.get_name().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            endModuleKeys.push({ key: mKey, type: 'module', entity: 'mounts', mountRef: mount });
        });
    }

    let customFolders = [];
    if (Settings.independentDock && dockUI && dockUI.folderManager && dockUI.folderManager.getCustomFolders) {
        customFolders = dockUI.folderManager.getCustomFolders() || [];
    } else {
        customFolders = Array.isArray(Settings.customFolders) ? Settings.customFolders : [];
    }

    customFolders.forEach((f, idx) => {
        const cKey = `dhruva-sys-custom-${idx}-${(f.name || 'folder').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        endModuleKeys.push({ key: cKey, type: 'module', entity: 'custom', folderData: f });
    });

    if (showMusicPill && musicPillPos === 'END' && !isVerticalDock) {
        endModuleKeys.push({ key: 'dhruva-music-pill', type: 'music-pill', entity: null });
    }

    if (showGridBtnSetting && gridPos === 'END' && !extractGrid) {
        endModuleKeys.push({ key: 'dhruva-grid-button', type: 'grid', entity: null });
    }

    if (endModuleKeys.length > 0) {
        if (Settings.showModuleSeparator) {
            desiredState.push({ key: 'dhruva-sep-end', type: 'separator', position: 'end' });
        }
        endModuleKeys.forEach(m => desiredState.push(m));
    }

    if (!extractClock && clockPos !== 'START' && showClock) {
        if (Settings.showModuleSeparator) {
            desiredState.push({ key: 'dhruva-sep-clock', type: 'separator', position: 'clock' });
        }
        desiredState.push({ key: 'dhruva-clock', type: 'clock', entity: null });
    }

    desiredState.forEach((item, index) => {
        item.position = index;
    });

    return desiredState;
}

export function _diffStates(currentState, desiredState) {
    const currentKeys = new Set(currentState.map(i => i.key));
    const desiredKeys = new Set(desiredState.map(i => i.key));
    const currentMap = new Map(currentState.map(i => [i.key, i]));

    const added = [];
    const removed = [];
    const common = [];
    const moved = [];
    const stateChanged = [];

    desiredState.forEach(item => {
        if (!currentKeys.has(item.key)) {
            added.push(item);
        } else {
            common.push(item);
            const curr = currentMap.get(item.key);
            if (curr.position !== item.position) {
                moved.push(item);
            }
            const focusedAppChanged = item.type === 'folder' && (curr.focusedApp !== item.focusedApp);
            if (curr.isRunning !== item.isRunning || curr.windowCount !== item.windowCount || curr.isFocused !== item.isFocused || focusedAppChanged) {
                stateChanged.push(item);
            }
        }
    });

    currentState.forEach(item => {
        if (!desiredKeys.has(item.key)) {
            removed.push(item);
        }
    });

    return { added, removed, common, moved, stateChanged };
}

export function _capturePositions(dockUI) {
    dockUI._preRenderPositions.clear();
    if (!dockUI._initialLayoutDone) return dockUI._preRenderPositions;

    dockUI._actorRegistry.forEach((meta, key) => {
        if (meta.actor && isActorAlive(meta.actor)) {
            const [x, y] = meta.actor.get_transformed_position();
            const [w, h] = meta.actor.get_transformed_size();
            if (x !== 0 || y !== 0) {
                dockUI._preRenderPositions.set(key, { x, y, width: w, height: h });
            }
        }
    });
    return dockUI._preRenderPositions;
}

export function _animateIconEntry(actor, dockUI, delayMs = 0) {
    if (!actor || !isActorAlive(actor)) return;

    if (!dockUI._initialLayoutDone) {
        actor.opacity = 255;
        actor.set_scale(1.0, 1.0);
        actor.translation_x = 0;
        actor.translation_y = 0;
        return;
    }

    const pos = dockUI.dockPosition;
    let initialRiseY = 0;
    let initialRiseX = 0;
    if (pos === 'BOTTOM') initialRiseY = 14;
    else if (pos === 'TOP') initialRiseY = -14;
    else if (pos === 'LEFT') initialRiseX = -14;
    else if (pos === 'RIGHT') initialRiseX = 14;

    actor.opacity = 0;
    actor.set_pivot_point(0.5, 0.5);
    actor.set_scale(0.2, 0.2);
    actor.translation_x = initialRiseX;
    actor.translation_y = initialRiseY;

    const runAnim = () => {
        if (!isActorAlive(actor)) return GLib.SOURCE_REMOVE;
        actor.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            translation_x: 0,
            translation_y: 0,
            duration: ENTRY_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC
        });
        return GLib.SOURCE_REMOVE;
    };

    if (delayMs > 0) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, runAnim);
    } else {
        runAnim();
    }
}

export function _animateIconExit(actor, dockUI) {
    if (!actor || !isActorAlive(actor)) return Promise.resolve();

    const pos = dockUI.dockPosition;
    let exitDropY = 0;
    let exitDropX = 0;
    if (pos === 'BOTTOM') exitDropY = 16;
    else if (pos === 'TOP') exitDropY = -16;
    else if (pos === 'LEFT') exitDropX = -16;
    else if (pos === 'RIGHT') exitDropX = 16;

    actor.remove_all_transitions();
    actor.set_pivot_point(0.5, 0.5);

    return new Promise(resolve => {
        actor.ease({
            opacity: 0,
            scale_x: 0.1,
            scale_y: 0.1,
            translation_x: exitDropX,
            translation_y: exitDropY,
            duration: EXIT_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                resolve();
            }
        });
    });
}

export function _flipAnimateDockIcons(dockUI, preRenderPositions) {
    if (!dockUI._initialLayoutDone || !preRenderPositions || preRenderPositions.size === 0) return;

    const hoverZoom = Settings.hoverZoom;
    const [cx, cy] = global.get_pointer();
    const isVert = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    if (hoverZoom && isPointerWithinDockBounds(dockUI.actor, cx, cy, isVert, dockUI.settings)) {
        return;
    }

    dockUI.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor)) return GLib.SOURCE_REMOVE;

        dockUI.actor._flipAnimating = true;

        dockUI._actorRegistry.forEach((meta, key) => {
            const actor = meta.actor;
            if (!actor || !isActorAlive(actor)) return;

            const oldPos = preRenderPositions.get(key);
            if (!oldPos) return;

            const [newX, newY] = actor.get_transformed_position();
            const dx = oldPos.x - newX;
            const dy = oldPos.y - newY;

            if (oldPos.x === 0 && oldPos.y === 0) return;

            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                actor.remove_all_transitions();
                actor.translation_x = dx;
                actor.translation_y = dy;

                actor.ease({
                    translation_x: 0,
                    translation_y: 0,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    onComplete: () => {
                        dockUI.actor._flipAnimating = false;
                    }
                });
            }
        });

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 310, () => {
            if (dockUI.actor) dockUI.actor._flipAnimating = false;
            return GLib.SOURCE_REMOVE;
        });

        return GLib.SOURCE_REMOVE;
    });
}

export function _renderDockFull(dockUI, _forceRender = false) {
    const oldVisuals = new Map();
    const cacheActor = (c) => {
        const id = extractActorId(c);
        if (id) {
            oldVisuals.set(id, {
                sx: c.scale_x,
                sy: c.scale_y,
                tx: c.translation_x,
                ty: c.translation_y
            });
        }
    };

    dockUI.boxActor.get_children().forEach(cacheActor);
    if (dockUI.gridBtn) cacheActor(dockUI.gridBtn);
    if (dockUI.extractedClock) cacheActor(dockUI.extractedClock);

    const gridBtnOnActor = Boolean(dockUI.gridBtn && dockUI.gridBtn.get_parent() === dockUI.actor);
    if (isActorAlive(dockUI.boxActor)) {
        const children = dockUI.boxActor.get_children();
        children.forEach(c => {
            if (isActorAlive(c)) {
                dockUI.boxActor.remove_child(c);
                if (!c._isModule && !c._isExternal) {
                    markActorDisposed(c);
                    c.destroy();
                }
            }
        });
    }

    if (dockUI.gridBtn) {
        const btn = dockUI.gridBtn;
        dockUI.gridBtn = null;
        if (gridBtnOnActor) {
            markActorDisposed(btn);
            btn.destroy();
        }
    }

    const clockBtnOnActor = Boolean(dockUI.extractedClock && dockUI.extractedClock.get_parent() === dockUI.actor);
    if (dockUI.extractedClock) {
        const btn = dockUI.extractedClock;
        dockUI.extractedClock = null;
        if (clockBtnOnActor) {
            markActorDisposed(btn);
            btn.destroy();
        }
    }

    const desktopBtnOnActor = Boolean(dockUI.extractedDesktop && dockUI.extractedDesktop.get_parent() === dockUI.actor);
    if (dockUI.extractedDesktop) {
        const btn = dockUI.extractedDesktop;
        dockUI.extractedDesktop = null;
        if (desktopBtnOnActor) {
            markActorDisposed(btn);
            btn.destroy();
        }
    }

    dockUI._actorRegistry.clear();
    dockUI._separatorRegistry.clear();
    dockUI._currentOrder = [];

    const iconSize = Settings.iconSize;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const indPropsGlobal = getIndicatorProps(dockUI);

    const mods = buildModules(dockUI, iconSize);
    const clockModule = mods.clockModule || null;
    const gridBtn = mods.gridModule || null;
    const desktopModule = mods.desktopModule || null;

    const sysModulesMap = new Map();
    if (Array.isArray(mods.systemModules)) {
        mods.systemModules.forEach(modBtn => {
            const id = (modBtn._delegate && modBtn._delegate.app && modBtn._delegate.app.get_id) 
                ? modBtn._delegate.app.get_id() 
                : null;
            if (id) {
                sysModulesMap.set(id, modBtn);
            }
        });
    }

    if (gridBtn) {
        gridBtn._entityId = 'dhruva-grid-button';
        gridBtn._isGridBtn = true;
    }
    if (clockModule) clockModule._entityId = 'dhruva-clock';
    if (desktopModule) desktopModule._entityId = 'dhruva-desktop-module';
    dockUI.gridBtn = gridBtn;

    const desiredState = _computeDesiredState(dockUI);

    desiredState.forEach(item => {
        let actor = null;
        if (item.type === 'app') {
            actor = buildAppButton(dockUI, item.entity, item.isRunning, item.windows || []);
        } else if (item.type === 'folder') {
            actor = buildFolderButton(dockUI, item.entity);
        } else if (item.type === 'separator') {
            actor = createSeparator(dockUI, iconSize, isVerticalDock, item.position, item.key);
        } else if (item.type === 'grid') {
            actor = gridBtn;
        } else if (item.type === 'clock') {
            actor = clockModule;
        } else if (item.type === 'desktop') {
            actor = desktopModule;
        } else if (item.type === 'module') {
            if (item.entity === 'custom' && item.folderData) {
                const targetName = item.folderData.name || '';
                const m = item.key ? item.key.match(/custom-(\d+)/) : null;
                const targetIdx = m ? parseInt(m[1], 10) : -1;
                for (const [modId, modBtn] of sysModulesMap.entries()) {
                    const btnName = (modBtn._delegate && modBtn._delegate.app && modBtn._delegate.app.get_name)
                        ? modBtn._delegate.app.get_name()
                        : '';
                    if ((targetIdx >= 0 && modBtn._customFolderIndex === targetIdx) ||
                        (targetName && btnName === targetName)) {
                        actor = modBtn;
                        sysModulesMap.delete(modId);
                        break;
                    }
                }
            } else if (item.entity === 'mounts' && item.mountRef) {
                const targetName = item.mountRef.get_name();
                for (const [modId, modBtn] of sysModulesMap.entries()) {
                    const btnName = (modBtn._delegate && modBtn._delegate.app && modBtn._delegate.app.get_name)
                        ? modBtn._delegate.app.get_name()
                        : '';
                    if (btnName === targetName) {
                        actor = modBtn;
                        sysModulesMap.delete(modId);
                        break;
                    }
                }
            } else {
                for (const [modId, modBtn] of sysModulesMap.entries()) {
                    if (modId.includes(item.entity) || item.key.includes(modId.replace('dhruva-module-', ''))) {
                        actor = modBtn;
                        sysModulesMap.delete(modId);
                        break;
                    }
                }
                if (!actor && sysModulesMap.size > 0) {
                    const firstKey = sysModulesMap.keys().next().value;
                    actor = sysModulesMap.get(firstKey);
                    sysModulesMap.delete(firstKey);
                }
            }
        } else if (item.type === 'music-pill') {
            if (!dockUI._musicPill) {
                dockUI._musicPill = new MusicPill(dockUI, dockUI.settings);
            }
            actor = dockUI._musicPill;
            actor._isStatic = true;
            actor._isMusicPill = true;
        }

        if (actor) {
            actor._entityId = item.key;
            if (oldVisuals.has(item.key)) {
                const v = oldVisuals.get(item.key);
                actor.scale_x = v.sx !== undefined ? v.sx : 1.0;
                actor.scale_y = v.sy !== undefined ? v.sy : 1.0;
                actor.translation_x = v.tx !== undefined ? v.tx : 0;
                actor.translation_y = v.ty !== undefined ? v.ty : 0;
            }
            actor.opacity = 255;

            dockUI.boxActor.add_child(actor);
            dockUI._actorRegistry.set(item.key, {
                actor,
                type: item.type,
                entity: item.entity,
                isRunning: item.isRunning,
                isFocused: item.isFocused,
                windowCount: item.windowCount
            });
        }
    });

    dockUI._currentOrder = desiredState.map(i => i.key);
    dockUI._previousIconCount = dockUI._currentOrder.length;

    dockActorNotifyStructure(dockUI);
}

export function _renderDockIncremental(dockUI, _forceRender = false) {
    const iconSize = Settings.iconSize;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const indPropsGlobal = getIndicatorProps(dockUI);

    const desiredState = _computeDesiredState(dockUI);
    const desiredKeys = new Set(desiredState.map(i => i.key));

    const seenActorIds = new Set();
    dockUI.boxActor.get_children().forEach(child => {
        if (!isActorAlive(child)) return;
        const id = extractActorId(child);
        if (!id || !desiredKeys.has(id) || seenActorIds.has(id)) {
            dockUI.boxActor.remove_child(child);
            if (!child._isModule && !child._isExternal && !child._isGridBtn) {
                markActorDisposed(child);
                child.destroy();
            } else {
                child.hide();
            }
        } else {
            seenActorIds.add(id);
        }
    });

    const currentState = [];
    dockUI._currentOrder.forEach((key, index) => {
        const meta = dockUI._actorRegistry.get(key);
        if (meta) {
            currentState.push({
                key,
                type: meta.type || 'separator',
                entity: meta.entity || null,
                isRunning: meta.isRunning,
                isFocused: meta.isFocused,
                focusedApp: meta.focusedApp || null,
                windowCount: meta.windowCount,
                position: index
            });
        }
    });

    const diff = _diffStates(currentState, desiredState);
    _capturePositions(dockUI);

    diff.removed.forEach(item => {
        const reg = dockUI._actorRegistry.get(item.key);
        if (!reg || !reg.actor) return;

        const actor = reg.actor;
        const isDraggedOut = (dockUI._draggedOutKey === item.key);

        if (item.type === 'grid' || item.type === 'clock' || item.type === 'desktop' || actor._isModule || actor._isExternal || actor._isGridBtn) {
            actor.hide();
            dockUI._actorRegistry.delete(item.key);
        } else if (isDraggedOut) {
            dockUI._actorRegistry.delete(item.key);
            if (isActorAlive(actor)) {
                if (actor.get_parent()) actor.get_parent().remove_child(actor);
                markActorDisposed(actor);
                actor.destroy();
            }
        } else {
            dockUI._actorRegistry.delete(item.key);
            _animateIconExit(actor, dockUI).then(() => {
                if (isActorAlive(actor)) {
                    if (actor.get_parent()) actor.get_parent().remove_child(actor);
                    markActorDisposed(actor);
                    actor.destroy();
                    if (dockUI._updateLayout) dockUI._updateLayout();
                }
            });
        }
    });

    dockUI._draggedOutKey = null;

    let staggerIdx = 0;
    diff.added.forEach(item => {
        let newActor = null;
        let isStatic = false;

        if (item.type === 'app') {
            newActor = buildAppButton(dockUI, item.entity, item.isRunning, item.windows || []);
            newActor._entityId = item.key;
        } else if (item.type === 'folder') {
            newActor = buildFolderButton(dockUI, item.entity);
            newActor._entityId = item.key;
        } else if (item.type === 'separator') {
            newActor = createSeparator(dockUI, iconSize, isVerticalDock, item.position, item.key);
            newActor._entityId = item.key;
            isStatic = true;
        } else if (item.type === 'grid') {
            if (dockUI.gridBtn && isActorAlive(dockUI.gridBtn)) {
                newActor = dockUI.gridBtn;
            } else {
                const mods = buildModules(dockUI, iconSize);
                newActor = mods.gridModule;
                dockUI.gridBtn = newActor;
            }
            if (newActor) {
                newActor._entityId = 'dhruva-grid-button';
                newActor._isGridBtn = true;
                isStatic = true;
            }
        } else if (item.type === 'clock') {
            if (dockUI.extractedClock && isActorAlive(dockUI.extractedClock)) {
                newActor = dockUI.extractedClock;
            } else {
                const mods = buildModules(dockUI, iconSize);
                newActor = mods.clockModule;
            }
            if (newActor) {
                newActor._entityId = 'dhruva-clock';
                isStatic = true;
            }
        } else if (item.type === 'desktop') {
            const mods = buildModules(dockUI, iconSize);
            newActor = mods.desktopModule;
            if (newActor) {
                newActor._entityId = 'dhruva-desktop-module';
                isStatic = true;
            }
        } else if (item.type === 'module') {
            const mods = buildModules(dockUI, iconSize);
            if (Array.isArray(mods.systemModules)) {
                if (item.entity === 'custom' && item.folderData) {
                    const targetName = item.folderData.name || '';
                    const m = item.key ? item.key.match(/custom-(\d+)/) : null;
                    const targetIdx = m ? parseInt(m[1], 10) : -1;
                    for (let i = 0; i < mods.systemModules.length; i++) {
                        const btn = mods.systemModules[i];
                        const btnName = (btn._delegate && btn._delegate.app && btn._delegate.app.get_name)
                            ? btn._delegate.app.get_name()
                            : '';
                        if ((targetIdx >= 0 && btn._customFolderIndex === targetIdx) ||
                            (targetName && btnName === targetName)) {
                            newActor = btn;
                            break;
                        }
                    }
                } else if (item.entity === 'mounts' && item.mountRef) {
                    const targetName = item.mountRef.get_name();
                    for (let i = 0; i < mods.systemModules.length; i++) {
                        const btn = mods.systemModules[i];
                        const btnName = (btn._delegate && btn._delegate.app && btn._delegate.app.get_name)
                            ? btn._delegate.app.get_name()
                            : '';
                        if (btnName === targetName) {
                            newActor = btn;
                            break;
                        }
                    }
                } else {
                    for (let i = 0; i < mods.systemModules.length; i++) {
                        const btn = mods.systemModules[i];
                        const id = (btn._delegate && btn._delegate.app && btn._delegate.app.get_id) 
                            ? btn._delegate.app.get_id() 
                            : '';
                        if (id.includes(item.entity) || item.key.includes(id.replace('dhruva-module-', ''))) {
                            newActor = btn;
                            break;
                        }
                    }
                }

                if (!newActor && mods.systemModules.length > 0) {
                    newActor = mods.systemModules[0];
                }
            }
            if (newActor) {
                newActor._entityId = item.key;
                isStatic = true;
            }
        } else if (item.type === 'music-pill') {
            if (!dockUI._musicPill) {
                dockUI._musicPill = new MusicPill(dockUI, dockUI.settings);
            }
            newActor = dockUI._musicPill;
            newActor._entityId = 'dhruva-music-pill';
            newActor._isMusicPill = true;
            isStatic = true;
        }

        if (newActor) {
            if (newActor.get_parent() !== dockUI.boxActor) {
                if (newActor.get_parent()) newActor.get_parent().remove_child(newActor);
                dockUI.boxActor.add_child(newActor);
            }

            dockUI._actorRegistry.set(item.key, {
                actor: newActor,
                type: item.type,
                entity: item.entity,
                isRunning: item.isRunning,
                isFocused: item.isFocused,
                windowCount: item.windowCount
            });

            if (!isStatic) {
                _animateIconEntry(newActor, dockUI, staggerIdx * 25);
                staggerIdx++;
            } else {
                newActor.opacity = 255;
                newActor.show();
            }
        }
    });

    diff.stateChanged.forEach(item => {
        const meta = dockUI._actorRegistry.get(item.key);
        if (!meta || !meta.actor || !isActorAlive(meta.actor)) return;

        meta.isRunning = item.isRunning;
        meta.isFocused = item.isFocused;
        meta.focusedApp = item.focusedApp || null;
        meta.windowCount = item.windowCount;

        let activeColorSource = item.entity || item.key;
        if (item.type === 'folder') {
            const folderIcon = (item.entity && item.entity.icon) ? item.entity.icon : 'folder';
            activeColorSource = item.focusedApp || (item.runningApps && item.runningApps[0]) || folderIcon;
        }
        const itemIndProps = getIndicatorProps(dockUI, activeColorSource);

        if (meta.type === 'folder' && meta.actor._delegate && meta.actor._delegate.updateRunningState) {
            meta.actor._delegate.updateRunningState(item.isRunning, item.runningApps || [], item.isFocused, item.focusedApp);
        } else if (meta.actor._delegate && meta.actor._delegate.updateRunningState) {
            meta.actor._delegate.updateRunningState(item.isRunning, item.windows || [], item.isFocused);
        } else if (attachHoverBackground && attachHoverBackground.updateState) {
            attachHoverBackground.updateState(meta.actor, item.isRunning, item.windows || [], itemIndProps, dockUI, item.isFocused);
        }
    });

    dockUI._actorRegistry.forEach((meta, key) => {
        if (!meta || !meta.actor || !isActorAlive(meta.actor)) return;
        if (meta.type === 'folder' && meta.actor._delegate && meta.actor._delegate.updateRunningState) {
            const des = desiredState.find(d => d.key === key);
            if (des) {
                meta.actor._delegate.updateRunningState(des.isRunning, des.runningApps || [], des.isFocused, des.focusedApp);
            }
        } else if (meta.type === 'module' && meta.actor._delegate && meta.actor._delegate.updateRunningState) {
            meta.actor._delegate.updateRunningState();
        }
    });

    desiredState.forEach((item, targetIndex) => {
        const reg = dockUI._actorRegistry.get(item.key);
        if (reg && reg.actor && isActorAlive(reg.actor)) {
            const currentChildren = dockUI.boxActor.get_children();
            if (currentChildren[targetIndex] !== reg.actor) {
                dockUI.boxActor.set_child_at_index(reg.actor, targetIndex);
            }
        }
    });

    const runningSep = dockUI._actorRegistry.get('dhruva-sep-running');
    if (runningSep && isActorAlive(runningSep.actor)) {
        const shouldShow = desiredState.some(i => i.key === 'dhruva-sep-running');
        if (!shouldShow) {
            dockUI.boxActor.remove_child(runningSep.actor);
            runningSep.actor.destroy();
            dockUI._actorRegistry.delete('dhruva-sep-running');
        }
    }

    dockUI._currentOrder = desiredState.map(i => i.key);
    dockUI._previousIconCount = dockUI._currentOrder.length;

    const isFullWidth = Settings.fullWidth;
    if (isFullWidth && dockUI.gridBtn && dockUI.gridBtn.get_parent() !== dockUI.actor) {
        if (dockUI.gridBtn.get_parent()) dockUI.gridBtn.get_parent().remove_child(dockUI.gridBtn);
        dockUI.actor.add_child(dockUI.gridBtn);
    }
    if (dockUI._musicPill) {
        if (dockUI._musicPill._hasValidTrack && !isVerticalDock) dockUI._musicPill.show();
        else dockUI._musicPill.hide();
    }

    dockActorNotifyStructure(dockUI);
}

function dockActorNotifyStructure(dockUI) {
    if (dockUI.actor) {
        dockUI.actor._structureChanged = true;
        dockUI.actor._fixedSlots = null;
    }
}

export function renderDock(dockUI, mode = 'incremental', forceRender = false) {
    if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor)) return;

    if (!dockUI.actor.is_mapped() && forceRender !== true && dockUI._initialRenderDone) {
        dockUI._pendingRender = true;
        return;
    }
    dockUI._initialRenderDone = true;

    if (dockUI.actor._isDragging || dockUI._dropSettling) {
        dockUI._pendingRender = true;
        return;
    }

    if (!forceRender && dockUI.actor._lastIconClickTime) {
        const elapsed = Date.now() - dockUI.actor._lastIconClickTime;
        if (elapsed < CLICK_THROTTLE_MS) {
            dockUI._pendingRender = false;

            if (dockUI._delayedRenderId) {
                dockUI.registry.remove(dockUI._delayedRenderId);
                dockUI._delayedRenderId = null;
            }
            dockUI._delayedRenderId = dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, POST_CLICK_DELAY_MS - elapsed, () => {
                dockUI._delayedRenderId = null;
                if (dockUI.queueRender) dockUI.queueRender(mode, false);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
    }

    if (dockUI._isRendering) {
        dockUI._pendingRender = true;
        return;
    }

    dockUI._isRendering = true;
    dockUI._pendingRender = false;

    if (mode === 'full' || !dockUI._initialLayoutDone || dockUI._actorRegistry.size === 0) {
        _renderDockFull(dockUI, forceRender);
    } else {
        _renderDockIncremental(dockUI, forceRender);
    }

    dockUI._applyIndicatorBaselineAlignment();
    dockUI.actor._fixedSlots = null;
    dockUI.actor._tooltipHoveredIndex = -1;
    dockUI.actor._magTooltipAppId = null;

    const hoverZoom = Settings.hoverZoom;
    const showTooltips = Settings.showAppsPreview;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    if (hoverZoom || showTooltips) {
        const setPivot = (btn) => {
            if (dockUI.dockPosition === 'BOTTOM') btn.set_pivot_point(0.5, 1.0);
            else if (dockUI.dockPosition === 'TOP') btn.set_pivot_point(0.5, 0.0);
            else if (dockUI.dockPosition === 'LEFT') btn.set_pivot_point(0.0, 0.5);
            else if (dockUI.dockPosition === 'RIGHT') btn.set_pivot_point(1.0, 0.5);
        };

        dockUI.boxActor.get_children().forEach(c => {
            const sClass = c.get_style_class_name ? c.get_style_class_name() : (c.style_class || '');
            if (!sClass.includes('dock-separator')) setPivot(c);
        });

        if (dockUI.gridBtn) setPivot(dockUI.gridBtn);

        if (!dockUI.actor._isMagSetup) {
            if (dockUI._magnifierSetupIdleId) {
                dockUI.registry.remove(dockUI._magnifierSetupIdleId);
                dockUI._magnifierSetupIdleId = null;
            }

            dockUI._magnifierSetupIdleId = dockUI.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                dockUI._magnifierSetupIdleId = null;
                if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor) || !dockUI.actor.is_mapped()) {
                    return GLib.SOURCE_REMOVE;
                }

                setupMagnification(dockUI.actor, dockUI.settings, () => dockUI.dockPosition);
                dockUI.actor._isMagSetup = true;

                const focusWin = global.display.get_focus_window();
                if (focusWin && focusWin.is_fullscreen && focusWin.is_fullscreen()) {
                    resetMagnification(dockUI.actor);
                    return GLib.SOURCE_REMOVE;
                }

                dockUI.actor._fixedSlots = null;
                const [cx, cy] = global.get_pointer();

                if (isPointerWithinDockBounds(dockUI.actor, cx, cy, isVerticalDock, dockUI.settings)) {
                    applyRealtimeFrame(dockUI.actor, cx, cy, isVerticalDock, dockUI.settings, Date.now());
                } else {
                    resetMagnification(dockUI.actor);
                }

                return GLib.SOURCE_REMOVE;
            });
        } else {
            const focusWin = global.display.get_focus_window();
            if (!focusWin || !focusWin.is_fullscreen || !focusWin.is_fullscreen()) {
                const [cx, cy] = global.get_pointer();
                applyRealtimeFrame(dockUI.actor, cx, cy, isVerticalDock, dockUI.settings, Date.now());
            } else {
                resetMagnification(dockUI.actor);
            }
        }
    } else {
        teardownMagnification(dockUI.actor);
        dockUI.actor._isMagSetup = false;
    }

    applyDynamicStyles(dockUI);
    updateLayout(dockUI);
    if (dockUI.dockManager) dockUI.dockManager.updatePosition();

    dockUI._initialLayoutDone = true;
    dockUI._isRendering = false;

    if (dockUI._pendingRender) {
        dockUI._pendingRender = false;
        dockUI.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            renderDock(dockUI, dockUI._pendingRenderState ? dockUI._pendingRenderState.mode : 'incremental', false);
            return GLib.SOURCE_REMOVE;
        });
    }
}