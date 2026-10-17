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


const handlers = [];
const _signalTracker = {};

export function onSettingChanged(settings, key, callback) {
    settings.connectObject(`changed::${key}`, callback, _signalTracker);
    if (!handlers.includes(settings)) {
        handlers.push(settings);
    }
}

export function disconnectSettingSignals() {
    for (let i = 0; i < handlers.length; i++) {
        if (handlers[i]) {
            handlers[i].disconnectObject(_signalTracker);
        }
    }
    handlers.length = 0;
}