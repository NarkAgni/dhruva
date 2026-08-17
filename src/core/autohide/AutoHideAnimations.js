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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export function forceShow(ahm, force = false) {
    if (!ahm.dockUI || !ahm.dockUI.actor) return;

    if (!force && Main.overview.visible && ahm.settings.get_boolean('independent-dock')) return;

    ahm._cancelTimers();
    ahm._isAnimating = false;
    ahm.isHidden = false;

    if (ahm._hoverPollId) {
        GLib.source_remove(ahm._hoverPollId);
        ahm._hoverPollId = null;
    }

    if (ahm.dockUI.actor)
        ahm.dockUI.actor._isHidden = false;
    if (ahm.edgeTrigger) ahm.edgeTrigger.reactive = false;

    const actor = ahm.dockUI.actor;
    actor.remove_all_transitions();
    actor.show();
    actor.visible = true;
    actor.opacity = 255;
    actor.translation_x = 0;
    actor.translation_y = 0;

    ahm._applyDockInputState(true);

    ahm._updateEdgeTrigger();
    ahm._setAutoHideMagnifierPaused(false);
}

export function show(ahm, force = false, _suppressAnimations = false) {
    if (!force && Main.overview.visible && ahm.settings.get_boolean('independent-dock')) return;

    if (!ahm.isHidden && !force && !ahm._hideTimerId && !ahm._showTimerId) {
        ahm._setAutoHideMagnifierPaused(false);
        return;
    }

    ahm._cancelTimers();
    ahm.isHidden = false;
    ahm._stopEdgePointerPoll();

    ahm._startHoverPolling();

    if (ahm.dockUI && ahm.dockUI.actor) ahm.dockUI.actor._isHidden = false;
    if (ahm.edgeTrigger) ahm.edgeTrigger.reactive = false;

    let unhideDelay = 0;
    if (ahm._pointerUpdate) {
        try {
            unhideDelay = ahm.settings.get_int('unhide-delay');
        } catch (_e) { }
    }

    if (unhideDelay > 0 && !force) {
        ahm._showTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, unhideDelay, () => {
            ahm._showTimerId = null;
            ahm._animateShow();
            return GLib.SOURCE_REMOVE;
        });
    } else {
        ahm._animateShow();
    }
}

export function hide(ahm) {
    const mode = ahm._getHideMode();
    if (mode === 'none' || mode === 'never') return;

    if (ahm._shouldStayVisibleForTransientUI()) {
        return;
    }

    if (ahm._hideTimerId || ahm.isHidden) return;

    ahm._cancelTimers();

    let hideDelay = 200;
    try {
        hideDelay = ahm.settings.get_int('hide-delay');
    } catch (_e) { }

    ahm._hideTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hideDelay, () => {
        ahm._hideTimerId = null;

        const currentMode = ahm._getHideMode();
        if (currentMode === 'none' || currentMode === 'never') return GLib.SOURCE_REMOVE;

        if (!ahm._isHovering()) {
            if (ahm._shouldStayVisibleForTransientUI()) {
                return GLib.SOURCE_REMOVE;
            }

            ahm.isHidden = true;
            if (ahm._hoverPollId) {
                GLib.source_remove(ahm._hoverPollId);
                ahm._hoverPollId = null;
            }

            if (ahm.dockUI && ahm.dockUI.actor) ahm.dockUI.actor._isHidden = true;

            if (ahm.edgeTrigger && currentMode !== 'none' && currentMode !== 'never') {
                ahm.edgeTrigger.reactive = true;
            }
            ahm._animateHide();
        }
        return GLib.SOURCE_REMOVE;
    });
}

