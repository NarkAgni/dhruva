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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { resetMagnification } from './Magnifier.js';


export function isContextMenuOpen() {
    for (const child of Main.layoutManager.uiGroup.get_children()) {
        if (!child.mapped) continue;
        if (child.style_class && child.style_class.includes('context-menu-overlay') && child.visible) return true;
    }
    return false;
}

export function isAppGridOpen() {
    for (const child of Main.layoutManager.uiGroup.get_children()) {
        if (child.style_class && child.style_class.includes('app-list-overlay') && child.visible) return true;
    }
    return false;
}

export function setMagnifierPauseState(dockActor, reason, isPaused) {
    if (!dockActor) return;

    if (!dockActor._magPauseReasons) {
        dockActor._magPauseReasons = new Set();
    }

    if (isPaused) {
        dockActor._magPauseReasons.add(reason);
        dockActor._suppressZoom = true;
        resetMagnification(dockActor);
    } else {
        dockActor._magPauseReasons.delete(reason);
        if (dockActor._magPauseReasons.size === 0) {
            dockActor._suppressZoom = false;
        }
    }
}