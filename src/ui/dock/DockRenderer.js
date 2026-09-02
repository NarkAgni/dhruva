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


import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { buildModules } from '../modules/DockModules.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import { applyDynamicStyles, resolveTooltipColors } from './DockThemeResolver.js';
import { createSeparator, buildAppButton, buildFolderButton } from './DockItemBuilder.js';
import { isActorAlive, markActorDisposed, updateLayout, captureActorRect } from './DockLayoutEngine.js';
import { setupMagnification, teardownMagnification, applyRealtimeFrame, resetMagnification } from '../magnifier/Magnifier.js';


export { isActorAlive, captureActorRect, updateLayout, applyDynamicStyles, resolveTooltipColors };


export function getIndicatorProps(dockUI) {
    const indStyle = dockUI.settings.get_string('indicator-style') || 'dot';
    const indSize = dockUI.settings.get_int('indicator-size') || 4;
    const indGap = dockUI.settings.get_int('indicator-spacing') || 4;
    const indGlow = dockUI.settings.get_boolean('indicator-glow');
    const isVert = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const iconSize = dockUI.settings.get_int('icon-size') || 48;
    const hoverZoom = dockUI.settings.get_boolean('hover-zoom'); 

    const currentTheme = dockUI.settings.get_string('dock-theme') || 'default';
    const indColor = (currentTheme === 'chameleon' && dockUI._chameleonAccent)
        ? dockUI._chameleonAccent
        : (dockUI.settings.get_string('indicator-color') || '#ffffff');

    let dw = indSize, dh = indSize, br = '100px';

    if (indStyle === 'square') {
        br = '2px';
    } else if (indStyle === 'dash' || indStyle === 'line') {
        const heightPad = dockUI.settings.get_int('dock-height') || 6;
        const safeHeightPad = Math.max(heightPad, 4);
        const squareSize = hoverZoom ? iconSize : (iconSize + safeHeightPad * 2); 
        const len = indStyle === 'line' ? squareSize : Math.max(12, indSize * 2.5);
        const thick = Math.max(2, Math.floor(indSize / (indStyle === 'line' ? 1.5 : 1.2)));
        dw = isVert ? thick : len;
        dh = isVert ? len : thick;
        br = '0px';
    }
    
    const heightPad = dockUI.settings.get_int('dock-height') || 6;
    const safeHeightPad = Math.max(heightPad, 4);

    let tx = 0, ty = 0;
    if (dockUI.dockPosition === 'BOTTOM') ty = safeHeightPad;
    else if (dockUI.dockPosition === 'TOP') ty = -safeHeightPad;
    else if (dockUI.dockPosition === 'LEFT') tx = -safeHeightPad;
    else if (dockUI.dockPosition === 'RIGHT') tx = safeHeightPad;

    let iconTx = 0, iconTy = 0;
    if (dockUI.settings.get_boolean('show-running-indicators')) {
        const padding = safeHeightPad; 
        const indThickness = isVert ? dw : dh;
        const shiftAmt = Math.max(0, indThickness + indGap - padding);

        if (dockUI.dockPosition === 'BOTTOM') iconTy = -shiftAmt;
        else if (dockUI.dockPosition === 'TOP') iconTy = shiftAmt;
        else if (dockUI.dockPosition === 'LEFT') iconTx = shiftAmt;
        else if (dockUI.dockPosition === 'RIGHT') iconTx = -shiftAmt;
    }

    const shadowStr = indGlow ? `box-shadow: 0px 0px 8px ${indColor}CC;` : '';
    const style = `width: ${dw}px; height: ${dh}px; background-color: ${indColor}; border-radius: ${br}; ${shadowStr}`;

    return { dw, dh, style, tx, ty, iconTx, iconTy, indColor };
}

