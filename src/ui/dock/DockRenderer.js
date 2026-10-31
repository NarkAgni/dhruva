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
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { MusicPill } from '../modules/MusicPill.js';
import { updateLayout } from './DockLayoutEngine.js';
import { Settings } from '../../core/SettingsManager.js';
import { isDynamicPanelLayout, isPanelOrFullWidth } from '../../core/LayoutMode.js';
import { buildModules } from '../modules/DockModules.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import { applyDynamicStyles } from './DockThemeResolver.js';
import { setupMagnification } from '../magnifier/Magnifier.js';
import { HYBRID_PANEL_CONFIG } from '../../core/PanelConfig.js';
import { applyRealtimeFrame } from '../magnifier/MagnifierFrameEngine.js';
import { isPointerWithinDockBounds } from '../magnifier/MagnifierMath.js';
import { setEdgePivot, counterScaleButtonIndicators } from './DockButtonBase.js';
import { DockOverflowMenu, OVERFLOW_BUTTON_KEY } from './DockOverflowMenu.js';
import { resetMagnification, teardownMagnification } from '../magnifier/MagnifierReset.js';
import { isActorAlive, markActorDisposed, extractIconDominantColor } from '../../core/Utils.js';
import { captureDockTransition, releaseRemovedItems, playDockTransition } from './DockTransitions.js';
import { createSeparator, separatorPrefix, buildAppButton, buildFolderButton } from './DockItemBuilder.js';


const POST_CLICK_DELAY_MS = 860;

const OVERFLOW_KEEP_TYPES = ['folder', 'module', 'music-pill', 'grid', 'clock', 'desktop'];
const DOCK_BOX_EDGE_PADDING = 8;
const SEPARATOR_MARGIN = 8;
const CLOCK_FALLBACK_SPAN = 90;

const SYSTEM_MODULES = [
    ['home', 'user-home'],
    ['downloads', 'folder-download'],
    ['documents', 'folder-documents'],
    ['pictures', 'folder-pictures'],
    ['videos', 'folder-videos'],
    ['music', 'folder-music'],
    ['trash', 'user-trash'],
];

const TASKBAR_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
];


function _isVerticalDock(dockUI) {
    return dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
}

function _naturalSpan(actor, isVertical) {
    const [, natural] = isVertical ? actor.get_preferred_height(-1) : actor.get_preferred_width(-1);
    return natural;
}

function _styleClassOf(actor) {
    if (!actor) return '';
    return actor.get_style_class_name ? (actor.get_style_class_name() || '') : (actor.style_class || '');
}

function _slugify(text) {
    return (text || 'folder').toLowerCase().replace(/[^a-z0-9]/g, '-');
}

export function filterActiveWindows(dockUI, windows) {
    const taskbarWindows = windows.filter(w => TASKBAR_WINDOW_TYPES.includes(w.get_window_type()));
    let filtered = WorkspaceFilter.filterWindows(taskbarWindows);
    if (Settings.isolateMonitors) {
        const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
        filtered = filtered.filter(w => w.get_monitor() === currentMonitorIndex);
    }
    return filtered;
}


