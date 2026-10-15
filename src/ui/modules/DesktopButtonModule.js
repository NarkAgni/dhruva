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
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { hexToRgba } from '../../core/Utils.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { fadeMinimize, fadeRestore } from '../effects/WindowEffects.js';


const STAGGER_MS = 40;
const CLICK_FEEDBACK_MS = 150;

class DesktopToggle {
    constructor() {
        this._timers = new TimeoutTracker();
        this._hiddenWindows = [];
    }

    toggle() {
        this._cancelPending();

        const windows = this._workspaceWindows();
        const visible = windows.filter(win => !win.minimized);
        const restorable = this._hiddenWindows.filter(win => win.get_compositor_private() && win.minimized);

        if (visible.length === 0 && restorable.length > 0) this._restore(restorable);
        else this._showDesktop(visible);
    }

    destroy() {
        this._timers.destroy();
        this._hiddenWindows = [];
    }

    _cancelPending() {
        this._timers.destroy();
        this._timers = new TimeoutTracker();
    }

    _workspaceWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows().filter(win =>
            win.get_window_type() === Meta.WindowType.NORMAL &&
            !win.is_skip_taskbar() &&
            !win.is_always_on_all_workspaces()
        );
        return global.display.sort_windows_by_stacking(windows);
    }

    _showDesktop(visible) {
        this._hiddenWindows = visible;
        [...visible].reverse().forEach((win, index) => {
            this._timers.addTimeout(GLib.PRIORITY_DEFAULT, index * STAGGER_MS, () => {
                if (!win.minimized) fadeMinimize(win);
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _restore(windows) {
        this._hiddenWindows = [];
        windows.forEach((win, index) => {
            this._timers.addTimeout(GLib.PRIORITY_DEFAULT, index * STAGGER_MS, () => {
                if (win.minimized) fadeRestore(win);
                return GLib.SOURCE_REMOVE;
            });
        });
    }
}

export function toggleDesktop(dockUI) {
    if (!dockUI._desktopToggle) dockUI._desktopToggle = new DesktopToggle();
    dockUI._desktopToggle.toggle();
}

export function buildDesktopButtonModule(dockUI) {
    const btn = new St.Button({
        reactive: true,
        can_focus: false,
        track_hover: true
    });

    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const colorHex = dockUI.settings.get_string('desktop-btn-color') || '#ffffff';
    const opacity = dockUI.settings.get_int('desktop-btn-opacity');

    const baseRgba = hexToRgba(colorHex, opacity / 100.0);
    const hoverRgba = hexToRgba(colorHex, Math.min(1.0, (opacity + 15) / 100.0));
    const borderRgba = hexToRgba(colorHex, Math.min(1.0, (opacity + 20) / 100.0));
    const activeRgba = hexToRgba(colorHex, Math.min(1.0, (opacity + 40) / 100.0));

    const defaultStyle = isVertical 
        ? `background-color: ${baseRgba}; border-top: 1px solid ${borderRgba}; border-radius: 0px; transition-duration: 200ms;`
        : `background-color: ${baseRgba}; border-left: 1px solid ${borderRgba}; border-radius: 0px; transition-duration: 200ms;`;
        
    const hoverStyle = isVertical
        ? `background-color: ${hoverRgba}; border-top: 1px solid ${borderRgba}; border-radius: 0px; transition-duration: 150ms;`
        : `background-color: ${hoverRgba}; border-left: 1px solid ${borderRgba}; border-radius: 0px; transition-duration: 150ms;`;

    const activeStyle = isVertical
        ? `background-color: ${activeRgba}; border-top: 1px solid ${borderRgba}; border-radius: 0px; transition-duration: 50ms;`
        : `background-color: ${activeRgba}; border-left: 1px solid ${borderRgba}; border-radius: 0px; transition-duration: 50ms;`;

    btn.set_style(defaultStyle);

    btn.connectObject('notify::hover', () => {
        btn.set_style(btn.hover ? hoverStyle : defaultStyle);
    }, btn);

    const feedbackTimers = new TimeoutTracker();
    let feedbackId = 0;

    btn.connectObject('clicked', () => {
        btn.set_style(activeStyle);

        feedbackTimers.remove(feedbackId);
        feedbackId = feedbackTimers.addTimeout(GLib.PRIORITY_DEFAULT, CLICK_FEEDBACK_MS, () => {
            feedbackId = 0;
            btn.set_style(btn.hover ? hoverStyle : defaultStyle);
            return GLib.SOURCE_REMOVE;
        });

        toggleDesktop(dockUI);
    }, btn);

    btn.connectObject('destroy', () => feedbackTimers.destroy(), btn);

    return btn;
}