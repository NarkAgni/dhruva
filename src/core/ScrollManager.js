/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
* * This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
* * This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
* * You should have received a copy of the GNU General Public License
* along with this program. If not, see https://www.gnu.org/licenses/. 
*/


import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export default class ScrollManager {
    static setupDockScroll(dockActor, settings) {
        dockActor.connect('scroll-event', (actor, event) => {
            actor._lastIconClickTime = Date.now();
            
            try {
                if (!settings.get_boolean('scroll-action-dock')) return Clutter.EVENT_PROPAGATE;
            } catch (e) { 
                return Clutter.EVENT_PROPAGATE; 
            }

            const dir = event.get_scroll_direction();
            const wm = global.workspace_manager;
            const activeIdx = wm.get_active_workspace_index();
            let nextIdx = activeIdx;

            if (dir === Clutter.ScrollDirection.UP) {
                nextIdx = Math.max(0, activeIdx - 1);
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                nextIdx = Math.min(wm.get_n_workspaces() - 1, activeIdx + 1);
            }

            if (nextIdx !== activeIdx) {
                wm.get_workspace_by_index(nextIdx).activate(global.get_current_time());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    static setupAppScroll(appButton, getWindowsFn, settings) {
        appButton.connect('scroll-event', (actor, event) => {
            let mainDockActor = actor.get_parent()?.get_parent();
            if (mainDockActor) mainDockActor._lastIconClickTime = Date.now();
            
            try {
                if (!settings.get_boolean('scroll-action-app')) return Clutter.EVENT_PROPAGATE;
            } catch (e) { 
                return Clutter.EVENT_PROPAGATE; 
            }

            const dir = event.get_scroll_direction();
            const windows = getWindowsFn();

            if (!windows || windows.length === 0) return Clutter.EVENT_PROPAGATE;

            if (windows.length < 2) {
                const target = windows[0];
                target.unminimize();
                Main.activateWindow(target);
                return Clutter.EVENT_STOP;
            }

            const focusWin = global.display.get_focus_window();
            let idx = windows.indexOf(focusWin);
            if (idx === -1) idx = 0;

            let nextIdx = idx;
            if (dir === Clutter.ScrollDirection.UP) {
                nextIdx = (idx - 1 + windows.length) % windows.length;
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                nextIdx = (idx + 1) % windows.length;
            }

            if (nextIdx !== idx) {
                const target = windows[nextIdx];
                target.unminimize();
                Main.activateWindow(target);
            }
            return Clutter.EVENT_STOP;
        });
    }
}