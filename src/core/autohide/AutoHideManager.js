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


import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { setMagnifierPauseState } from '../../ui/magnifier/MagnifierState.js';
import { forceShow, show, hide, animateShow, animateHide } from './AutoHideAnimations.js';
import { isValidWindow, shouldStayVisibleForTransientUI, recalculateOverlap, trackFocusedWindow } from './WindowOverlapDetection.js';
import { stopEdgePointerPoll, pointerInEdgeTriggerZone, startEdgePointerPoll, updateEdgeTrigger, getTheoreticalDockBounds, isHovering, startHoverPolling } from './EdgeDetection.js';


const AUTO_HIDE_MAGNIFIER_REASON = 'auto-hide-manager';

export default class AutoHideManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;

        this.isHidden = false;
        this._isAnimating = false;

        this.signals = [];

        this._hideTimerId = null;
        this._showTimerId = null;
        this._updateTimerId = null;
        this._edgeRevealTimerId = null;
        this._hoverPollId = null;
        this._edgePointerPollId = null;
        this._pointerUpdate = true;
        this._nextUpdateAt = 0;

        this._pauseReasons = new Set();

        this._trackedWin = null;
        this._trackedWinSignals = [];

        this.edgeTrigger = new St.Widget({
            name: 'DhruvaEdgeTrigger',
            reactive: true,
            opacity: 0,
            track_hover: true
        });

        Main.layoutManager.addChrome(this.edgeTrigger, {
            affectsStruts: false,
            trackFullscreen: true
        });

        this._stopEdgePointerPoll = () => stopEdgePointerPoll(this);
        this._pointerInEdgeTriggerZone = (pad) => pointerInEdgeTriggerZone(this, pad);
        this._startEdgePointerPoll = () => startEdgePointerPoll(this);
        this._updateEdgeTrigger = () => updateEdgeTrigger(this);
        this._getTheoreticalDockBounds = () => getTheoreticalDockBounds(this);
        this._isHovering = () => isHovering(this);
        this._startHoverPolling = () => startHoverPolling(this);

        this._isValidWindow = (win) => isValidWindow(this, win);
        this._shouldStayVisibleForTransientUI = () => shouldStayVisibleForTransientUI(this);
        this._recalculateOverlap = () => recalculateOverlap(this);
        this._trackFocusedWindow = () => trackFocusedWindow(this);

        this._forceShow = (f) => forceShow(this, f);
        this._show = (f, s) => show(this, f, s);
        this._hide = () => hide(this);
        this._animateShow = () => animateShow(this);
        this._animateHide = () => animateHide(this);

        this._setupListeners();
    }

    _getHideMode() {
        return this.settings.get_string('hide-mode') || 'dodge-all';
    }

    _getDockPosition() {
        return this.settings.get_string('dock-position') || 'BOTTOM';
    }

    _isFullscreenActive() {
        if (!this.dockUI) return false;
        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return false;

        const dockMonitorIndex = monitorData.index;
        const actualMonitor = monitorData.monitor;
        const activeWs = global.workspace_manager.get_active_workspace();

        if (activeWs) {
            for (const win of activeWs.list_windows()) {
                if (!win || win.minimized || win.get_monitor() !== dockMonitorIndex) continue;
                if (win.is_fullscreen()) return true;

                const r = win.get_frame_rect();
                if (r.width >= actualMonitor.width - 2 && r.height >= actualMonitor.height - 30) return true;
            }
        }

        const focusWin = global.display.get_focus_window();
        if (focusWin && focusWin.get_monitor() === dockMonitorIndex) {
            if (focusWin.is_fullscreen()) return true;
        }

        return false;
    }

    _setupListeners() {
        this._addSignal(global.display, 'notify::focus-window', () => {
            this._trackFocusedWindow();
            this._scheduleUpdate();
        });

        this._trackFocusedWindow();
        this._addSignal(global.display, 'restacked', () => this._scheduleUpdate());
        this._addSignal(global.workspace_manager, 'active-workspace-changed', () => this._scheduleUpdate());

        this._addSignal(global.display, 'grab-op-begin', (_d, _w, op) => {
            if (op === Meta.GrabOp.MOVING || op === Meta.GrabOp.RESIZING_UNKNOWN) this._scheduleUpdate();
        });
        this._addSignal(global.display, 'grab-op-end', () => this._scheduleUpdate());

        this._addSignal(this.dockUI.actor, 'enter-event', () => {
            if (this._isFullscreenActive()) return Clutter.EVENT_PROPAGATE;
            this._pointerUpdate = true;
            this._show(false, false);
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.dockUI.actor, 'leave-event', () => {
            this._pointerUpdate = true;
            this._scheduleUpdate();
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.edgeTrigger, 'enter-event', () => {
            if (!this.isHidden || this._isFullscreenActive()) return Clutter.EVENT_PROPAGATE;

            let pressureDelay = 0;
            const delaySetting = this.settings.get_int('edge-dwell-delay');
            if (delaySetting >= 0) pressureDelay = delaySetting;

            if (this._edgeRevealTimerId) {
                GLib.source_remove(this._edgeRevealTimerId);
                this._edgeRevealTimerId = null;
            }

            if (pressureDelay === 0) {
                this._pointerUpdate = true;
                this._show(true, false);
            } else {
                this._edgeRevealTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, pressureDelay, () => {
                    this._edgeRevealTimerId = null;
                    if (!this.edgeTrigger) {
                        return GLib.SOURCE_REMOVE;
                    }

                    if (this._pointerInEdgeTriggerZone(2) && !this._isFullscreenActive()) {
                        this._pointerUpdate = true;
                        this._show(true, false);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }

            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.edgeTrigger, 'leave-event', () => {
            if (this._edgeRevealTimerId) {
                GLib.source_remove(this._edgeRevealTimerId);
                this._edgeRevealTimerId = null;
            }
            this._pointerUpdate = true;
            this._scheduleUpdate();
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.settings, 'changed::hide-mode', () => {
            this._updateEdgeTrigger();
            this._cancelTimers();
            this._scheduleUpdate(0);
        });

        this._addSignal(this.settings, 'changed::dock-position', () => this._updateEdgeTrigger());
        this._addSignal(this.settings, 'changed::dock-margin', () => this._updateEdgeTrigger());

        this._scheduleUpdate(100);
    }

    setPauseState(reason, isPaused) {
        if (isPaused) {
            this._pauseReasons.add(reason);
            this._forceShow();
        } else {
            this._pauseReasons.delete(reason);
        }
        this._scheduleUpdate(0);
    }

    isPaused() {
        return this._pauseReasons.size > 0;
    }

    _addSignal(obj, event, cb) {
        if (!obj) return;
        const id = obj.connect(event, cb);
        this.signals.push({ obj, id });
    }

    _setAutoHideMagnifierPaused(isPaused) {
        if (!this.dockUI || !this.dockUI.actor) return;
        setMagnifierPauseState(this.dockUI.actor, AUTO_HIDE_MAGNIFIER_REASON, isPaused);
    }

    _applyDockInputState(interactive) {
        if (!this.dockUI || !this.dockUI.actor) return;

        const visit = (a) => {
            if (!a) return;
            a.reactive = interactive;
            const kids = a.get_children();
            for (let i = 0; i < kids.length; i++)
                visit(kids[i]);
        };

        visit(this.dockUI.actor);
    }

    _updateHidden(anyOverlap, activeWinOverlap, maximizedOverlap) {
        this._updateEdgeTrigger();

        if (this._shouldStayVisibleForTransientUI()) {
            this._show(true, false);
            return;
        }

        if (Main.overview && Main.overview.visible) {
            this._show(true, false);
            return;
        }

        if (this._isFullscreenActive()) {
            this._hide();
            return;
        }

        if (this._isHovering()) {
            this._show(false, false);
            return;
        }

        const mode = this._getHideMode();
        let shouldHide = false;

        if (mode === 'none' || mode === 'never') {
            this._forceShow();
            return;
        } else if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
            shouldHide = true;
        } else if (mode === 'active' || mode === 'dodge-active' || mode === 'intelligent') {
            shouldHide = activeWinOverlap;
        } else if (mode === 'maximized' || mode === 'dodge-maximized') {
            shouldHide = maximizedOverlap;
        } else {
            shouldHide = anyOverlap;
        }

        if (shouldHide) {
            this._hide();
        } else {
            this._show(false, true);
        }
    }

    _scheduleUpdate(delay = 50) {
        const now = Date.now();
        const targetAt = now + Math.max(0, delay);

        if (this._updateTimerId && this._nextUpdateAt && this._nextUpdateAt <= targetAt) {
            return;
        }
        if (this._updateTimerId) {
            GLib.source_remove(this._updateTimerId);
            this._updateTimerId = null;
        }
        this._nextUpdateAt = targetAt;

        this._updateTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateTimerId = null;
            this._nextUpdateAt = 0;
            if (!this.dockUI || !this.dockUI.actor) {
                return GLib.SOURCE_REMOVE;
            }
            this._recalculateOverlap();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelTimers() {
        if (this._hideTimerId) {
            GLib.source_remove(this._hideTimerId);
            this._hideTimerId = null;
        }
        if (this._showTimerId) {
            GLib.source_remove(this._showTimerId);
            this._showTimerId = null;
        }
        if (this._edgeRevealTimerId) {
            GLib.source_remove(this._edgeRevealTimerId);
            this._edgeRevealTimerId = null;
        }
        this._stopEdgePointerPoll();
    }

    destroy() {
        this._setAutoHideMagnifierPaused(false);
        this._cancelTimers();

        if (this._updateTimerId) {
            GLib.source_remove(this._updateTimerId);
            this._updateTimerId = null;
        }
        this._nextUpdateAt = 0;

        if (this._hoverPollId) {
            GLib.source_remove(this._hoverPollId);
            this._hoverPollId = null;
        }

        for (const s of this.signals) {
            if (s.id && s.obj) s.obj.disconnect(s.id);
        }
        this.signals = [];

        if (this.edgeTrigger) {
            Main.layoutManager.removeChrome(this.edgeTrigger);
            this.edgeTrigger.destroy();
            this.edgeTrigger = null;
        }

        if (this._trackedWin && this._trackedWinSignals) {
            this._trackedWinSignals.forEach(id => {
                this._trackedWin.disconnect(id);
            });
            this._trackedWinSignals = [];
            this._trackedWin = null;
        }

        this.dockUI = null;
        this.settings = null;
    }
}