export function getIndicatorProps(dockUI, appOrIcon = null) {
    const indStyle = Settings.indicatorStyle || 'dot';
    const indSize = Settings.indicatorSize || 4;
    const indGlow = Settings.indicatorGlow;
    const isVert = _isVerticalDock(dockUI);
    const iconSize = Settings.iconSize || 48;
    const hoverZoom = Settings.hoverZoom;

    const currentTheme = Settings.dockTheme || 'default';
    const colorMode = Settings.indicatorColorMode || 'dominant';
    const fallbackColor = Settings.indicatorColor || '#ffffff';

    let indColor = fallbackColor;
    if (currentTheme === 'chameleon' && dockUI._chameleonAccent) {
        indColor = dockUI._chameleonAccent;
    } else if (colorMode === 'dominant' && appOrIcon) {
        indColor = extractIconDominantColor(appOrIcon, fallbackColor, () => dockUI.refreshIndicatorColors());
    }

    let dw = indSize;
    let dh = indSize;
    let br = '100px';

    const safeHeightPad = Math.max(Settings.dockHeight || 6, 4);

    if (indStyle === 'square') {
        br = '2px';
    } else if (indStyle === 'dash' || indStyle === 'line' || indStyle === 'windows') {
        const squareSize = hoverZoom ? iconSize : (iconSize + safeHeightPad * 2);
        let len = indStyle === 'line' ? squareSize : Math.max(12, indSize * 2.5);
        if (indStyle === 'windows') {
            len = Math.max(12, Math.floor(indSize * 2.0));
            br = '4px';
        } else {
            br = '0px';
        }
        const thick = Math.max(2, Math.floor(indSize / (indStyle === 'line' ? 1.5 : 1.2)));
        dw = isVert ? thick : len;
        dh = isVert ? len : thick;
    }

    const offset = Math.max(1, safeHeightPad - 4);
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

function extractActorId(c) {
    if (!c) return null;
    if (c._entityId) return c._entityId;
    if (c._isOverflowBtn) return OVERFLOW_BUTTON_KEY;
    if (c._delegate && c._delegate.app && c._delegate.app.get_id) return c._delegate.app.get_id();
    if (c._delegate && c._delegate.isFolder && c._delegate.folderData) return `folder:${c._delegate.folderData.id}`;
    if (c._sepId) return c._sepId;
    if (c.has_style_class_name && c.has_style_class_name('dock-separator')) return c._sepId || 'dhruva-sep-default';
    if (c.has_style_class_name && c.has_style_class_name('clock-module')) return 'dhruva-clock';

    const sClass = _styleClassOf(c);
    if (sClass.includes('dock-grid-button') || sClass.includes('grid-button') || c._isGridBtn) return 'dhruva-grid-button';

    const child = c.get_child ? c.get_child() : null;
    if (child) {
        const childClass = _styleClassOf(child);
        if (childClass.includes('dock-grid-icon') || childClass.includes('grid-button')) return 'dhruva-grid-button';
    }

    if (sClass.includes('desktop-module') || c._isDesktopBtn) return 'dhruva-desktop-module';
    if (sClass.includes('dhruva-music-pill') || c._isMusicPill) return 'dhruva-music-pill';
    if (c._modType) return `dhruva-sys-${c._modType}`;

    return null;
}

function _computeDesiredState(dockUI) {
    const isPanelOrFull = isPanelOrFullWidth();
    const isVerticalDock = _isVerticalDock(dockUI);
    const showClock = Settings.showClock && !dockUI.isOverviewActive;
    const showGridBtn = Settings.showGridButton;

    const rawGridPos = Settings.gridButtonPosition || 'END';
    const gridPos = (rawGridPos === 'LEFT_EDGE' && !isPanelOrFull) ? 'START' : rawGridPos;

    const rawClockPos = Settings.clockPosition || 'END';
    const clockPos = (rawClockPos === 'RIGHT_END' && !isPanelOrFull) ? 'END' : rawClockPos;

    const extractClock = isPanelOrFull && clockPos === 'RIGHT_END';
    const extractGrid = isPanelOrFull && gridPos === 'LEFT_EDGE';

    const showMusicPill = Settings.showMusicPill;
    const musicPillPos = Settings.musicPillPosition || 'START';

    const desiredState = [];

    const startModuleKeys = [];
    if (!extractClock && clockPos === 'START' && showClock) {
        startModuleKeys.push({ key: 'dhruva-clock', type: 'clock', entity: null });
    }
    if (showGridBtn && gridPos === 'START' && !extractGrid) {
        startModuleKeys.push({ key: 'dhruva-grid-button', type: 'grid', entity: null });
    }
    if (startModuleKeys.length > 0) {
        for (let i = 0; i < startModuleKeys.length; i++) desiredState.push(startModuleKeys[i]);
        if (Settings.showModuleSeparator) {
            desiredState.push({ key: 'dhruva-sep-start', type: 'separator', sepKind: 'module' });
        }
    }

    if (showMusicPill && musicPillPos === 'START' && !isVerticalDock) {
        desiredState.push({ key: 'dhruva-music-pill', type: 'music-pill', entity: null });
    }

    const folders = (dockUI.folderManager && dockUI.folderManager.getFolders) ? dockUI.folderManager.getFolders() : [];
    const appsInFolders = new Set();
    for (let i = 0; i < folders.length; i++) {
        const folderApps = folders[i].apps;
        if (Array.isArray(folderApps)) {
            for (let j = 0; j < folderApps.length; j++) appsInFolders.add(folderApps[j]);
        }
    }

    let displayApps = dockUI.appManager.getDisplayApps();
    if (dockUI._ignoringApps && dockUI._ignoringApps.size > 0) {
        displayApps = displayApps.filter(app => {
            if (!app.get_id || dockUI.appManager.hasApp(app)) return true;
            return !dockUI._ignoringApps.has(app.get_id());
        });
    }
    displayApps = displayApps.filter(app => !appsInFolders.has(app.get_id ? app.get_id() : ''));

    const pinnedItemsMap = new Map();
    const unpinnedItems = [];
    const focusWin = global.display.get_focus_window();
    const isIsolated = Settings.isolateWorkspaces || Settings.isolateMonitors;

    for (let i = 0; i < displayApps.length; i++) {
        const app = displayApps[i];
        const appId = app.get_id();
        const activeWindows = filterActiveWindows(dockUI, app.get_windows());
        let isRunning = app.get_state() === Shell.AppState.RUNNING;

        if (isIsolated && activeWindows.length === 0) isRunning = false;
        if (dockUI._ignoringApps && dockUI._ignoringApps.has(appId)) isRunning = false;

        const appItem = {
            key: appId,
            type: 'app',
            entity: app,
            isRunning,
            isFocused: activeWindows.some(w => w === focusWin),
            windowCount: activeWindows.length,
            windows: activeWindows,
        };

        if (dockUI.appManager.hasApp(app)) pinnedItemsMap.set(appId, appItem);
        else unpinnedItems.push(appItem);
    }

    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const runningApps = [];
        let isFocused = false;
        let focusedApp = null;

        if (Array.isArray(folder.apps)) {
            for (let j = 0; j < folder.apps.length; j++) {
                const app = dockUI.appManager.appSystem.lookup_app(folder.apps[j]);
                if (app && (app.get_state() === Shell.AppState.RUNNING || app.get_windows().length > 0)) {
                    const wins = filterActiveWindows(dockUI, app.get_windows());
                    if (wins.length > 0) {
                        runningApps.push(app);
                        if (wins.some(w => w === focusWin)) {
                            isFocused = true;
                            focusedApp = app;
                        }
                    }
                }
            }
        }

        const isRunning = runningApps.length > 0;
        pinnedItemsMap.set(`folder:${folder.id}`, {
            key: `folder:${folder.id}`,
            type: 'folder',
            entity: folder,
            isRunning,
            isFocused,
            focusedApp: isFocused ? (focusedApp || runningApps[0]) : (runningApps[0] || null),
            runningApps,
            windowCount: runningApps.length,
        });
    }

    const savedOrder = dockUI.appManager.getDockOrder ? dockUI.appManager.getDockOrder() : [];
    const orderedPinned = [];

    for (let i = 0; i < savedOrder.length; i++) {
        const key = savedOrder[i];
        if (pinnedItemsMap.has(key)) {
            orderedPinned.push(pinnedItemsMap.get(key));
            pinnedItemsMap.delete(key);
        }
    }
    pinnedItemsMap.forEach(item => orderedPinned.push(item));

    for (let i = 0; i < orderedPinned.length; i++) desiredState.push(orderedPinned[i]);

    if (orderedPinned.length > 0 && unpinnedItems.length > 0 && Settings.showAppSeparator) {
        desiredState.push({ key: 'dhruva-sep-running', type: 'separator', sepKind: 'running' });
    }

    for (let i = 0; i < unpinnedItems.length; i++) desiredState.push(unpinnedItems[i]);

    if (showMusicPill && musicPillPos === 'END' && !isVerticalDock) {
        desiredState.push({ key: 'dhruva-music-pill', type: 'music-pill', entity: null });
    }

    const endModuleKeys = [];
    if (Settings.showDesktopButton && !isPanelOrFull) {
        endModuleKeys.push({ key: 'dhruva-desktop-module', type: 'desktop', entity: null });
    }

    for (let i = 0; i < SYSTEM_MODULES.length; i++) {
        const [modName, iconName] = SYSTEM_MODULES[i];
        if (dockUI.settings.get_boolean(`show-${modName}`)) {
            endModuleKeys.push({ key: `dhruva-sys-${modName}`, type: 'module', entity: iconName });
        }
    }

    if (Settings.showMounts) {
        const mounts = Gio.VolumeMonitor.get().get_mounts();
        for (let i = 0; i < mounts.length; i++) {
            const mount = mounts[i];
            endModuleKeys.push({
                key: `dhruva-sys-mount-${_slugify(mount.get_name())}`,
                type: 'module',
                entity: 'mounts',
                mountRef: mount,
            });
        }
    }

    const customFolders = (Settings.independentDock && dockUI.folderManager && dockUI.folderManager.getCustomFolders)
        ? (dockUI.folderManager.getCustomFolders() || [])
        : (Array.isArray(Settings.customFolders) ? Settings.customFolders : []);

    for (let idx = 0; idx < customFolders.length; idx++) {
        const f = customFolders[idx];
        endModuleKeys.push({
            key: `dhruva-sys-custom-${idx}-${_slugify(f.name)}`,
            type: 'module',
            entity: 'custom',
            folderData: f,
        });
    }

    if (showGridBtn && gridPos === 'END' && !extractGrid) {
        endModuleKeys.push({ key: 'dhruva-grid-button', type: 'grid', entity: null });
    }

    if (endModuleKeys.length > 0) {
        if (Settings.showModuleSeparator) {
            desiredState.push({ key: 'dhruva-sep-end', type: 'separator', sepKind: 'module' });
        }
        for (let i = 0; i < endModuleKeys.length; i++) desiredState.push(endModuleKeys[i]);
    }

    if (!extractClock && clockPos !== 'START' && showClock) {
        if (Settings.showModuleSeparator) {
            desiredState.push({ key: 'dhruva-sep-clock', type: 'separator', sepKind: 'module' });
        }
        desiredState.push({ key: 'dhruva-clock', type: 'clock', entity: null });
    }

    for (let index = 0; index < desiredState.length; index++) {
        desiredState[index].position = index;
    }

    return desiredState;
}


