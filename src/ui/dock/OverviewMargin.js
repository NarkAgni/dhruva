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


import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { updateLayout } from './DockRenderer.js';


export function scheduleOverviewMarginRetry(dockUI) {
    if (dockUI._overviewMarginRetryId || dockUI._isDestroyed)
        return;

    dockUI._overviewMarginRetryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
        dockUI._overviewMarginRetryId = null;
        if (dockUI._isDestroyed || !Main.overview.visible)
            return GLib.SOURCE_REMOVE;

        updateLayout(dockUI);
        applyOverviewDockMargin(dockUI);
        return GLib.SOURCE_REMOVE;
    });
}

export function applyOverviewDockMargin(dockUI) {
    if (dockUI._isDestroyed)
        return;

    if (!dockUI.isActorAlive(dockUI.actor) || !dockUI.isActorAlive(dockUI.boxActor))
        return;

    const controls = Main.overview._overview?._controls;
    if (!controls)
        return;

    const pos = dockUI.settings.get_string('dock-position') || 'BOTTOM';
    let dockH = dockUI.actor._cachedH || dockUI.actor.height || 0;
    let dockW = dockUI.actor._cachedW || dockUI.actor.width || 0;
    const margin = dockUI.settings.get_int('dock-margin') || 0;
    const stroke = Math.max(0, dockUI.settings.get_int('stroke-width') || 0) * 2;

    if (dockUI.actor && dockUI.actor.is_mapped()) {
        const [tw, th] = dockUI.actor.get_transformed_size();
        dockW = Math.max(dockW, Math.round(tw || 0));
        dockH = Math.max(dockH, Math.round(th || 0));
    }

    if ((dockW <= 1 || dockH <= 1) && dockUI.boxActor) {
        const [, prefW] = dockUI.boxActor.get_preferred_width(-1);
        const [, prefH] = dockUI.boxActor.get_preferred_height(-1);
        dockW = Math.max(dockW, Math.round((prefW || 0) + stroke));
        dockH = Math.max(dockH, Math.round((prefH || 0) + stroke));
    }

    const needsVerticalSpace = pos === 'BOTTOM' || pos === 'TOP';
    const needsHorizontalSpace = pos === 'LEFT' || pos === 'RIGHT';
    if ((needsVerticalSpace && dockH <= 1) || (needsHorizontalSpace && dockW <= 1)) {
        scheduleOverviewMarginRetry(dockUI);
        return;
    }

    if (dockUI._savedOverviewMargins === undefined) {
        dockUI._savedOverviewMargins = {
            bottom: controls.margin_bottom ?? 0,
            top: controls.margin_top ?? 0,
            left: controls.margin_left ?? 0,
            right: controls.margin_right ?? 0,
        };
    }

    const extra = 35;
    const targetBottom = pos === 'BOTTOM' ? Math.round(dockH + margin + extra) : dockUI._savedOverviewMargins.bottom;
    const targetTop = pos === 'TOP' ? Math.round(dockH + margin + extra) : dockUI._savedOverviewMargins.top;
    const targetLeft = pos === 'LEFT' ? Math.round(dockW + margin + extra) : dockUI._savedOverviewMargins.left;
    const targetRight = pos === 'RIGHT' ? Math.round(dockW + margin + extra) : dockUI._savedOverviewMargins.right;

    if (controls.margin_bottom !== targetBottom) {
        controls.margin_bottom = targetBottom;
    }
    if (controls.margin_top !== targetTop) {
        controls.margin_top = targetTop;
    }
    if (controls.margin_left !== targetLeft) {
        controls.margin_left = targetLeft;
    }
    if (controls.margin_right !== targetRight) {
        controls.margin_right = targetRight;
    }
}

export function clearOverviewDockMargin(dockUI) {
    if (dockUI._overviewMarginRetryId) {
        GLib.source_remove(dockUI._overviewMarginRetryId);
        dockUI._overviewMarginRetryId = null;
    }

    const controls = Main.overview._overview?._controls;
    if (!controls || dockUI._savedOverviewMargins === undefined)
        return;

    if (controls.margin_bottom !== dockUI._savedOverviewMargins.bottom) {
        controls.margin_bottom = dockUI._savedOverviewMargins.bottom;
    }
    if (controls.margin_top !== dockUI._savedOverviewMargins.top) {
        controls.margin_top = dockUI._savedOverviewMargins.top;
    }
    if (controls.margin_left !== dockUI._savedOverviewMargins.left) {
        controls.margin_left = dockUI._savedOverviewMargins.left;
    }
    if (controls.margin_right !== dockUI._savedOverviewMargins.right) {
        controls.margin_right = dockUI._savedOverviewMargins.right;
    }

    dockUI._savedOverviewMargins = undefined;
}