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


export function stopEdgePointerPoll(ahm) {
    if (ahm._edgePointerPollId) {
        GLib.source_remove(ahm._edgePointerPollId);
        ahm._edgePointerPollId = null;
    }
}

export function pointerInEdgeTriggerZone(ahm, pad = 4) {
    if (!ahm.edgeTrigger || ahm.edgeTrigger.__destroyed || (typeof ahm.edgeTrigger.is_destroyed === 'function' && ahm.edgeTrigger.is_destroyed())) return false;
    try {
        if (!ahm.edgeTrigger.is_mapped?.() && !ahm.edgeTrigger.visible) return false;
        
        const [px, py] = global.get_pointer();
        const [ex, ey] = ahm.edgeTrigger.get_transformed_position();
        const [ew, eh] = ahm.edgeTrigger.get_transformed_size();

        return (px >= ex - pad && px <= ex + ew + pad &&
            py >= ey - pad && py <= ey + eh + pad);
    } catch (_e) {
        return false;
    }
}

export function startEdgePointerPoll(ahm) {
    ahm._stopEdgePointerPoll();
    if (ahm._destroyed || !ahm.isHidden) return;

    if (ahm._isFullscreenActive?.()) return;

    const mode = ahm._getHideMode();
    if (mode === 'none' || mode === 'never') return;

    ahm._edgePointerPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
        try {
            if (ahm._destroyed || !ahm.edgeTrigger || ahm.edgeTrigger.__destroyed || (typeof ahm.edgeTrigger.is_destroyed === 'function' && ahm.edgeTrigger.is_destroyed()) || !ahm.isHidden || ahm._isFullscreenActive?.()) {
                ahm._edgePointerPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            const m = ahm._getHideMode();
            if (m === 'none' || m === 'never') {
                ahm._edgePointerPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            if (ahm._pointerInEdgeTriggerZone(2)) {
                let pressureDelay = 0;
                try {
                    const delaySetting = ahm.settings.get_int('edge-dwell-delay');
                    if (delaySetting >= 0) pressureDelay = delaySetting;
                } catch (_e) {}

                if (pressureDelay > 0) {
                    ahm._stopEdgePointerPoll();
                    ahm._edgeRevealTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, pressureDelay, () => {
                        try {
                            if (ahm._destroyed || !ahm.edgeTrigger || ahm.edgeTrigger.__destroyed || (typeof ahm.edgeTrigger.is_destroyed === 'function' && ahm.edgeTrigger.is_destroyed())) {
                                ahm._edgeRevealTimerId = null;
                                return GLib.SOURCE_REMOVE;
                            }

                            if (ahm._pointerInEdgeTriggerZone(2) && !ahm._isFullscreenActive?.()) {
                                ahm._pointerUpdate = true;
                                ahm._show(true, false);
                            } else if (ahm.isHidden && !ahm._isFullscreenActive?.()) {
                                ahm._startEdgePointerPoll();
                            }
                        } catch (e) {
                            ahm._edgeRevealTimerId = null;
                            return GLib.SOURCE_REMOVE;
                        }
                        ahm._edgeRevealTimerId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                    return GLib.SOURCE_REMOVE;
                }

                ahm._pointerUpdate = true;
                ahm._show(true, false);
                ahm._edgePointerPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        } catch (e) {
            ahm._edgePointerPollId = null;
            return GLib.SOURCE_REMOVE;
        }
    });
}

export function updateEdgeTrigger(ahm) {
    if (!ahm.edgeTrigger || ahm.edgeTrigger.__destroyed || (typeof ahm.edgeTrigger.is_destroyed === 'function' && ahm.edgeTrigger.is_destroyed()) || ahm._destroyed || !ahm.dockUI || ahm.dockUI._isDestroyed) return;

    try {
        const monitorData = ahm.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return;

        const actualMonitor = monitorData.monitor;
        const pos = ahm._getDockPosition();
        const mode = ahm._getHideMode();
        
        const bounds = ahm._getTheoreticalDockBounds();
        const T = 1;

        let ex = 0, ey = 0, ew = 0, eh = 0;

        switch (pos) {
            case 'BOTTOM':
                ex = bounds.x;
                ew = bounds.width;
                ey = actualMonitor.y + actualMonitor.height - T;
                eh = T;
                break;
            case 'TOP':
                ex = bounds.x;
                ew = bounds.width;
                ey = actualMonitor.y;
                eh = T;
                break;
            case 'LEFT':
                ex = actualMonitor.x;
                ew = T;
                ey = bounds.y;
                eh = bounds.height;
                break;
            case 'RIGHT':
                ex = actualMonitor.x + actualMonitor.width - T;
                ew = T;
                ey = bounds.y;
                eh = bounds.height;
                break;
        }

        ahm.edgeTrigger.set_position(ex, ey);
        ahm.edgeTrigger.set_size(ew, eh);

        const isFS = ahm._isFullscreenActive?.();
        if (mode === 'none' || mode === 'never' || isFS) {
            ahm.edgeTrigger.hide();
            ahm.edgeTrigger.reactive = false;
        } else {
            ahm.edgeTrigger.show();
            ahm.edgeTrigger.reactive = ahm.isHidden;
            const parent = ahm.edgeTrigger.get_parent();
            if (parent && !parent.__destroyed && typeof parent.set_child_above_sibling === 'function') {
                parent.set_child_above_sibling(ahm.edgeTrigger, null);
            }
        }
    } catch (_e) {}
}

export function getTheoreticalDockBounds(ahm) {
    if (!ahm.dockUI || !ahm.dockUI.actor || ahm.dockUI.actor.__destroyed || (typeof ahm.dockUI.actor.is_destroyed === 'function' && ahm.dockUI.actor.is_destroyed())) {
        return { x: 0, y: 0, width: 100, height: 48 };
    }

    try {
        const dw = ahm.dockUI.actor._cachedW || ahm.dockUI.actor.width || 100;
        const dh = ahm.dockUI.actor._cachedH || ahm.dockUI.actor.height || 48;

        const monitorData = ahm.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return { x: 0, y: 0, width: dw, height: dh };
        const monitor = Main.layoutManager.getWorkAreaForMonitor(monitorData.index);

        const pos = ahm._getDockPosition();
        const margin = ahm.settings.get_int('dock-margin') || 0;

        switch (pos) {
            case 'TOP':
                return { x: monitor.x + (monitor.width - dw) / 2, y: monitor.y + margin, width: dw, height: dh };
            case 'BOTTOM':
                return { x: monitor.x + (monitor.width - dw) / 2, y: monitor.y + monitor.height - dh - margin, width: dw, height: dh };
            case 'LEFT':
                return { x: monitor.x + margin, y: monitor.y + (monitor.height - dh) / 2, width: dw, height: dh };
            case 'RIGHT':
                return { x: monitor.x + monitor.width - dw - margin, y: monitor.y + (monitor.height - dh) / 2, width: dw, height: dh };
        }
        return { x: 0, y: 0, width: dw, height: dh };
    } catch (_e) {
        return { x: 0, y: 0, width: 100, height: 48 };
    }
}

export function isHovering(ahm) {
    if (!ahm.dockUI || !ahm.dockUI.actor || ahm.dockUI.actor.__destroyed || (typeof ahm.dockUI.actor.is_destroyed === 'function' && ahm.dockUI.actor.is_destroyed())) return false;

    try {
        const [px, py] = global.get_pointer();
        const [dax, day] = ahm.dockUI.actor.get_transformed_position();

        const daw = ahm.dockUI.actor._cachedW || ahm.dockUI.actor.width;
        const dah = ahm.dockUI.actor._cachedH || ahm.dockUI.actor.height;

        const isVertical = ahm.dockUI.boxActor && !ahm.dockUI.boxActor.__destroyed ? ahm.dockUI.boxActor.get_vertical() : false;

        let padX = 2, padY = 2;

        if (!ahm.isHidden) {
            let hoverZoom = false;
            try { hoverZoom = ahm.settings.get_boolean('hover-zoom'); } catch (_e) {}

            let maxZoom = 1.0;
            if (hoverZoom) {
                try { maxZoom = ahm.settings.get_double('hover-zoom-factor'); } catch (_e) {}
            }

            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
            let iconSize = 48;
            try { iconSize = ahm.settings.get_int('icon-size'); } catch (_e) {}

            const overflow = iconSize * actualMax;

            padX = isVertical ? Math.max(20, overflow) : 10;
            padY = isVertical ? 10 : Math.max(20, overflow);
        }

        let boundsLeft = dax;
        let boundsRight = dax + daw;
        let boundsTop = day;
        let boundsBottom = day + dah;

        if (ahm.dockUI.actor.bgActor && !ahm.dockUI.actor.bgActor.__destroyed) {
            const [bx, by] = ahm.dockUI.actor.bgActor.get_transformed_position();
            const [bw, bh] = ahm.dockUI.actor.bgActor.get_transformed_size();
            boundsLeft = Math.min(boundsLeft, bx);
            boundsRight = Math.max(boundsRight, bx + bw);
            boundsTop = Math.min(boundsTop, by);
            boundsBottom = Math.max(boundsBottom, by + bh);
        }

        return (px >= boundsLeft - padX && px <= boundsRight + padX && py >= boundsTop - padY && py <= boundsBottom + padY);
    } catch (_e) {
        return false;
    }
}

export function startHoverPolling(ahm) {
    if (ahm._hoverPollId) return;
    ahm._hoverPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => {
        try {
            if (ahm._destroyed || ahm.isHidden || !ahm.dockUI || !ahm.dockUI.actor || ahm.dockUI.actor.__destroyed || (typeof ahm.dockUI.actor.is_destroyed === 'function' && ahm.dockUI.actor.is_destroyed())) {
                ahm._hoverPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            if (ahm._shouldStayVisibleForTransientUI() || ahm._isHovering()) {
                return GLib.SOURCE_CONTINUE;
            }

            const mode = ahm._getHideMode();
            if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
                ahm._hide();
            } else {
                ahm._scheduleUpdate(0);
            }

            return GLib.SOURCE_CONTINUE;
        } catch (e) {
            ahm._hoverPollId = null;
            return GLib.SOURCE_REMOVE;
        }
    });
}