function _cacheItemSpans(dockUI) {
    const isVertical = _isVerticalDock(dockUI);
    const spans = new Map();
    for (const [key, entry] of dockUI._actorRegistry) {
        if (entry.type === 'overflow') continue;
        const span = entry.actor.visible ? _naturalSpan(entry.actor, isVertical) : 0;
        spans.set(key, { type: entry.type, span });
    }
    dockUI._itemSpans = spans;
}

function _measureAppSlot(_dockUI) {
    return (Settings.iconSize || 48) + 4;
}

function _itemSpan(dockUI, item, appSlot) {
    if (item.type === 'music-pill') {
        const pill = dockUI._musicPill;
        return pill && pill.visible ? _naturalSpan(pill, _isVerticalDock(dockUI)) : 0;
    }
    if (item.type === 'app' || item.type === 'folder' || item.type === 'grid' || item.type === 'module') {
        return appSlot;
    }

    const cached = dockUI._itemSpans.get(item.key);
    if (cached && cached.span > 0) return cached.span;

    switch (item.type) {
        case 'separator':
            return dockUI.settings.get_int(`${separatorPrefix(item.sepKind)}-width`) + SEPARATOR_MARGIN;
        case 'clock': return CLOCK_FALLBACK_SPAN;
        case 'desktop': return Settings.desktopBtnWidth + SEPARATOR_MARGIN;
        default: return appSlot;
    }
}