export function renderDock(dockUI, forceRender = false) {
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
        if (elapsed < 350) {
            dockUI._pendingRender = false;
            
            if (dockUI._delayedRenderId) {
                dockUI.registry.remove(dockUI._delayedRenderId);
                dockUI._delayedRenderId = null;
            }
            dockUI._delayedRenderId = dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, 850 - elapsed + 10, () => {
                dockUI._delayedRenderId = null;
                if (dockUI.queueRender) dockUI.queueRender();
                return GLib.SOURCE_REMOVE;
            });

            return;
        }
    }

    dockUI._pendingRender = false;

    const oldVisuals = new Map();
    const cacheActor = (c) => {
        if (!c) return;
        let id = null;
        if (c._delegate && c._delegate.app && c._delegate.app.get_id) id = c._delegate.app.get_id();
        else if (c._delegate && c._delegate.isFolder) id = c._delegate.folderData.id;
        else if (c.has_style_class_name && c.has_style_class_name('clock-module')) id = 'dhruva-clock';
        else if (c.get_child && c.get_child() && c.get_child().has_style_class_name && c.get_child().has_style_class_name('dock-grid-icon')) id = 'dhruva-grid-button';
        else if (c.has_style_class_name && c.has_style_class_name('dock-separator')) id = c._sepId;

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

    const gridBtnOnActor = dockUI.gridBtn && dockUI.gridBtn.get_parent() === dockUI.actor;
    if (isActorAlive(dockUI.boxActor)) {
        const children = dockUI.boxActor.get_children();
        children.forEach(c => {
            if (isActorAlive(c)) {
                dockUI.boxActor.remove_child(c);
                if (!c._isModule && !c._isExternal) {
                    c.destroy();
                }
            }
        });
    }

    if (dockUI.gridBtn) {
        const btn = dockUI.gridBtn;
        dockUI.gridBtn = null;
        if (gridBtnOnActor) btn.destroy();
    }

    const clockBtnOnActor = dockUI.extractedClock && dockUI.extractedClock.get_parent() === dockUI.actor;
    if (dockUI.extractedClock) {
        const btn = dockUI.extractedClock;
        dockUI.extractedClock = null;
        if (clockBtnOnActor) btn.destroy();
    }

    const desktopBtnOnActor = dockUI.extractedDesktop && dockUI.extractedDesktop.get_parent() === dockUI.actor;
    if (dockUI.extractedDesktop) {
        const btn = dockUI.extractedDesktop;
        dockUI.extractedDesktop = null;
        if (desktopBtnOnActor) btn.destroy();
    }

    const displayAppsRaw = dockUI.appManager.getDisplayApps();
    let displayApps = displayAppsRaw;

    const folders = (dockUI.folderManager && dockUI.folderManager.getFolders()) || [];
    const appsInFolders = new Set();
    folders.forEach(f => f.apps.forEach(appId => appsInFolders.add(appId)));

    if (dockUI._ignoringApps && dockUI._ignoringApps.size > 0) {
        displayApps = displayAppsRaw.filter(app => {
            if (!app.get_id) return true;
            if (dockUI.appManager.hasApp(app)) return true;
            return !dockUI._ignoringApps.has(app.get_id());
        });
    }

    displayApps = displayApps.filter(app => !appsInFolders.has(app.get_id ? app.get_id() : ''));

    const iconSize = dockUI.settings.get_int('icon-size');
    const hoverZoom = dockUI.settings.get_boolean('hover-zoom');
    const showTooltips = dockUI.settings.get_boolean('show-apps-preview');
    const isFullWidth = dockUI.settings.get_boolean('full-width');
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    const indPropsGlobal = getIndicatorProps(dockUI);
    const pinnedButtons = [];
    const unpinnedButtons = [];

    displayApps.forEach(app => {
        let isRunning = app.get_state() === Shell.AppState.RUNNING;
        let finalActiveWindows = WorkspaceFilter.filterWindows(app.get_windows(), dockUI.settings);

        if (dockUI.settings.get_boolean('isolate-monitors')) {
            const currentMonitorIndex = dockUI.monitorManager.getCurrentMonitor().index;
            finalActiveWindows = finalActiveWindows.filter(w => w.get_monitor() === currentMonitorIndex);
        }

        if ((dockUI.settings.get_boolean('isolate-workspaces') || dockUI.settings.get_boolean('isolate-monitors')) && finalActiveWindows.length === 0) {
            isRunning = false;
        }

        if (dockUI._ignoringApps && app.get_id && dockUI._ignoringApps.has(app.get_id())) {
            isRunning = false;
        }

        const btn = buildAppButton(dockUI, app, isRunning, finalActiveWindows, indPropsGlobal);
        if (dockUI.appManager.hasApp(app)) pinnedButtons.push(btn);
        else unpinnedButtons.push(btn);
    });

    folders.forEach(folder => {
        const btn = buildFolderButton(dockUI, folder, indPropsGlobal);
        pinnedButtons.push(btn);
    });

    const mods = buildModules(dockUI, iconSize);
    const systemModules = mods.systemModules || [];
    const clockModule = mods.clockModule || null;
    const gridBtn = mods.gridModule || null;
    const desktopModule = mods.desktopModule || null;

    dockUI.gridBtn = gridBtn;

    const startComponents = [];
    const endComponents = [];

    const rawGridPos = dockUI.settings.get_string('grid-button-position') || 'END';
    const gridPos = (rawGridPos === 'LEFT_EDGE' && !isFullWidth) ? 'START' : rawGridPos;

    const rawClockPos = dockUI.settings.get_string('clock-position') || 'END';
    const clockPos = (rawClockPos === 'RIGHT_END' && !isFullWidth) ? 'END' : rawClockPos;

    const showClock = !dockUI._isOverviewActive;

    const extractClock = isFullWidth && clockPos === 'RIGHT_END';
    dockUI.extractedClock = (extractClock && showClock) ? clockModule : null;

    dockUI.extractedDesktop = isFullWidth ? desktopModule : null;

    const extractGrid = isFullWidth && gridPos === 'LEFT_EDGE';
    dockUI.gridBtn = extractGrid ? gridBtn : null;

    if (!extractClock && clockPos === 'START' && clockModule && showClock) {
        startComponents.push(clockModule);
    }

    if (startComponents.length > 0 && dockUI.settings.get_boolean('show-module-separator')) {
        startComponents.push(createSeparator(dockUI, iconSize, isVerticalDock, 'module', 'dhruva-sep-start'));
    }

    if (gridPos === 'START' && gridBtn && !extractGrid) {
        startComponents.push(gridBtn);
    }

    const actualEndItems = [];
    
    if (!isFullWidth && desktopModule) {
        actualEndItems.push(desktopModule);
    }
    
    actualEndItems.push(...systemModules);
    
    if (gridPos === 'END' && gridBtn && !extractGrid) {
        actualEndItems.push(gridBtn);
    }

    if (actualEndItems.length > 0) {
        if (dockUI.settings.get_boolean('show-module-separator')) {
            endComponents.push(createSeparator(dockUI, iconSize, isVerticalDock, 'module', 'dhruva-sep-end'));
        }
        actualEndItems.forEach(i => endComponents.push(i));
    }

    if (!extractClock && clockPos !== 'START' && clockModule && showClock) {
        if (dockUI.settings.get_boolean('show-module-separator')) {
            endComponents.push(createSeparator(dockUI, iconSize, isVerticalDock, 'module', 'dhruva-sep-clock'));
        }
        endComponents.push(clockModule);
    }

    const applyOldVisuals = (c) => {
        let cid = null;
        if (c._delegate && c._delegate.app && c._delegate.app.get_id) cid = c._delegate.app.get_id();
        else if (c._isFolder) cid = c._folderData.id;
        else if (c.has_style_class_name && c.has_style_class_name('clock-module')) cid = 'dhruva-clock';
        else if (c.get_child && c.get_child() && c.get_child().has_style_class_name && c.get_child().has_style_class_name('dock-grid-icon')) cid = 'dhruva-grid-button';
        else if (c.has_style_class_name && c.has_style_class_name('dock-separator')) cid = c._sepId;

        if (cid && oldVisuals.has(cid)) {
            const v = oldVisuals.get(cid);
            c.scale_x = v.sx !== undefined ? v.sx : 1.0;
            c.scale_y = v.sy !== undefined ? v.sy : 1.0;
            c.translation_x = v.tx !== undefined ? v.tx : 0;
            c.translation_y = v.ty !== undefined ? v.ty : 0;

            const appBox = c.get_child ? c.get_child() : null;
            if (appBox && appBox.get_children) {
                appBox.get_children().forEach(child => {
                    const antiScale = 1.0 / Math.max(0.01, c.scale_x);
                    if (child._isIndicator) {
                        let px = 0.5, py = 0.5;
                        if (dockUI.dockPosition === 'BOTTOM') py = 1.0;
                        else if (dockUI.dockPosition === 'TOP') py = 0.0;
                        else if (dockUI.dockPosition === 'LEFT') px = 0.0;
                        else if (dockUI.dockPosition === 'RIGHT') px = 1.0;
                        child.set_pivot_point(px, py);
                        child.scale_x = antiScale * (child._baseScaleX || 1.0);
                        child.scale_y = antiScale * (child._baseScaleY || 1.0);
                    }
                    child.translation_x = (child._baseTx || 0) * antiScale;
                    child.translation_y = (child._baseTy || 0) * antiScale;
                });
            }
        }
    };

    startComponents.forEach(c => { applyOldVisuals(c); dockUI.boxActor.add_child(c); });
    pinnedButtons.forEach(c => { applyOldVisuals(c); dockUI.boxActor.add_child(c); });

    if (pinnedButtons.length > 0 && unpinnedButtons.length > 0) {
        if (dockUI.settings.get_boolean('show-app-separator')) {
            dockUI.boxActor.add_child(createSeparator(dockUI, iconSize, isVerticalDock, 'running', 'dhruva-sep-running'));
        }
    }

    unpinnedButtons.forEach(c => { applyOldVisuals(c); dockUI.boxActor.add_child(c); });
    endComponents.forEach(c => { applyOldVisuals(c); dockUI.boxActor.add_child(c); });

    if (dockUI.dockManager && dockUI.dockManager._externalActors) {
        const externals = dockUI.dockManager._externalActors;
        Array.from(externals).forEach(extActor => {
            if (!isActorAlive(extActor)) {
                externals.delete(extActor);
                return;
            }
            try {
                applyOldVisuals(extActor);
                const parent = extActor.get_parent();
                if (parent && parent !== dockUI.boxActor) return;
                if (!parent) dockUI.boxActor.add_child(extActor);
            } catch (_e) {
                markActorDisposed(extActor);
                externals.delete(extActor);
            }
        });
    }

    if (isFullWidth && dockUI.gridBtn) {
        applyOldVisuals(dockUI.gridBtn);
        dockUI.actor.add_child(dockUI.gridBtn);
    }

    if (isFullWidth && dockUI.extractedClock) {
        applyOldVisuals(dockUI.extractedClock);
        dockUI.actor.add_child(dockUI.extractedClock);
    }

    if (isFullWidth && dockUI.extractedDesktop) {
        applyOldVisuals(dockUI.extractedDesktop);
        dockUI.actor.add_child(dockUI.extractedDesktop);
    }

    const hasAnyModuleIndicator = systemModules.some(m => m && m._hasRunningIndicator);
    dockUI._applyIndicatorBaselineAlignment(hasAnyModuleIndicator);

    dockUI.actor._fixedSlots = null;
    dockUI.actor._tooltipHoveredIndex = -1;
    dockUI.actor._magTooltipAppId = null;

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
                if (!dockUI.actor || !dockUI.boxActor) return GLib.SOURCE_REMOVE;

                if (setupMagnification) {
                    setupMagnification(dockUI.actor, dockUI.settings, () => dockUI.dockPosition);
                }

                global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    if (!dockUI.actor || !dockUI.boxActor || !dockUI.actor.is_mapped()) return false;

                    const focusWin = global.display.get_focus_window();
                    if (focusWin && focusWin.is_fullscreen && focusWin.is_fullscreen()) {
                        resetMagnification(dockUI.actor);
                        return false;
                    }

                    dockUI.actor._fixedSlots = null;
                    const [cx, cy] = global.get_pointer();
                    const [ax, ay] = dockUI.actor.get_transformed_position();

                    const aw = dockUI.actor._cachedW || dockUI.actor.width || 0;
                    const ah = dockUI.actor._cachedH || dockUI.actor.height || 0;

                    const basePadX = isVerticalDock ? 15 : 20;
                    const basePadY = isVerticalDock ? 20 : 15;
                    const inBaseBounds = cx >= ax - basePadX && cx <= ax + aw + basePadX && cy >= ay - basePadY && cy <= ay + ah + basePadY;

                    let inZoomedBounds = false;
                    if (!inBaseBounds && dockUI.boxActor) {
                        const iconSize = dockUI.settings.get_int('icon-size') || 48;
                        const zoomFactor = dockUI.settings.get_double('hover-zoom-factor') || 1.0;
                        const maxPadding = (iconSize * zoomFactor) + 20;
                        
                        inZoomedBounds = cx >= ax - maxPadding && cx <= ax + aw + maxPadding && cy >= ay - maxPadding && cy <= ay + ah + maxPadding;
                    }
                    
                    if (inBaseBounds || inZoomedBounds) {
                        applyRealtimeFrame(dockUI.actor, cx, cy, isVerticalDock, dockUI.settings, Date.now());
                    } else {
                        resetMagnification(dockUI.actor);
                    }

                    return false;
                });
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
    }

    applyDynamicStyles(dockUI);
    updateLayout(dockUI);
}