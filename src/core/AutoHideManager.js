/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    setMagnifierPauseState
} from '../ui/Magnifier.js';


const AUTO_HIDE_MAGNIFIER_REASON = 'auto-hide-manager';


export default class AutoHideManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;

        this.isHidden = false;
        this._isAnimating = false;

        this._destroyed = false;
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
            track_hover: true,
        });

        Main.layoutManager.addChrome(this.edgeTrigger, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        this._setupListeners();
    }

    _setupListeners() {
        if (this._destroyed) return;

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
            if (!this.isHidden) return Clutter.EVENT_PROPAGATE;

            let pressureDelay = 0;
            try {
                const delaySetting = this.settings.get_int('edge-dwell-delay');
                if (delaySetting >= 0) pressureDelay = delaySetting;
            } catch (e) {}

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

                    if (this._pointerInEdgeTriggerZone(2)) {
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


    _trackFocusedWindow() {
        if (this._destroyed) return;

        const focusWin = global.display.get_focus_window();
        if (this._trackedWin === focusWin) return;

        if (this._trackedWin && this._trackedWinSignals) {
            this._trackedWinSignals.forEach(id => {
                try {
                    this._trackedWin.disconnect(id);
                } catch (e) {}
            });
        }

        this._trackedWinSignals = [];
        this._trackedWin = focusWin;

        if (this._trackedWin) {
            try {
                this._trackedWinSignals.push(this._trackedWin.connect('size-changed', () => this._scheduleUpdate()));
                this._trackedWinSignals.push(this._trackedWin.connect('position-changed', () => this._scheduleUpdate()));
                this._trackedWinSignals.push(this._trackedWin.connect('notify::maximized-vertically', () => this._scheduleUpdate()));
            } catch (e) {}
        }
    }

    _addSignal(obj, event, cb) {
        if (this._destroyed) return;
        try {
            const id = obj.connect(event, cb);
            this.signals.push({
                obj,
                id
            });
        } catch (e) {}
    }

    _setAutoHideMagnifierPaused(isPaused) {
        if (!this.dockUI || !this.dockUI.actor || this.dockUI.actor._isDestroyed) return;
        try {
            setMagnifierPauseState(this.dockUI.actor, AUTO_HIDE_MAGNIFIER_REASON, isPaused);
        } catch (_e) {}
    }

    _applyDockInputState(interactive) {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor || this.dockUI.actor._isDestroyed)
            return;

        const visit = a => {
            if (!a) return;
            try {
                a.reactive = interactive;
                const kids = a.get_children();
                for (let i = 0; i < kids.length; i++)
                    visit(kids[i]);
            } catch (_e) {}
        };

        visit(this.dockUI.actor);
    }

    _stopEdgePointerPoll() {
        if (this._edgePointerPollId) {
            GLib.source_remove(this._edgePointerPollId);
            this._edgePointerPollId = null;
        }
    }

    _pointerInEdgeTriggerZone(pad = 4) {
        if (!this.edgeTrigger) return false;
        try {
            if (!this.edgeTrigger.is_mapped?.() && !this.edgeTrigger.visible) return false;
        } catch (_e) {}

        const [px, py] = global.get_pointer();
        const [ex, ey] = this.edgeTrigger.get_transformed_position();
        const [ew, eh] = this.edgeTrigger.get_transformed_size();

        return (px >= ex - pad && px <= ex + ew + pad &&
            py >= ey - pad && py <= ey + eh + pad);
    }

    _startEdgePointerPoll() {
        this._stopEdgePointerPoll();
        if (this._destroyed || !this.isHidden) return;

        const mode = this._getHideMode();
        if (mode === 'none' || mode === 'never') return;

        this._edgePointerPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            if (this._destroyed || !this.isHidden) {
                this._edgePointerPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            const m = this._getHideMode();
            if (m === 'none' || m === 'never') {
                this._edgePointerPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            if (this._pointerInEdgeTriggerZone(2)) {
                let pressureDelay = 0;
                try {
                    const delaySetting = this.settings.get_int('edge-dwell-delay');
                    if (delaySetting >= 0) pressureDelay = delaySetting;
                } catch (_e) {}

                if (pressureDelay > 0) {
                    this._stopEdgePointerPoll();
                    this._edgeRevealTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, pressureDelay, () => {
                        this._edgeRevealTimerId = null;
                        if (this._pointerInEdgeTriggerZone(2)) {
                            this._pointerUpdate = true;
                            this._show(true, false);
                        } else if (this.isHidden) {
                            this._startEdgePointerPoll();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                    return GLib.SOURCE_REMOVE;
                }

                this._pointerUpdate = true;
                this._show(true, false);
                this._edgePointerPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _getHideMode() {
        return this.settings.get_string('hide-mode') || 'dodge-all';
    }
    _getDockPosition() {
        return this.settings.get_string('dock-position') || 'BOTTOM';
    }

    _updateEdgeTrigger() {
        if (!this.edgeTrigger || this._destroyed || !this.dockUI || this.dockUI._isDestroyed) return;

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return;

        const actualMonitor = monitorData.monitor;
        const pos = this._getDockPosition();
        const mode = this._getHideMode();

        const T = 1;

        let ex = 0, ey = 0, ew = 0, eh = 0;

        switch (pos) {
            case 'BOTTOM':
                ex = actualMonitor.x;
                ew = actualMonitor.width;
                ey = actualMonitor.y + actualMonitor.height - T;
                eh = T;
                break;
            case 'TOP':
                ex = actualMonitor.x;
                ew = actualMonitor.width;
                ey = actualMonitor.y;
                eh = T;
                break;
            case 'LEFT':
                ex = actualMonitor.x;
                ew = T;
                ey = actualMonitor.y;
                eh = actualMonitor.height;
                break;
            case 'RIGHT':
                ex = actualMonitor.x + actualMonitor.width - T;
                ew = T;
                ey = actualMonitor.y;
                eh = actualMonitor.height;
                break;
        }

        this.edgeTrigger.set_position(ex, ey);
        this.edgeTrigger.set_size(ew, eh);

        if (mode === 'none' || mode === 'never') {
            this.edgeTrigger.hide();
            this.edgeTrigger.reactive = false;
        } else {
            this.edgeTrigger.show();
            this.edgeTrigger.reactive = this.isHidden;
            const parent = this.edgeTrigger.get_parent();
            if (parent) parent.set_child_above_sibling(this.edgeTrigger, null);
        }
    }

    _getTheoreticalDockBounds() {
        let dw = this.dockUI.actor._cachedW || this.dockUI.actor.width || 100;
        let dh = this.dockUI.actor._cachedH || this.dockUI.actor.height || 48;

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return {
            x: 0,
            y: 0,
            width: dw,
            height: dh
        };
        const monitor = Main.layoutManager.getWorkAreaForMonitor(monitorData.index);

        const pos = this._getDockPosition();
        const margin = this.settings.get_int('dock-margin') || 0;

        switch (pos) {
            case 'TOP':
                return {
                    x: monitor.x + (monitor.width - dw) / 2, y: monitor.y + margin, width: dw, height: dh
                };
            case 'BOTTOM':
                return {
                    x: monitor.x + (monitor.width - dw) / 2, y: monitor.y + monitor.height - dh - margin, width: dw, height: dh
                };
            case 'LEFT':
                return {
                    x: monitor.x + margin, y: monitor.y + (monitor.height - dh) / 2, width: dw, height: dh
                };
            case 'RIGHT':
                return {
                    x: monitor.x + monitor.width - dw - margin, y: monitor.y + (monitor.height - dh) / 2, width: dw, height: dh
                };
        }
        return {
            x: 0,
            y: 0,
            width: dw,
            height: dh
        };
    }

    _isHovering() {
        if (!this.dockUI || !this.dockUI.actor || this.dockUI.actor._isDestroyed) return false;

        const [px, py] = global.get_pointer();
        const [dax, day] = this.dockUI.actor.get_transformed_position();

        let daw = this.dockUI.actor._cachedW || this.dockUI.actor.width;
        let dah = this.dockUI.actor._cachedH || this.dockUI.actor.height;

        const isVertical = this.dockUI.boxActor ? this.dockUI.boxActor.get_vertical() : false;

        let padX = 2;
        let padY = 2;

        if (!this.isHidden) {
            let hoverZoom = false;
            try {
                hoverZoom = this.settings.get_boolean('hover-zoom');
            } catch (e) {}

            let maxZoom = 1.0;
            if (hoverZoom) {
                try {
                    maxZoom = this.settings.get_double('hover-zoom-factor');
                } catch (e) {}
            }

            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
            let iconSize = 48;
            try {
                iconSize = this.settings.get_int('icon-size');
            } catch (e) {}

            const overflow = iconSize * actualMax;

            padX = isVertical ? Math.max(20, overflow) : 10;
            padY = isVertical ? 10 : Math.max(20, overflow);
        }

        let boundsLeft = dax,
            boundsRight = dax + daw,
            boundsTop = day,
            boundsBottom = day + dah;
        if (this.dockUI.actor.bgActor) {
            const [bx, by] = this.dockUI.actor.bgActor.get_transformed_position();
            const [bw, bh] = this.dockUI.actor.bgActor.get_transformed_size();
            boundsLeft = Math.min(boundsLeft, bx);
            boundsRight = Math.max(boundsRight, bx + bw);
            boundsTop = Math.min(boundsTop, by);
            boundsBottom = Math.max(boundsBottom, by + bh);
        }

        return (px >= boundsLeft - padX && px <= boundsRight + padX && py >= boundsTop - padY && py <= boundsBottom + padY);
    }

    _isValidWindow(win) {
        if (!win || win.minimized || win.unmanaging) return false;
        if (typeof win.is_skip_taskbar === 'function' && win.is_skip_taskbar()) return false;

        const type = win.get_window_type();
        if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK ||
            type === Meta.WindowType.MENU || type === Meta.WindowType.SPLASHSCREEN ||
            type === Meta.WindowType.DROPDOWN_MENU || type === Meta.WindowType.POPUP_MENU ||
            type === Meta.WindowType.OVERRIDE_OTHER || type === Meta.WindowType.TOOLTIP) {
            return false;
        }

        const wmClass = win.get_wm_class();
        if (wmClass === 'ding' || wmClass === 'DesktopUi' || wmClass === 'conky') return false;

        const ws = global.workspace_manager.get_active_workspace();
        return win.is_on_all_workspaces() || win.get_workspace() === ws;
    }

    _shouldStayVisibleForTransientUI() {
        if (!this.dockUI || this.dockUI._isDestroyed) return false;
        if (Main.overview.visible && !this.settings.get_boolean('independent-dock')) {
            return true;
        }

        if (this.isPaused()) return true;
        if (this.dockUI._isFloating || this.dockUI._activeContextMenu || (this.dockUI.appGridUI && this.dockUI.appGridUI.isOpen)) {
            return true;
        }

        try {
            if (typeof this.dockUI.shouldIgnoreAutoHide === 'function' && this.dockUI.shouldIgnoreAutoHide()) {
                return true;
            }
        } catch (_e) {}

        return false;
    }

    _recalculateOverlap() {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        if (this._shouldStayVisibleForTransientUI()) {
            this._pointerUpdate = false;
            this._updateHidden(false, false, false);
            return;
        }

        const mode = this._getHideMode();

        if (mode === 'none' || mode === 'never') {
            this._pointerUpdate = false;
            this._updateHidden(false, false, false);
            return;
        }
        if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
            this._pointerUpdate = false;
            this._updateHidden(true, true, true);
            return;
        }

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return;
        const dockMonitorIndex = monitorData.index;

        const bounds = this._getTheoreticalDockBounds();
        const focusWin = global.display.get_focus_window();

        let anyOverlap = false;
        let activeWinOverlap = false;
        let maximizedOverlap = false;

        for (const wa of global.get_window_actors()) {
            const win = wa.get_meta_window();
            if (!win || !this._isValidWindow(win) || win.get_monitor() !== dockMonitorIndex) continue;

            const r = win.get_frame_rect();
            const overlaps = (r.x < bounds.x + bounds.width && r.x + r.width > bounds.x &&
                r.y < bounds.y + bounds.height && r.y + r.height > bounds.y);

            if (!overlaps) continue;

            anyOverlap = true;
            if (win === focusWin) activeWinOverlap = true;
            if (win.maximized_horizontally || win.maximized_vertically || win.get_window_type() === Meta.WindowType.DIALOG) {
                maximizedOverlap = true;
            }
        }

        this._pointerUpdate = false;
        this._updateHidden(anyOverlap, activeWinOverlap, maximizedOverlap);
    }

    _updateHidden(anyOverlap, activeWinOverlap, maximizedOverlap) {
        if (this._destroyed) return;
        this._updateEdgeTrigger();

        if (this._shouldStayVisibleForTransientUI()) {
            this._show(true, false);
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

        shouldHide ? this._hide() : this._show(false, true);
    }

    _scheduleUpdate(delay = 50) {
        if (this._destroyed) return;
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

    _startHoverPolling() {
        if (this._hoverPollId) return;
        this._hoverPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => {
            if (this._destroyed || this.isHidden) {
                this._hoverPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            if (this._shouldStayVisibleForTransientUI() || this._isHovering()) {
                return GLib.SOURCE_CONTINUE;
            }

            const mode = this._getHideMode();
            if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
                this._hide();
            } else {
                this._scheduleUpdate(0);
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _forceShow(force = false) {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        if (!force && Main.overview.visible && this.settings.get_boolean('independent-dock')) return;

        this._cancelTimers();
        this._isAnimating = false;
        this.isHidden = false;

        if (this._hoverPollId) {
            GLib.source_remove(this._hoverPollId);
            this._hoverPollId = null;
        }

        if (this.dockUI.actor)
            this.dockUI.actor._isHidden = false;
        if (this.edgeTrigger) this.edgeTrigger.reactive = false;

        const actor = this.dockUI.actor;
        actor.remove_all_transitions();
        actor.show();
        actor.visible = true;
        actor.opacity = 255;
        actor.translation_x = 0;
        actor.translation_y = 0;

        this._applyDockInputState(true);

        this._updateEdgeTrigger();
        this._setAutoHideMagnifierPaused(false);
    }

    _show(force = false, _suppressAnimations = false) {
        if (!force && Main.overview.visible && this.settings.get_boolean('independent-dock')) return;

        if (!this.isHidden && !force && !this._hideTimerId && !this._showTimerId) {
            this._setAutoHideMagnifierPaused(false);
            return;
        }

        this._cancelTimers();
        this.isHidden = false;
        this._stopEdgePointerPoll();

        this._startHoverPolling();

        if (this.dockUI && this.dockUI.actor) this.dockUI.actor._isHidden = false;
        if (this.edgeTrigger) this.edgeTrigger.reactive = false;

        let unhideDelay = 0;
        if (this._pointerUpdate) {
            try {
                unhideDelay = this.settings.get_int('unhide-delay');
            } catch (e) {}
        }

        if (unhideDelay > 0 && !force) {
            this._showTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, unhideDelay, () => {
                this._showTimerId = null;
                this._animateShow();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._animateShow();
        }
    }

    _hide() {
        const mode = this._getHideMode();
        if (mode === 'none' || mode === 'never') return;

        if (this._shouldStayVisibleForTransientUI()) {
            return;
        }

        if (this._hideTimerId || this.isHidden) return;

        this._cancelTimers();

        let hideDelay = 200;
        try {
            hideDelay = this.settings.get_int('hide-delay');
        } catch (e) {}

        this._hideTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hideDelay, () => {
            this._hideTimerId = null;

            const currentMode = this._getHideMode();
            if (currentMode === 'none' || currentMode === 'never') return GLib.SOURCE_REMOVE;

            if (!this._isHovering()) {
                if (this._shouldStayVisibleForTransientUI()) {
                    return GLib.SOURCE_REMOVE;
                }

                this.isHidden = true;
                if (this._hoverPollId) {
                    GLib.source_remove(this._hoverPollId);
                    this._hoverPollId = null;
                }

                if (this.dockUI && this.dockUI.actor) this.dockUI.actor._isHidden = true;

                if (this.edgeTrigger && currentMode !== 'none' && currentMode !== 'never') {
                    this.edgeTrigger.reactive = true;
                }
                this._animateHide();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _animateShow() {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        if (this.edgeTrigger) this.edgeTrigger.reactive = false;

        this._applyDockInputState(true);

        this.dockUI.actor.remove_all_transitions();

        this.dockUI.actor.show();
        this.dockUI.actor.visible = true;

        if (this.dockUI._pendingRender && typeof this.dockUI._renderDock === 'function') {
            this.dockUI._renderDock(true);
        }

        if (typeof this.dockUI._updateLayout === 'function') {
            this.dockUI._updateLayout();
        }

        const pos = this._getDockPosition();
        const offset = (this.settings.get_int('dock-margin') || 0) + 80;
        const dw = this.dockUI.actor._cachedW || this.dockUI.actor.width || 100;
        const dh = this.dockUI.actor._cachedH || this.dockUI.actor.height || 48;

        let startTx = 0,
            startTy = 0;
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

        if (Math.abs(this.dockUI.actor.translation_x) > 5000 || Math.abs(this.dockUI.actor.translation_y) > 5000) {
            this.dockUI.actor.translation_x = startTx;
            this.dockUI.actor.translation_y = startTy;
        }

        const modeNow = this._getHideMode();
        if (modeNow === 'none' || modeNow === 'never') {
            this.dockUI.actor.opacity = 255;
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;
            this._applyDockInputState(true);
            this._setAutoHideMagnifierPaused(false);
            return;
        }

        this._isAnimating = true;

        if (this.dockUI.actor.opacity === 0) {
            this.dockUI.actor.opacity = 1;
        }

        this.dockUI.actor.ease({
            translation_x: 0,
            translation_y: 0,
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._isAnimating = false;
                if (this.isHidden) {
                    const modeAtComplete = this._getHideMode();
                    if (modeAtComplete === 'none' || modeAtComplete === 'never') {
                        this._forceShow();
                        return;
                    }
                    this.dockUI.actor.hide();
                    this.dockUI.actor.opacity = 0;
                    this._applyDockInputState(false);
                    this._updateEdgeTrigger();
                } else {
                    this._setAutoHideMagnifierPaused(false);
                }
            }
        });
    }

    _animateHide() {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        const mode = this._getHideMode();
        if (mode === 'none' || mode === 'never') {
            this._forceShow();
            return;
        }

        this._applyDockInputState(false);

        this.dockUI.actor.remove_all_transitions();
        this._setAutoHideMagnifierPaused(true);

        const pos = this._getDockPosition();
        const offset = (this.settings.get_int('dock-margin') || 0) + 80;

        const dw = this.dockUI.actor._cachedW || this.dockUI.actor.width || 100;
        const dh = this.dockUI.actor._cachedH || this.dockUI.actor.height || 48;

        let tx = 0,
            ty = 0;

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

        this._isAnimating = true;

        this.dockUI.actor.ease({
            translation_x: tx,
            translation_y: ty,
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this._isAnimating = false;
                if (this.isHidden) {
                    const modeAtComplete = this._getHideMode();
                    if (modeAtComplete === 'none' || modeAtComplete === 'never') {
                        this._forceShow();
                        return;
                    }

                    this.dockUI.actor.hide();
                    this.dockUI.actor.opacity = 0;
                    this.dockUI.actor.translation_x = tx;
                    this.dockUI.actor.translation_y = ty;

                    this._applyDockInputState(false);
                    this._updateEdgeTrigger();
                    this._startEdgePointerPoll();
                }
            },
        });
    }

    destroy() {
        this._setAutoHideMagnifierPaused(false);
        this._destroyed = true;
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
            try {
                if (s.id && s.obj) s.obj.disconnect(s.id);
            } catch (e) {}
        }
        this.signals = [];

        if (this.edgeTrigger) {
            try {
                Main.layoutManager.removeChrome(this.edgeTrigger);
                this.edgeTrigger.destroy();
            } catch (e) {}
            this.edgeTrigger = null;
        }

        if (this._trackedWin && this._trackedWinSignals) {
            this._trackedWinSignals.forEach(id => {
                try {
                    this._trackedWin.disconnect(id);
                } catch (e) {}
            });
            this._trackedWinSignals = [];
            this._trackedWin = null;
        }

        this.dockUI = null;
        this.settings = null;
    }
}