function _measureFreeCorridor(dockUI, isVertical) {
    const cfg = HYBRID_PANEL_CONFIG;
    const leftBox = dockUI.panelIntegrator.leftContainer;
    const rightBox = dockUI.panelIntegrator.container;
    const isDynamicPanel = isDynamicPanelLayout();

    const gapStart = isDynamicPanel ? 16 : (isVertical ? cfg.DOCK_GAP_AFTER_LEFT_VERTICAL : cfg.DOCK_GAP_AFTER_LEFT);
    const gapEnd = isDynamicPanel ? 16 : (isVertical ? cfg.DOCK_GAP_BEFORE_RIGHT_VERTICAL : cfg.DOCK_GAP_BEFORE_RIGHT);

    const monitor = dockUI.monitorManager.getCurrentMonitor().monitor;
    if (isDynamicPanel) {
        if (!monitor) return Infinity;
        const availableMonitorSpan = (isVertical ? monitor.height : monitor.width) - 24;
        const rawPct = Settings.dynamicPanelLength;
        const maxAllowedSpan = rawPct > 0
            ? Math.round(availableMonitorSpan * (Math.max(20, Math.min(100, rawPct)) / 100.0))
            : availableMonitorSpan;

        let deskSpan = 0;
        if (Settings.showDesktopButton) {
            const minCornerWidth = Math.max(12, Math.ceil((Settings.borderRadius || 18) * 0.55));
            const rawWidth = Settings.desktopBtnWidth;
            deskSpan = Math.max(minCornerWidth, (rawWidth !== undefined && rawWidth !== null && rawWidth > 0) ? rawWidth : 12) + 8;
        }

        let leftSpan = Math.max(isVertical ? 20 : 30, Math.round(_naturalSpan(leftBox, isVertical) || 0));
        let rightSpan = 30;
        if (isActorAlive(rightBox)) {
            const visibleChildren = rightBox.get_children().filter(c => {
                if (!isActorAlive(c) || !c.visible || c.opacity === 0) return false;
                if (c.name === 'DhruvaStolenExtensionsBox') {
                    const subChildren = (c.get_children && c.get_children()) ? c.get_children().filter(sc => isActorAlive(sc) && sc.visible && sc.opacity > 0) : [];
                    return subChildren.length > 0;
                }
                return true;
            });
            let itemsSpan = 0;
            for (let i = 0; i < visibleChildren.length; i++) {
                itemsSpan += Math.round(_naturalSpan(visibleChildren[i], isVertical) || 0);
            }
            const spacingSum = Math.max(0, (visibleChildren.length - 1) * 8);
            rightSpan = Math.max(itemsSpan + spacingSum, 30);
        }

        const outerPad = 20;
        return Math.max(0, maxAllowedSpan - leftSpan - gapStart - rightSpan - gapEnd - deskSpan - outerPad);
    }

    const leftStart = isVertical ? leftBox.y : leftBox.x;
    const leftSize = isVertical ? leftBox.height : leftBox.width;
    const rightStart = isVertical ? rightBox.y : rightBox.x;

    if (leftSize > 0 && rightStart > 0) {
        return rightStart - gapEnd - (leftStart + leftSize + gapStart);
    }

    if (!monitor) return Infinity;

    const screenSpan = isVertical ? monitor.height : monitor.width;
    return screenSpan - _naturalSpan(leftBox, isVertical) - gapStart - _naturalSpan(rightBox, isVertical) - gapEnd;
}

