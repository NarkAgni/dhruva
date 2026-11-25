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


export function getAlternateLaunchGpu(app, switcherooControl, { AppState, AppLaunchGpu }) {
    if (!app || app.is_module || app.get_state() !== AppState.STOPPED)
        return null;

    const appInfo = app.get_app_info();
    if (!appInfo || !switcherooControl) return null;

    const hasDualGpu = switcherooControl.get_cached_property('HasDualGpu');
    if (!hasDualGpu || !hasDualGpu.unpack()) return null;

    return appInfo.get_boolean('PrefersNonDefaultGPU')
        ? AppLaunchGpu.DEFAULT
        : AppLaunchGpu.DISCRETE;
}