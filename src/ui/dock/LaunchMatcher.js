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


const LAUNCH_EXPIRY_MS = 8000;
const FILE_MANAGER_CLASSES = ['nautilus', 'files'];

export function getWindowIdentity(win, tracker) {
    const app = tracker.get_window_app(win);
    const wmClass = win.get_wm_class();
    return {
        appId: app ? app.get_id() : null,
        wmClass: wmClass ? wmClass.toLowerCase() : '',
    };
}

export function launchMatchesWindow(launch, { appId, wmClass }) {
    if (launch.appId && appId && appId === launch.appId) return true;

    if (launch.appId && wmClass) {
        const appBase = launch.appId.toLowerCase().replace('.desktop', '');
        return appBase.includes(wmClass) || wmClass.includes(appBase);
    }

    return Boolean(launch.isFolder) && FILE_MANAGER_CLASSES.some(name => wmClass.includes(name));
}

export function hasPendingLaunchFor(launches, identity) {
    return launches.some(launch => !launch.consumed && launchMatchesWindow(launch, identity));
}

export function pruneExpiredLaunches(launches, now) {
    return launches.filter(launch => launch && now - (launch.createdAt || now) < LAUNCH_EXPIRY_MS);
}

export function claimLaunchForWindow(launches, identity) {
    const launch = launches.find(item => !item.consumed && launchMatchesWindow(item, identity));
    if (!launch) return null;

    launch.consumed = true;
    return launch;
}