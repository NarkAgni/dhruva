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
import { isFullBarLayout } from '../../core/LayoutMode.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { fadeMinimize, fadeRestore } from '../effects/WindowEffects.js';


const STAGGER_MS = 40;
const CLICK_FEEDBACK_MS = 150;

class DesktopToggle {
    constructor() {
        this._timers = new TimeoutTracker();
        this._timeoutIds = [];
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
        this._cancelPending();
        this._timers.destroy();
        this._hiddenWindows = [];
    }

    _cancelPending() {
        for (let i = 0; i < this._timeoutIds.length; i++) {
            if (this._timeoutIds[i]) {
                this._timers.remove(this._timeoutIds[i]);
            }
        }
        this._timeoutIds = [];
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
            const id = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, index * STAGGER_MS, () => {
                const idx = this._timeoutIds.indexOf(id);
                if (idx !== -1) this._timeoutIds.splice(idx, 1);
                if (!win.minimized) fadeMinimize(win);
                return GLib.SOURCE_REMOVE;
            });
            this._timeoutIds.push(id);
        });
    }

    _restore(windows) {
        this._hiddenWindows = [];
        windows.forEach((win, index) => {
            const id = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, index * STAGGER_MS, () => {
                const idx = this._timeoutIds.indexOf(id);
                if (idx !== -1) this._timeoutIds.splice(idx, 1);
                if (win.minimized) fadeRestore(win);
                return GLib.SOURCE_REMOVE;
            });
            this._timeoutIds.push(id);
        });
    }
}

export function toggleDesktop(dockUI) {
    if (!dockUI.desktopToggle) dockUI.desktopToggle = new DesktopToggle();
    dockUI.desktopToggle.toggle();
}

function _computeDesktopButtonStyle(dockUI, stateMode = 'default') {
    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const colorHex = dockUI.settings.get_string('desktop-btn-color') || '#ffffff';
    const opacity = dockUI.settings.get_int('desktop-btn-opacity');

    const isFullWidth = isFullBarLayout();

    const rawRadius = isFullWidth ? 0 : dockUI.settings.get_int('border-radius');
    const sWidth = (!isFullWidth && !dockUI.settings.get_boolean('blur-enabled'))
        ? Math.max(0, dockUI.settings.get_int('stroke-width'))
        : 0;
    const r = Math.max(0, rawRadius - sWidth);

    const radiusCss = isVertical
        ? `0px 0px ${r}px ${r}px`
        : `0px ${r}px ${r}px 0px`;

    const baseRgba = hexToRgba(colorHex, opacity / 100.0);
    const hoverRgba = hexToRgba(colorHex, Math.min(1.0, (opacity + 15) / 100.0));
    const borderRgba = hexToRgba(colorHex, Math.min(1.0, (opacity + 20) / 100.0));
    const activeRgba = hexToRgba(colorHex, Math.min(1.0, (opacity + 40) / 100.0));

    let bg = baseRgba;
    let duration = 200;
    if (stateMode === 'hover') {
        bg = hoverRgba;
        duration = 150;
    } else if (stateMode === 'active') {
        bg = activeRgba;
        duration = 50;
    }

    const borderSide = isVertical ? 'border-top' : 'border-left';
    return `background-color: ${bg}; ${borderSide}: 1px solid ${borderRgba}; border-radius: ${radiusCss}; transition-duration: ${duration}ms;`;
}

export function buildDesktopButtonModule(dockUI) {
    const btn = new St.Button({
        reactive: true,
        can_focus: false,
        track_hover: true,
        clip_to_allocation: true,
    });

    btn._refreshDesktopBtnStyle = (mode = null) => {
        const targetMode = mode || (btn.hover ? 'hover' : 'default');
        btn.set_style(_computeDesktopButtonStyle(dockUI, targetMode));
    };

    btn._refreshDesktopBtnStyle('default');

    btn.connectObject('notify::hover', () => {
        btn._refreshDesktopBtnStyle(btn.hover ? 'hover' : 'default');
    }, btn);

    const feedbackTimers = new TimeoutTracker();
    let feedbackId = 0;

    btn.connectObject('clicked', () => {
        btn._refreshDesktopBtnStyle('active');

        if (feedbackId) {
            feedbackTimers.remove(feedbackId);
            feedbackId = 0;
        }
        feedbackId = feedbackTimers.addTimeout(GLib.PRIORITY_DEFAULT, CLICK_FEEDBACK_MS, () => {
            feedbackId = 0;
            btn._refreshDesktopBtnStyle(btn.hover ? 'hover' : 'default');
            return GLib.SOURCE_REMOVE;
        });

        toggleDesktop(dockUI);
    }, btn);

    btn.connectObject('destroy', () => {
        if (feedbackId) {
            feedbackTimers.remove(feedbackId);
            feedbackId = 0;
        }
        feedbackTimers.destroy();
    }, btn);

    return btn;
}