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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { hexToRgba } from '../../core/Utils.js';


export function buildDesktopButtonModule(dockUI) {
    if (!dockUI._hiddenWindowsByDesktopBtn) dockUI._hiddenWindowsByDesktopBtn = [];

    const btn = new St.Button({
        reactive: true,
        can_focus: false,
        track_hover: true
    });

    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    
    let colorHex = '#ffffff';
    let opacity = 15;
    try {
        colorHex = dockUI.settings.get_string('desktop-btn-color');
        opacity = dockUI.settings.get_int('desktop-btn-opacity');
    } catch (e) { }

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

    btn.connect('notify::hover', () => {
        btn.set_style(btn.hover ? hoverStyle : defaultStyle);
    });

    btn.connect('clicked', () => {
        btn.set_style(activeStyle);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (btn && typeof btn.set_style === 'function') {
                btn.set_style(btn.hover ? hoverStyle : defaultStyle);
            }
            return GLib.SOURCE_REMOVE;
        });

        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows().filter(w =>
            w.get_window_type() === 0 && !w.is_skip_taskbar() && !w.is_always_on_all_workspaces()
        );
        const visibleWindows = windows.filter(w => !w.minimized);

        if (visibleWindows.length === 0 && dockUI._hiddenWindowsByDesktopBtn.length > 0) {
            dockUI._hiddenWindowsByDesktopBtn.forEach((w, index) => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, index * 40, () => {
                    try { if (w && w.minimized) w.unminimize(); } catch (_e) { }
                    return GLib.SOURCE_REMOVE;
                });
            });

            try {
                const topWin = dockUI._hiddenWindowsByDesktopBtn[0];
                if (topWin) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, dockUI._hiddenWindowsByDesktopBtn.length * 40, () => {
                        Main.activateWindow(topWin);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } catch (_e) { }
            dockUI._hiddenWindowsByDesktopBtn = [];
        } else {
            dockUI._hiddenWindowsByDesktopBtn = visibleWindows;
            visibleWindows.forEach((w, index) => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, index * 40, () => {
                    try { if (!w.minimized) w.minimize(); } catch (_e) { }
                    return GLib.SOURCE_REMOVE;
                });
            });
        }
    });

    return btn;
}