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

import { isActorAlive } from '../Utils.js';
import { isWindowHidden } from '../Compat.js';
import { rectsIntersect } from './AutoHideGeometry.js';


const DODGEABLE_WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

export function isWindowMaximized(win) {
    return (win.maximized_horizontally && win.maximized_vertically) || win.is_fullscreen();
}

export function getVisibleMonitorWindows(dockUI) {
    const activeWs = global.workspace_manager.get_active_workspace();
    if (!activeWs) return [];

    const monitorResult = dockUI.monitorManager.getCurrentMonitor();
    const monitorIndex = monitorResult ? monitorResult.index : 0;

    return global.display.get_tab_list(Meta.TabList.NORMAL, activeWs).filter(win =>
        !win.minimized &&
        !isWindowHidden(win) &&
        win.get_monitor() === monitorIndex
    );
}

export class WindowOverlapDetection {
    constructor(dockUI) {
        this.dockUI = dockUI;
    }

    getDockRect() {
        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return null;
        const actor = this.dockUI.actor;
        const [x, y] = actor.get_position();
        return { x, y, width: actor.width, height: actor.height };
    }

    shouldHide(mode) {
        if (mode === 'none') return false;
        if (mode === 'always') return true;

        const dockRect = this.getDockRect();
        if (!dockRect) return false;

        const focusWindow = global.display.get_focus_window();

        return getVisibleMonitorWindows(this.dockUI).some(win => {
            if (!DODGEABLE_WINDOW_TYPES.has(win.get_window_type())) return false;

            const isMaximized = isWindowMaximized(win);
            if (mode === 'maximized') return isMaximized;

            const dodgesWindow = mode === 'dodge-all' || (mode === 'intelligent' && win === focusWindow);
            return dodgesWindow && (isMaximized || rectsIntersect(this.dockUI.dockPosition, dockRect, win.get_frame_rect()));
        });
    }
}