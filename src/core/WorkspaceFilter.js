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


export default class WorkspaceFilter {

    static filterWindows(windows, settings) {
        try {
            if (!settings.get_boolean('isolate-workspaces')) return windows;
        } catch (e) {
            return windows;
        }

        const workspaceManager = global.workspace_manager;
        const activeWs = workspaceManager.get_active_workspace();

        return windows.filter(w => {
            return w.is_on_all_workspaces() || w.get_workspace() === activeWs;
        });
    }
}