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


import Meta from 'gi://Meta';


export function getCursorTracker() {
    return global.backend.get_cursor_tracker
        ? global.backend.get_cursor_tracker()
        : Meta.CursorTracker.get_for_display(global.display);
}

export function setUnredirectEnabled(enabled) {
    const compositor = global.compositor;
    if (compositor && compositor.disable_unredirect) {
        if (enabled) compositor.enable_unredirect();
        else compositor.disable_unredirect();
    } else if (enabled) {
        Meta.enable_unredirect_for_display(global.display);
    } else {
        Meta.disable_unredirect_for_display(global.display);
    }
}

export function hasPointerBarriers() {
    return Boolean(
        global.backend &&
        Meta.BackendCapabilities &&
        (global.backend.capabilities & Meta.BackendCapabilities.BARRIERS) !== 0
    );
}

export function isWindowHidden(win) {
    return Boolean(win.is_hidden && win.is_hidden());
}