function _trimSeparators(items) {
    const cleaned = [];
    for (const item of items) {
        if (item.type === 'separator' && (cleaned.length === 0 || cleaned[cleaned.length - 1].type === 'separator')) continue;
        cleaned.push(item);
    }
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'separator') cleaned.pop();
    return cleaned;
}

function _insertOverflowSlot(items) {
    const slot = { key: OVERFLOW_BUTTON_KEY, type: 'overflow', entity: null };
    const index = items.findIndex(item => item.key === 'dhruva-sep-end' || item.type === 'module');
    if (index >= 0) items.splice(index, 0, slot);
    else items.push(slot);
    return items;
}

function _keepFocusedOnPanel(normalItems, overflowItems) {
    const focusedIndex = overflowItems.findIndex(item => item.isFocused);
    if (focusedIndex < 0) return;

    let lastAppIndex = -1;
    normalItems.forEach((item, index) => {
        if (item.type === 'app') lastAppIndex = index;
    });
    if (lastAppIndex < 0) return;

    const [focused] = overflowItems.splice(focusedIndex, 1);
    overflowItems.unshift(normalItems[lastAppIndex]);
    normalItems[lastAppIndex] = focused;
}

function _partitionForOverflow(dockUI, desiredState) {
    if (!Settings.hybridPanelMode || !dockUI.panelIntegrator) {
        return { normalItems: desiredState, overflowItems: [] };
    }

    const isVertical = _isVerticalDock(dockUI);
    const spacing = Settings.iconSpacing;
    const appSlot = _measureAppSlot(dockUI);
    const hysteresis = dockUI._overflowKeys ? appSlot / 2 : 0;
    const capacity = _measureFreeCorridor(dockUI, isVertical) - DOCK_BOX_EDGE_PADDING - hysteresis;

    const spanOf = item => {
        const span = _itemSpan(dockUI, item, appSlot);
        return span > 0 ? span + spacing : 0;
    };

    let totalSpan = 0;
    for (const item of desiredState) totalSpan += spanOf(item);
    if (totalSpan <= capacity) {
        return { normalItems: desiredState, overflowItems: [] };
    }

    let reservedSpan = appSlot + spacing;
    for (const item of desiredState) {
        if (item.type === 'separator' || OVERFLOW_KEEP_TYPES.includes(item.type)) reservedSpan += spanOf(item);
    }

    let appBudget = capacity - reservedSpan;
    const normalItems = [];
    const overflowItems = [];

    for (const item of desiredState) {
        if (item.type === 'separator' || OVERFLOW_KEEP_TYPES.includes(item.type)) {
            normalItems.push(item);
            continue;
        }
        const span = spanOf(item);
        if (span <= appBudget) {
            appBudget -= span;
            normalItems.push(item);
        } else {
            appBudget = -1;
            overflowItems.push(item);
        }
    }

    _keepFocusedOnPanel(normalItems, overflowItems);
    return { normalItems: _insertOverflowSlot(_trimSeparators(normalItems)), overflowItems };
}

function _keysOf(items) {
    return items.map(item => item.key).join('|');
}

function _syncOverflowMenu(dockUI, overflowItems) {
    let menu = dockUI.overflowMenu;

    if (overflowItems.length === 0) {
        if (menu) {
            menu.destroy();
            dockUI.overflowMenu = null;
        }
        dockUI._overflowKeys = '';
        return;
    }

    if (menu && (menu.isStale() || !menu.button || !isActorAlive(menu.button))) {
        menu.destroy();
        menu = null;
        dockUI.overflowMenu = null;
    }
    if (!menu) {
        menu = new DockOverflowMenu(dockUI);
        dockUI.overflowMenu = menu;
    }

    menu.setItems(overflowItems);
    dockUI._overflowKeys = menu.keys;
}

export function syncRunningStates(dockUI, force = false) {
    if (!isActorAlive(dockUI.boxActor)) return;

    const desiredState = _computeDesiredState(dockUI);

    for (let i = 0; i < desiredState.length; i++) {
        const item = desiredState[i];
        const meta = dockUI._actorRegistry.get(item.key);
        if (!meta || !isActorAlive(meta.actor) || !meta.actor._updateRunningState) continue;

        if (item.type === 'app') {
            if (!force && meta.isRunning === item.isRunning && meta.isFocused === item.isFocused && meta.windowCount === item.windowCount) continue;
            meta.isRunning = item.isRunning;
            meta.isFocused = item.isFocused;
            meta.windowCount = item.windowCount;
            meta.actor._updateRunningState(item.isRunning, item.windows, item.isFocused);
        } else if (item.type === 'folder' || item.type === 'module') {
            meta.actor._updateRunningState();
        }
    }
}

