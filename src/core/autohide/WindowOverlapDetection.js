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


export class WindowOverlapDetection {
    constructor(dockUI) {
        this.dockUI = dockUI;
    }

    getDockRect() {
        if (!this.dockUI || !this.dockUI.actor) return null;
        const [x, y] = this.dockUI.actor.get_position();
        const w = this.dockUI.actor.width;
        const h = this.dockUI.actor.height;
        return { x, y, width: w, height: h };
    }

    rectsIntersect(r1, r2, tolerance = 16) {
        const pos = this.dockUI.dockPosition;
        let left = r1.x;
        let right = r1.x + r1.width;
        let top = r1.y;
        let bottom = r1.y + r1.height;

        if (pos === 'BOTTOM') {
            top -= tolerance;
        } else if (pos === 'TOP') {
            bottom += tolerance;
        } else if (pos === 'LEFT') {
            right += tolerance;
        } else if (pos === 'RIGHT') {
            left -= tolerance;
        }

        return !(
            r2.x >= right ||
            (r2.x + r2.width) <= left ||
            r2.y >= bottom ||
            (r2.y + r2.height) <= top
        );
    }

    shouldHide(mode) {
        if (mode === 'none') return false;
        if (mode === 'always') return true;

        const dockRect = this.getDockRect();
        if (!dockRect) return false;

        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        const curMonitorIdx = monitorResult ? monitorResult.index : 0;

        const activeWs = global.workspace_manager.get_active_workspace();
        if (!activeWs) return false;

        const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, activeWs);
        const focusWindow = global.display.get_focus_window();

        for (let i = 0; i < allWindows.length; i++) {
            const win = allWindows[i];
            if (!win) continue;

            if (win.minimized || !win.is_hidden && win.is_hidden()) continue;
            if (win.get_monitor() !== curMonitorIdx) continue;

            const winType = win.get_window_type();
            if (winType !== Meta.WindowType.NORMAL && winType !== Meta.WindowType.DIALOG && winType !== Meta.WindowType.MODAL_DIALOG) {
                continue;
            }

            const winRect = win.get_frame_rect();

            if (mode === 'maximized') {
                const isMax = (win.maximized_horizontally && win.maximized_vertically) || win.is_fullscreen();
                if (isMax) return true;
            }

            if (mode === 'intelligent') {
                if (win === focusWindow) {
                    const isMax = (win.maximized_horizontally && win.maximized_vertically) || win.is_fullscreen();
                    if (isMax || this.rectsIntersect(dockRect, winRect, 16)) {
                        return true;
                    }
                }
            }

            if (mode === 'dodge-all') {
                const isMax = (win.maximized_horizontally && win.maximized_vertically) || win.is_fullscreen();
                if (isMax || this.rectsIntersect(dockRect, winRect, 16)) {
                    return true;
                }
            }
        }

        return false;
    }
}