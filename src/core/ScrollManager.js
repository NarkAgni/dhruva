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


import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Settings } from './SettingsManager.js';


function scrollStep(event) {
    const dir = event.get_scroll_direction();
    if (dir === Clutter.ScrollDirection.UP) return -1;
    if (dir === Clutter.ScrollDirection.DOWN) return 1;
    return 0;
}

function cycleAppWindows(windows, step) {
    if (windows.length === 0) return;

    const idx = Math.max(0, windows.indexOf(global.display.get_focus_window()));
    const target = windows.length < 2 ? windows[0] : windows[(idx + step + windows.length) % windows.length];

    target.unminimize();
    Main.activateWindow(target);
}

export default class ScrollManager {
    static setupDockScroll(dockUI) {
        dockUI.actor.connectObject('scroll-event', (actor, event) => {
            actor._lastIconClickTime = Date.now();

            const step = scrollStep(event);
            if (!Settings.scrollActionDock || step === 0) return Clutter.EVENT_PROPAGATE;

            const wm = global.workspace_manager;
            const activeIdx = wm.get_active_workspace_index();
            const nextIdx = Math.max(0, Math.min(wm.get_n_workspaces() - 1, activeIdx + step));

            if (nextIdx === activeIdx) return Clutter.EVENT_PROPAGATE;

            wm.get_workspace_by_index(nextIdx).activate(global.get_current_time());
            return Clutter.EVENT_STOP;
        }, dockUI);
    }

    static setupAppScroll(appButton, getWindowsFn) {
        appButton.connectObject('scroll-event', (actor, event) => {
            const step = scrollStep(event);
            if (!Settings.scrollActionApp || step === 0) return Clutter.EVENT_PROPAGATE;

            const parent = actor.get_parent();
            const mainDockActor = parent ? parent.get_parent() : null;
            if (mainDockActor) mainDockActor._lastIconClickTime = Date.now();

            cycleAppWindows(getWindowsFn(), step);
            return Clutter.EVENT_STOP;
        }, appButton);
    }
}