export function isDockLayoutUnchanged(dockUI) {
    const { normalItems, overflowItems } = _partitionForOverflow(dockUI, _computeDesiredState(dockUI));
    return _keysOf(normalItems) === dockUI._currentOrder.join('|') &&
        _keysOf(overflowItems) === dockUI._overflowKeys;
}

export function syncOverflowWithPanel(dockUI) {
    if (!Settings.hybridPanelMode || !isActorAlive(dockUI.actor) || dockUI._isRendering) return;
    if (!isDockLayoutUnchanged(dockUI)) dockUI.queueRender('incremental', true);
}

function _captureMagnifierVisuals(dockUI) {
    const visuals = new Map();
    const [px, py] = global.get_pointer();
    if (!Settings.hoverZoom || !dockUI.actor._isZoomActive ||
        !isPointerWithinDockBounds(dockUI.actor, px, py, _isVerticalDock(dockUI), dockUI.settings)) {
        return visuals;
    }

    const remember = actor => {
        const id = extractActorId(actor);
        if (!id) return;
        visuals.set(id, {
            scaleX: actor.scale_x,
            scaleY: actor.scale_y,
            translationX: actor.translation_x,
            translationY: actor.translation_y,
        });
    };

    dockUI.boxActor.get_children().forEach(remember);
    if (dockUI.gridBtn) remember(dockUI.gridBtn);
    if (dockUI.extractedClock) remember(dockUI.extractedClock);
    return visuals;
}

function _destroyDetachedButton(dockUI, propName) {
    const btn = dockUI[propName];
    dockUI[propName] = null;
    if (isActorAlive(btn)) {
        if (btn.get_parent() === dockUI.actor) {
            dockUI.actor.remove_child(btn);
        }
        markActorDisposed(btn);
        btn.destroy();
    }
}

function _modButtonName(modBtn) {
    return (modBtn._delegate && modBtn._delegate.app && modBtn._delegate.app.get_name)
        ? modBtn._delegate.app.get_name()
        : '';
}

function _resolveModuleActor(item, sysModulesMap) {
    if (item.entity === 'custom' && item.folderData) {
        const targetName = item.folderData.name || '';
        const match = item.key ? item.key.match(/custom-(\d+)/) : null;
        const targetIdx = match ? parseInt(match[1], 10) : -1;
        for (const [modId, modBtn] of sysModulesMap.entries()) {
            const btnName = _modButtonName(modBtn);
            if ((targetIdx >= 0 && modBtn._customFolderIndex === targetIdx) || (targetName && btnName === targetName)) {
                sysModulesMap.delete(modId);
                return modBtn;
            }
        }
        return null;
    }

    if (item.entity === 'mounts' && item.mountRef) {
        const targetName = item.mountRef.get_name();
        for (const [modId, modBtn] of sysModulesMap.entries()) {
            if (_modButtonName(modBtn) === targetName) {
                sysModulesMap.delete(modId);
                return modBtn;
            }
        }
        return null;
    }

    for (const [modId, modBtn] of sysModulesMap.entries()) {
        if (modId.includes(item.entity) || item.key.includes(modId.replace('dhruva-module-', ''))) {
            sysModulesMap.delete(modId);
            return modBtn;
        }
    }

    if (sysModulesMap.size > 0) {
        const firstKey = sysModulesMap.keys().next().value;
        const actor = sysModulesMap.get(firstKey);
        sysModulesMap.delete(firstKey);
        return actor;
    }

    return null;
}

function _buildItemActor(dockUI, item, iconSize, isVerticalDock, modsContext) {
    switch (item.type) {
        case 'app': {
            const btn = buildAppButton(dockUI, item.entity, item.isRunning, item.windows || [], item.isFocused);
            btn._updateRunningState(item.isRunning, item.windows || [], item.isFocused);
            return btn;
        }
        case 'folder': {
            const btn = buildFolderButton(dockUI, item.entity);
            btn._updateRunningState();
            return btn;
        }
        case 'overflow':
            return dockUI.overflowMenu.button;
        case 'separator':
            return createSeparator(dockUI, iconSize, isVerticalDock, item.sepKind, item.key);
        case 'grid':
            return modsContext.gridBtn;
        case 'clock':
            return modsContext.clockModule;
        case 'desktop':
            return modsContext.desktopModule;
        case 'module':
            return _resolveModuleActor(item, modsContext.sysModulesMap);
        case 'music-pill':
            if (!dockUI._musicPill) {
                dockUI._musicPill = new MusicPill(dockUI, dockUI.settings);
            }
            dockUI._musicPill._isStatic = true;
            dockUI._musicPill._isMusicPill = true;
            return dockUI._musicPill;
        default:
            return null;
    }
}

