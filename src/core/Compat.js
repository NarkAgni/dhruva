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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


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

export function getOverviewControls() {
    const overview = Main.overview._overview;
    return overview ? overview._controls : null;
}

export function getOverviewStateAdjustment() {
    const controls = getOverviewControls();
    return controls ? controls._stateAdjustment : null;
}

export function resetOverviewSearch() {
    const controls = getOverviewControls();
    const search = controls ? controls._searchController : null;
    if (search && search.reset) search.reset();
}

export function preloadAppGridIcons() {
    const controls = getOverviewControls();
    const appDisplay = controls ? controls._appDisplay : null;
    if (appDisplay && appDisplay._ensureIcon) appDisplay.create_all_apps();
}

export function queueLayoutRegionsUpdate() {
    Main.layoutManager._queueUpdateRegions();
}

export function getBackgroundGroup() {
    return Main.layoutManager._backgroundGroup;
}

export function getPanelLeftBox() {
    return Main.panel._leftBox;
}

export function getNotificationBannerBin() {
    return Main.messageTray._bannerBin;
}

export function getWindowAnimationFilter() {
    return Main.wm._shouldAnimateActor;
}

export function setWindowAnimationFilter(filter) {
    Main.wm._shouldAnimateActor = filter;
}