export function animateShow(ahm) {
    if (!ahm.dockUI || !ahm.dockUI.actor) return;

    if (ahm.edgeTrigger) ahm.edgeTrigger.reactive = false;

    ahm._applyDockInputState(true);

    ahm.dockUI.actor.remove_all_transitions();

    ahm.dockUI.actor.show();
    ahm.dockUI.actor.visible = true;

    if (ahm.dockUI._pendingRender && ahm.dockUI._renderDock) {
        ahm.dockUI._renderDock(true);
    }
    
    if (ahm.dockUI._updateLayout) {
        ahm.dockUI._updateLayout();
    }

    const pos = ahm._getDockPosition();
    const offset = (ahm.settings.get_int('dock-margin') || 0) + 80;
    const dw = ahm.dockUI.actor._cachedW || ahm.dockUI.actor.width || 100;
    const dh = ahm.dockUI.actor._cachedH || ahm.dockUI.actor.height || 48;

    let startTx = 0;
    let startTy = 0;
    switch (pos) {
        case 'TOP':
            startTy = -(dh + offset);
            break;
        case 'BOTTOM':
            startTy = dh + offset;
            break;
        case 'LEFT':
            startTx = -(dw + offset);
            break;
        case 'RIGHT':
            startTx = dw + offset;
            break;
    }

    if (Math.abs(ahm.dockUI.actor.translation_x) > 5000 || Math.abs(ahm.dockUI.actor.translation_y) > 5000) {
        ahm.dockUI.actor.translation_x = startTx;
        ahm.dockUI.actor.translation_y = startTy;
    }

    const modeNow = ahm._getHideMode();
    if (modeNow === 'none' || modeNow === 'never') {
        ahm.dockUI.actor.opacity = 255;
        ahm.dockUI.actor.translation_x = 0;
        ahm.dockUI.actor.translation_y = 0;
        ahm._applyDockInputState(true);
        ahm._setAutoHideMagnifierPaused(false);
        return;
    }

    ahm._isAnimating = true;

    if (ahm.dockUI.actor.opacity === 0) {
        ahm.dockUI.actor.opacity = 1;
    }

    ahm.dockUI.actor.ease({
        translation_x: 0,
        translation_y: 0,
        opacity: 255,
        duration: 180,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            ahm._isAnimating = false;
            if (ahm.isHidden) {
                const modeAtComplete = ahm._getHideMode();
                if (modeAtComplete === 'none' || modeAtComplete === 'never') {
                    ahm._forceShow();
                    return;
                }
                ahm.dockUI.actor.hide();
                ahm.dockUI.actor.opacity = 0;
                ahm._applyDockInputState(false);
                ahm._updateEdgeTrigger();
            } else {
                ahm._setAutoHideMagnifierPaused(false);
            }
        }
    });
}

export function animateHide(ahm) {
    if (!ahm.dockUI || !ahm.dockUI.actor) return;

    const mode = ahm._getHideMode();
    if (mode === 'none' || mode === 'never') {
        ahm._forceShow();
        return;
    }

    ahm._applyDockInputState(false);

    ahm.dockUI.actor.remove_all_transitions();
    ahm._setAutoHideMagnifierPaused(true);

    const pos = ahm._getDockPosition();
    const offset = (ahm.settings.get_int('dock-margin') || 0) + 80;

    const dw = ahm.dockUI.actor._cachedW || ahm.dockUI.actor.width || 100;
    const dh = ahm.dockUI.actor._cachedH || ahm.dockUI.actor.height || 48;

    let tx = 0;
    let ty = 0;

    switch (pos) {
        case 'TOP':
            ty = -(dh + offset);
            break;
        case 'BOTTOM':
            ty = dh + offset;
            break;
        case 'LEFT':
            tx = -(dw + offset);
            break;
        case 'RIGHT':
            tx = dw + offset;
            break;
    }

    ahm._isAnimating = true;

    ahm.dockUI.actor.ease({
        translation_x: tx,
        translation_y: ty,
        opacity: 0,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
            ahm._isAnimating = false;
            if (ahm.isHidden) {
                const modeAtComplete = ahm._getHideMode();
                if (modeAtComplete === 'none' || modeAtComplete === 'never') {
                    ahm._forceShow();
                    return;
                }

                ahm.dockUI.actor.hide();
                ahm.dockUI.actor.opacity = 0;
                ahm.dockUI.actor.translation_x = tx;
                ahm.dockUI.actor.translation_y = ty;

                ahm._applyDockInputState(false);
                ahm._updateEdgeTrigger();
                ahm._startEdgePointerPoll();
            }
        }
    });
}