function _renderDockFull(dockUI, transition) {
    const { normalItems, overflowItems } = _partitionForOverflow(dockUI, _computeDesiredState(dockUI));
    if (transition) releaseRemovedItems(dockUI, transition, new Set(normalItems.map(item => item.key)));
    dockUI._draggedOutKey = null;

    const magnifierVisuals = _captureMagnifierVisuals(dockUI);

    if (isActorAlive(dockUI.boxActor)) {
        const children = dockUI.boxActor.get_children();
        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (isActorAlive(c)) {
                dockUI.boxActor.remove_child(c);
                if (c !== dockUI._musicPill && !c._isExternal && !c._isOverflowBtn) {
                    markActorDisposed(c);
                    c.destroy();
                }
            }
        }
    }

    _destroyDetachedButton(dockUI, 'gridBtn');
    _destroyDetachedButton(dockUI, 'extractedClock');
    _destroyDetachedButton(dockUI, 'extractedDesktop');

    dockUI._actorRegistry.clear();
    dockUI._currentOrder = [];

    const iconSize = Settings.iconSize;
    const isVerticalDock = _isVerticalDock(dockUI);

    const mods = buildModules(dockUI, iconSize);
    const clockModule = mods.clockModule || null;
    const gridBtn = mods.gridModule || null;
    const desktopModule = mods.desktopModule || null;

    const sysModulesMap = new Map();
    if (Array.isArray(mods.systemModules)) {
        for (let i = 0; i < mods.systemModules.length; i++) {
            const modBtn = mods.systemModules[i];
            const id = (modBtn._delegate && modBtn._delegate.app && modBtn._delegate.app.get_id)
                ? modBtn._delegate.app.get_id()
                : null;
            if (id) sysModulesMap.set(id, modBtn);
        }
    }

    if (gridBtn) {
        gridBtn._entityId = 'dhruva-grid-button';
    }
    if (clockModule) clockModule._entityId = 'dhruva-clock';
    if (desktopModule) {
        desktopModule._entityId = 'dhruva-desktop-module';
        desktopModule._isDesktopBtn = true;
    }
    dockUI.gridBtn = gridBtn;

    const isPanelOrFull = isPanelOrFullWidth();
    if (isPanelOrFull && Settings.showDesktopButton && desktopModule) {
        dockUI.extractedDesktop = desktopModule;
        const currentParent = desktopModule.get_parent();
        if (currentParent && currentParent !== dockUI.actor) {
            currentParent.remove_child(desktopModule);
        }
        if (desktopModule.get_parent() !== dockUI.actor) {
            dockUI.actor.add_child(desktopModule);
        }
        dockUI.actor.set_child_above_sibling(desktopModule, null);
        desktopModule.show();
        desktopModule.opacity = 255;
    } else if (desktopModule && (!Settings.showDesktopButton || isPanelOrFull) && isActorAlive(desktopModule)) {
        markActorDisposed(desktopModule);
        desktopModule.destroy();
    }

    _syncOverflowMenu(dockUI, overflowItems);

    const modsContext = { clockModule, gridBtn, desktopModule, sysModulesMap };

    for (let i = 0; i < normalItems.length; i++) {
        const item = normalItems[i];
        const actor = _buildItemActor(dockUI, item, iconSize, isVerticalDock, modsContext);
        if (!actor) continue;

        actor._entityId = item.key;
        const visual = magnifierVisuals.get(item.key);
        if (visual) {
            actor.set_scale(visual.scaleX, visual.scaleY);
            actor.translation_x = visual.translationX;
            actor.translation_y = visual.translationY;

            const sx = visual.scaleX || 1.0;
            const sy = visual.scaleY || 1.0;
            if (Math.abs(sx - 1.0) > 0.001 || Math.abs(sy - 1.0) > 0.001) {
                counterScaleButtonIndicators(actor, dockUI.dockPosition);
            }
        }
        actor.opacity = 255;

        dockUI.boxActor.add_child(actor);
        dockUI._actorRegistry.set(item.key, {
            actor,
            type: item.type,
            entity: item.entity,
            isRunning: item.isRunning,
            isFocused: item.isFocused,
            windowCount: item.windowCount,
        });
    }

    dockUI._currentOrder = normalItems.map(i => i.key);
    _cacheItemSpans(dockUI);

    if (dockUI.actor) {
        dockUI.actor._structureChanged = true;
        dockUI.actor._fixedSlots = null;
    }
}

function _applyMagnifierFrameOrReset(dockUI, isVerticalDock, checkPointerBounds) {
    const focusWin = global.display.get_focus_window();
    if (focusWin && focusWin.is_fullscreen && focusWin.is_fullscreen()) {
        resetMagnification(dockUI.actor);
        return;
    }

    const [cx, cy] = global.get_pointer();
    if (!checkPointerBounds || isPointerWithinDockBounds(dockUI.actor, cx, cy, isVerticalDock, dockUI.settings)) {
        applyRealtimeFrame(dockUI.actor, cx, cy, isVerticalDock, dockUI.settings, Date.now());
    } else {
        resetMagnification(dockUI.actor);
    }
}

