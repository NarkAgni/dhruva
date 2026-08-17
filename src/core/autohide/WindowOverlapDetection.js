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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export function isValidWindow(_ahm, win) {
    if (!win || win.minimized || win.unmanaging) return false;
    
    if (win.is_skip_taskbar()) return false;

    const type = win.get_window_type();
    if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK ||
        type === Meta.WindowType.MENU || type === Meta.WindowType.SPLASHSCREEN ||
        type === Meta.WindowType.DROPDOWN_MENU || type === Meta.WindowType.POPUP_MENU ||
        type === Meta.WindowType.OVERRIDE_OTHER || type === Meta.WindowType.TOOLTIP) {
        return false;
    }

    const wmClass = win.get_wm_class();
    if (wmClass === 'ding' || wmClass === 'DesktopUi' || wmClass === 'conky') return false;

    const ws = global.workspace_manager.get_active_workspace();
    return win.is_on_all_workspaces() || win.get_workspace() === ws;
}

export function shouldStayVisibleForTransientUI(ahm) {
    if (!ahm.dockUI || ahm.dockUI._isDestroyed) return false;
    if (Main.overview.visible && !ahm.settings.get_boolean('independent-dock')) {
        return true;
    }

    if (ahm.isPaused()) return true;
    if (ahm.dockUI._activeContextMenu || (ahm.dockUI.appGridUI && ahm.dockUI.appGridUI.isOpen)) {
        return true;
    }

    if (ahm.dockUI.shouldIgnoreAutoHide && ahm.dockUI.shouldIgnoreAutoHide()) {
        return true;
    }

    return false;
}

export function recalculateOverlap(ahm) {
    if (!ahm.dockUI || !ahm.dockUI.actor) return;

    if (ahm._shouldStayVisibleForTransientUI()) {
        ahm._pointerUpdate = false;
        ahm._updateHidden(false, false, false);
        return;
    }

    const mode = ahm._getHideMode();

    if (mode === 'none' || mode === 'never') {
        ahm._pointerUpdate = false;
        ahm._updateHidden(false, false, false);
        return;
    }
    
    if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
        ahm._pointerUpdate = false;
        ahm._updateHidden(true, true, true);
        return;
    }

    const monitorData = ahm.dockUI.monitorManager.getCurrentMonitor();
    if (!monitorData || !monitorData.monitor) return;
    const dockMonitorIndex = monitorData.index;

    const bounds = ahm._getTheoreticalDockBounds();
    const focusWin = global.display.get_focus_window();
    const activeWs = global.workspace_manager.get_active_workspace();

    let anyOverlap = false;
    let activeWinOverlap = false;
    let maximizedOverlap = false;
    let isFullscreenActive = false;

    if (activeWs) {
        const wsWindows = activeWs.list_windows();
        for (const win of wsWindows) {
            if (!win || win.minimized || win.get_monitor() !== dockMonitorIndex) continue;

            const isFS = win.is_fullscreen();
            if (isFS) {
                isFullscreenActive = true;
                break;
            }
        }
    }

    if (!isFullscreenActive && focusWin && focusWin.get_monitor() === dockMonitorIndex) {
        if (focusWin.is_fullscreen()) {
            isFullscreenActive = true;
        }
    }

    if (isFullscreenActive) {
        if (ahm.dockUI.actor) ahm.dockUI.actor._suppressZoom = true;
        ahm._pointerUpdate = false;
        ahm._updateHidden(true, true, true);
        return;
    }

    for (const wa of global.get_window_actors()) {
        const win = wa.get_meta_window();
        if (!win || !ahm._isValidWindow(win) || win.get_monitor() !== dockMonitorIndex) continue;

        const r = win.get_frame_rect();
        const overlaps = (r.x < bounds.x + bounds.width && r.x + r.width > bounds.x &&
            r.y < bounds.y + bounds.height && r.y + r.height > bounds.y);

        if (!overlaps) continue;

        anyOverlap = true;
        if (win === focusWin) activeWinOverlap = true;
        if (win.maximized_horizontally || win.maximized_vertically || win.get_window_type() === Meta.WindowType.DIALOG) {
            maximizedOverlap = true;
        }
    }

    ahm._pointerUpdate = false;
    ahm._updateHidden(anyOverlap, activeWinOverlap, maximizedOverlap);
}

export function trackFocusedWindow(ahm) {
    const focusWin = global.display.get_focus_window();
    if (ahm._trackedWin === focusWin) return;

    if (ahm._trackedWin && ahm._trackedWinSignals) {
        ahm._trackedWinSignals.forEach(id => {
            ahm._trackedWin.disconnect(id);
        });
    }

    ahm._trackedWinSignals = [];
    ahm._trackedWin = focusWin;

    if (ahm._trackedWin) {
        ahm._trackedWinSignals.push(ahm._trackedWin.connect('size-changed', () => ahm._scheduleUpdate()));
        ahm._trackedWinSignals.push(ahm._trackedWin.connect('position-changed', () => ahm._scheduleUpdate()));
        ahm._trackedWinSignals.push(ahm._trackedWin.connect('notify::maximized-vertically', () => ahm._scheduleUpdate()));
        ahm._trackedWinSignals.push(ahm._trackedWin.connect('notify::fullscreen', () => ahm._scheduleUpdate()));
    }
}