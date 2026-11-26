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


export function getTrayPreferenceKey(name, indicator) {
    if (!name.startsWith('appindicator-')) return name;

    // The AppIndicator panel role can contain a D-Bus address or a PID.
    // Prefer the app's StatusNotifierItem Id, which survives reconnection.
    const notifier = indicator?._indicator;
    const id = notifier?.id;
    if (!id) return name;

    if (/^tray-icon tray app \d+-\d+$/.test(id)) {
        return notifier.title ? `appindicator-title:${notifier.title}` : name;
    }

    if (/^chrome_status_icon_\d+$/.test(id)) {
        // Separate Electron apps can publish the same Chromium-generated Id.
        const app = notifier._appInfo ?? notifier._fakeAppInfo;
        const executable = app?.get_executable()?.split('/').at(-1)?.toLowerCase();
        if (!executable || executable === 'true') return name;
        return `appindicator-id:${executable}:${id}`;
    }

    return `appindicator-id:${id}`;
}