function _syncMagnifierAndPivots(dockUI) {
    const hoverZoom = Settings.hoverZoom;
    const showTooltips = Settings.showAppsPreview;
    const isVerticalDock = _isVerticalDock(dockUI);

    if (dockUI._magnifierSetupIdleId) {
        dockUI.registry.remove(dockUI._magnifierSetupIdleId);
        dockUI._magnifierSetupIdleId = 0;
    }

    if (!hoverZoom && !showTooltips) {
        teardownMagnification(dockUI.actor);
        dockUI.actor._isMagSetup = false;
        return;
    }

    for (const child of dockUI.boxActor.get_children()) {
        if (!_styleClassOf(child).includes('dock-separator')) setEdgePivot(child, dockUI.dockPosition);
    }
    if (dockUI.gridBtn) setEdgePivot(dockUI.gridBtn, dockUI.dockPosition);

    if (!dockUI.actor._isMagSetup) {
        dockUI._magnifierSetupIdleId = dockUI.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            dockUI._magnifierSetupIdleId = 0;
            if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor) || !dockUI.actor.is_mapped()) {
                return GLib.SOURCE_REMOVE;
            }

            setupMagnification(dockUI.actor, dockUI.settings, () => dockUI.dockPosition);
            dockUI.actor._isMagSetup = true;
            dockUI.actor._fixedSlots = null;

            _applyMagnifierFrameOrReset(dockUI, isVerticalDock, true);
            return GLib.SOURCE_REMOVE;
        });
    } else {
        _applyMagnifierFrameOrReset(dockUI, isVerticalDock, false);
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

    if (mode !== 'full' && dockUI.actor._lastIconClickTime) {
        const elapsed = Date.now() - dockUI.actor._lastIconClickTime;
        if (elapsed < POST_CLICK_DELAY_MS && isDockLayoutUnchanged(dockUI)) {
            dockUI._pendingRender = false;
            if (dockUI._updateRunningStatesFast) dockUI._updateRunningStatesFast();

            if (dockUI._delayedRenderId) {
                dockUI.registry.remove(dockUI._delayedRenderId);
                dockUI._delayedRenderId = 0;
            }
            dockUI._delayedRenderId = dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, POST_CLICK_DELAY_MS - elapsed, () => {
                dockUI._delayedRenderId = 0;
                if (dockUI.queueRender) dockUI.queueRender(mode, true);
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

    if (dockUI._delayedRenderId) {
        dockUI.registry.remove(dockUI._delayedRenderId);
        dockUI._delayedRenderId = 0;
    }

    const transition = mode === 'full' ? null : captureDockTransition(dockUI);
    _renderDockFull(dockUI, transition);
    if (transition) dockUI.actor._flipAnimating = true;

    dockUI.actor._fixedSlots = null;
    dockUI.actor._tooltipHoveredIndex = -1;
    dockUI.actor._magTooltipAppId = null;

    applyDynamicStyles(dockUI);
    updateLayout(dockUI);
    if (dockUI.dockManager) dockUI.dockManager.updatePosition();
    _syncMagnifierAndPivots(dockUI);
    if (transition) playDockTransition(dockUI, transition);

    dockUI._initialLayoutDone = true;
    dockUI._isRendering = false;

    if (dockUI._pendingRender) {
        dockUI._pendingRender = false;
        if (dockUI._pendingRenderIdleId) {
            dockUI.registry.remove(dockUI._pendingRenderIdleId);
            dockUI._pendingRenderIdleId = 0;
        }
        dockUI._pendingRenderIdleId = dockUI.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            dockUI._pendingRenderIdleId = 0;
            renderDock(dockUI, dockUI._pendingRenderState ? dockUI._pendingRenderState.mode : 'incremental', false);
            return GLib.SOURCE_REMOVE;
        });
    }
}

export function cleanupDockRenderer(dockUI) {
    if (dockUI && dockUI.registry) {
        if (dockUI.actor && dockUI.actor._launchTimeoutId) {
            dockUI.registry.remove(dockUI.actor._launchTimeoutId);
            dockUI.actor._launchTimeoutId = 0;
        }
        if (dockUI._magnifierSetupIdleId) {
            dockUI.registry.remove(dockUI._magnifierSetupIdleId);
            dockUI._magnifierSetupIdleId = 0;
        }
        if (dockUI._delayedRenderId) {
            dockUI.registry.remove(dockUI._delayedRenderId);
            dockUI._delayedRenderId = 0;
        }
        if (dockUI._pendingRenderIdleId) {
            dockUI.registry.remove(dockUI._pendingRenderIdleId);
            dockUI._pendingRenderIdleId = 0;
        }
    }
}