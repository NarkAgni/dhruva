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
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../Utils.js';
import { Settings } from '../SettingsManager.js';
import { EdgeDetection } from './EdgeDetection.js';
import { TimeoutTracker } from '../TimeoutTracker.js';
import { WindowOverlapDetection } from './WindowOverlapDetection.js';
import { animateShow, animateHide, getHideOffsets } from './AutoHideAnimations.js';


const INIT_SYNC_DELAY_MS = 350;
const DEFAULT_CHECK_DEBOUNCE_MS = 50;
const MIN_HIDE_DELAY_MS = 20;

export default class AutoHideManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this.timers = new TimeoutTracker();

        this.isHidden = false;
        this.isAnimating = false;
        this._isHovered = false;
        this._wasFullscreen = false;
        this._isGrabPassThrough = false;
        this._isPointerCaptured = false;
        this._cursorTracker = global.backend.get_cursor_tracker
            ? global.backend.get_cursor_tracker()
            : Meta.CursorTracker.get_for_display(global.display);

        this._hideTimeoutId = 0;
        this._showTimeoutId = 0;
        this._checkDebounceId = 0;
        this._initSyncTimeoutId = 0;
        this._trackedWindows = new Set();

        this.overlapDetection = new WindowOverlapDetection(this.dockUI);
        this.edgeDetection = new EdgeDetection(
            this.dockUI,
            () => {
                this._isHovered = true;
                this.showWithDelay();
            },
            () => {
                this._isHovered = false;
                this.scheduleCheck(DEFAULT_CHECK_DEBOUNCE_MS);
            },
            () => this._getEdgeDwellDelay()
        );

        this._bindEvents();
        this.updateTriggerGeometry();

        this.settings.connectObject(
            'changed::hide-mode', () => this.syncMode(),
            'changed::fullscreen-mode', () => this.scheduleCheck(0),
            'changed::fullscreen-reveal-delay', () => this.scheduleCheck(0),
            'changed::edge-dwell-delay', () => this.scheduleCheck(0),
            'changed::autohide-peek', () => this._applyHiddenPosition(),
            this
        );

        this._cursorTracker.connectObject('cursor-changed', () => this._syncPointerCapture(), this);

        if (this._initSyncTimeoutId) {
            this.timers.remove(this._initSyncTimeoutId);
            this._initSyncTimeoutId = 0;
        }
        this._initSyncTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, INIT_SYNC_DELAY_MS, () => {
            this._initSyncTimeoutId = 0;
            if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return GLib.SOURCE_REMOVE;
            this.syncMode();
            return GLib.SOURCE_REMOVE;
        });
    }

    _bindEvents() {
        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            this.dockUI.actor.connectObject(
                'enter-event', () => {
                    this._isHovered = true;
                    this.showWithDelay();
                    return Clutter.EVENT_PROPAGATE;
                },
                'leave-event', () => {
                    this._isHovered = false;
                    this.scheduleCheck(DEFAULT_CHECK_DEBOUNCE_MS);
                    return Clutter.EVENT_PROPAGATE;
                },
                this
            );
        }

        global.display.connectObject(
            'notify::focus-window', () => this.scheduleCheck(20),
            'window-created', (_d, win) => this._trackWindow(win),
            'in-fullscreen-changed', () => this.scheduleCheck(20),
            'restacked', () => this.scheduleCheck(20),
            this
        );

        Main.layoutManager.connectObject(
            'monitors-changed', () => {
                this.updateTriggerGeometry();
                this._rebindAllOpenWindows();
                this.scheduleCheck(DEFAULT_CHECK_DEBOUNCE_MS);
            },
            this
        );

        global.window_manager.connectObject(
            'size-change', () => this.scheduleCheck(20),
            'map', () => this.scheduleCheck(20),
            'destroy', () => this.scheduleCheck(20),
            this
        );

        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this.scheduleCheck(20),
            this
        );

        Main.overview.connectObject(
            'showing', () => {
                this.show();
            },
            'hiding', () => {
                this.scheduleCheck(DEFAULT_CHECK_DEBOUNCE_MS);
            },
            'hidden', () => {
                this.scheduleCheck(10);
            },
            this
        );

        this._rebindAllOpenWindows();
    }

    _rebindAllOpenWindows() {
        const activeWs = global.workspace_manager.get_active_workspace();
        if (!activeWs) return;

        const windows = global.display.get_tab_list(Meta.TabList.NORMAL, activeWs);
        for (let i = 0; i < windows.length; i++) {
            this._trackWindow(windows[i]);
        }
    }

    _trackWindow(win) {
        if (!win || this._trackedWindows.has(win)) return;
        this._trackedWindows.add(win);

        win.connectObject(
            'position-changed', () => this.scheduleCheck(16),
            'size-changed', () => this.scheduleCheck(16),
            'raised', () => this.scheduleCheck(16),
            'notify::fullscreen', () => this.scheduleCheck(10),
            'unmanaged', () => {
                win.disconnectObject(this);
                this._trackedWindows.delete(win);
                this.scheduleCheck(20);
            },
            this
        );
    }

    syncMode() {
        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;

        const mode = this.settings ? (Settings.hideMode || 'none') : 'none';
        this._clearTimers();

        if (mode === 'none') {
            this.edgeDetection.hide();
            this.dockUI.actor.remove_all_transitions();
            this.isHidden = false;
            this.isAnimating = false;
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;
            this.dockUI.actor.opacity = 255;
            this.dockUI.actor.show();
        } else {
            this.edgeDetection.show();
            this._rebindAllOpenWindows();
            this.scheduleCheck(0);
        }
    }

    setWindowGrabPassThrough(enabled) {
        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;
        const nextState = Boolean(enabled);
        if (this._isGrabPassThrough === nextState) return;
        this._isGrabPassThrough = nextState;

        if (this.edgeDetection) {
            this.edgeDetection.setPassThrough(this._isGrabPassThrough);
        }

        if (this._isGrabPassThrough) {
            this._clearTimers();
            this._isHovered = false;
            this.isHidden = true;
            this.isAnimating = false;

            this.forceHideImmediately();
            if (this.dockUI._dockBlur) {
                this.dockUI._dockBlur._hideBlur();
            }
        } else {
            const mode = this.settings ? (Settings.hideMode || 'none') : 'none';
            if (mode === 'none') {
                this.show();
            } else {
                this._applyHiddenPosition();
                this.scheduleCheck(20);
            }
        }
    }

    updateTriggerGeometry() {
        if (this.edgeDetection) {
            this.edgeDetection.updateGeometry();
        }
    }

    _clearTimers() {
        if (this._initSyncTimeoutId) {
            this.timers.remove(this._initSyncTimeoutId);
            this._initSyncTimeoutId = 0;
        }
        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) {
            this.timers.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }
        if (this._checkDebounceId) {
            this.timers.remove(this._checkDebounceId);
            this._checkDebounceId = 0;
        }
    }

    scheduleCheck(delayMs) {
        if (this._checkDebounceId) {
            this.timers.remove(this._checkDebounceId);
            this._checkDebounceId = 0;
        }

        this._checkDebounceId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._checkDebounceId = 0;
            if (!this.dockUI || !isActorAlive(this.dockUI.actor)) {
                return GLib.SOURCE_REMOVE;
            }
            this.checkVisibility();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncPointerCapture() {
        const isCaptured = !this._cursorTracker.get_sprite();
        if (isCaptured === this._isPointerCaptured) return;

        this._isPointerCaptured = isCaptured;
        this._applyHiddenPosition();
        this.scheduleCheck(0);
    }

    _syncEdge(isActive) {
        if (!this.edgeDetection) return;
        if (isActive && !this._isPointerCaptured) this.edgeDetection.show();
        else this.edgeDetection.hide();
    }

    _getHidePeek() {
        return this._wasFullscreen || this._isPointerCaptured ? 0 : Settings.autohidePeek;
    }

    _applyHiddenPosition() {
        if (!this.isHidden || this._isGrabPassThrough || !this.dockUI || !isActorAlive(this.dockUI.actor)) return;

        this.isAnimating = true;
        animateHide(this.dockUI, () => {
            this.isAnimating = false;
        }, this._getHidePeek());
    }

    _getFullscreenMode() {
        return Settings.hideMode === 'intelligent' ? Settings.fullscreenMode : 'hidden';
    }

    _canShowInFullscreen() {
        return this._getFullscreenMode() !== 'hidden';
    }

    _getEdgeDwellDelay() {
        const dwellDelay = Settings.edgeDwellDelay;
        if (this._wasFullscreen && this._getFullscreenMode() === 'delayed') {
            return Math.max(dwellDelay, Settings.fullscreenRevealDelay);
        }
        return dwellDelay;
    }

    _isCurrentMonitorFullscreen() {
        if (Main.overview && (Main.overview.visible || Main.overview.visibleTarget)) {
            return false;
        }

        if (!this.dockUI || !this.dockUI.monitorManager) return false;
        const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
        const curMonitorIdx = monitorResult ? monitorResult.index : 0;

        const activeWs = global.workspace_manager.get_active_workspace();
        if (!activeWs) return false;

        const windows = global.display.get_tab_list(Meta.TabList.NORMAL, activeWs);
        return windows.some(win => {
            if (!win || win.minimized) return false;
            if (win.is_hidden && win.is_hidden()) return false;
            return win.get_monitor() === curMonitorIdx && win.is_fullscreen();
        });
    }

    _isPopupOrDragActive() {
        if (!this.dockUI) return false;
        const d = this.dockUI;
        return Boolean(
            d._activeContextMenu ||
            d._activeFolderMenu ||
            d._activeTrayMenu ||
            (d._overflowMenu && d._overflowMenu._isOpen) ||
            (d.actor && d.actor._isDragging) ||
            this._isTrayDragging ||
            (d.panelIntegrator && d.panelIntegrator.hasOpenPopupOrDrag && d.panelIntegrator.hasOpenPopupOrDrag())
        );
    }

    checkVisibility() {
        if (!this.dockUI || !isActorAlive(this.dockUI.actor) || !isActorAlive(this.dockUI.boxActor)) {
            return;
        }
        if (this._isGrabPassThrough) return;

        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }

        const isOverviewOpen = Boolean(Main.overview && (Main.overview.visible || Main.overview.visibleTarget));

        if (isOverviewOpen) {
            this.show();
            return;
        }

        const isFullscreen = this._isCurrentMonitorFullscreen();

        if (isFullscreen) {
            if (!this._wasFullscreen) {
                this._wasFullscreen = true;
                if (this.dockUI) this.dockUI._updateStruts();
                this._applyHiddenPosition();
            }

            if (this._canShowInFullscreen()) {
                this._syncEdge(true);

                if (this._isHovered) {
                    this.showWithDelay();
                    return;
                }

                if (this._isPopupOrDragActive()) {
                    this.show();
                    return;
                }

                this._scheduleHide();
                return;
            }

            this._syncEdge(false);
            this._slideOut();
            return;
        }

        if (this._wasFullscreen) {
            this._wasFullscreen = false;
            if (this.dockUI) {
                this.dockUI._updateStruts();
                this.dockUI.queueRender('incremental');
            }
            this._applyHiddenPosition();
        }

        const mode = this.settings ? (Settings.hideMode || 'none') : 'none';
        if (mode !== 'none') this._syncEdge(true);

        if (mode === 'none') {
            this.show();
            return;
        }

        if (this._isHovered) {
            this.showWithDelay();
            return;
        }

        if (this._isPopupOrDragActive()) {
            this.show();
            return;
        }

        const shouldHide = this.overlapDetection.shouldHide(mode);

        if (shouldHide) {
            this._scheduleHide();
        } else {
            this.showWithDelay();
        }
    }

    _scheduleHide() {
        const finalDelay = Math.max(MIN_HIDE_DELAY_MS, Settings.hideDelay);

        this._hideTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, finalDelay, () => {
            this._hideTimeoutId = 0;
            if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return GLib.SOURCE_REMOVE;
            this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _slideOut() {
        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) {
            this.timers.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }
        this._isHovered = false;

        if (this.isHidden || !this.dockUI || !isActorAlive(this.dockUI.actor)) return;

        this.isHidden = true;
        this.isAnimating = true;

        animateHide(this.dockUI, () => {
            this.isAnimating = false;
        }, this._getHidePeek());
    }

    forceHideImmediately() {
        this._clearTimers();
        this._isHovered = false;
        this.isHidden = true;
        this.isAnimating = false;

        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;

        this.dockUI.actor.remove_all_transitions();
        const { hideX, hideY } = getHideOffsets(this.dockUI);
        this.dockUI.actor.translation_x = hideX;
        this.dockUI.actor.translation_y = hideY;
        this.dockUI.actor.opacity = 0;
    }

    showWithDelay() {
        if (this._isGrabPassThrough) return;
        const isOverviewOpen = Boolean(Main.overview && (Main.overview.visible || Main.overview.visibleTarget));
        const isFullscreen = this._isCurrentMonitorFullscreen();

        if (isFullscreen && !isOverviewOpen && !this._canShowInFullscreen()) {
            return;
        }

        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }

        const unhideDelay = Settings.unhideDelay;
        if (unhideDelay <= 0) {
            this.show();
            return;
        }

        if (this._showTimeoutId) {
            this.timers.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }

        this._showTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, unhideDelay, () => {
            this._showTimeoutId = 0;
            if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return GLib.SOURCE_REMOVE;
            this.show();
            return GLib.SOURCE_REMOVE;
        });
    }

    show() {
        if (this._isGrabPassThrough || this.dockUI._originalPosForOverview) return;
        const isOverviewOpen = Boolean(Main.overview && (Main.overview.visible || Main.overview.visibleTarget));
        const isFullscreen = this._isCurrentMonitorFullscreen();

        if (isFullscreen && !isOverviewOpen && !this._canShowInFullscreen()) {
            return;
        }

        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) {
            this.timers.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }

        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;
        if (!this.isHidden && !this.isAnimating &&
            this.dockUI.actor.opacity === 255 &&
            this.dockUI.actor.translation_x === 0 &&
            this.dockUI.actor.translation_y === 0) return;

        this.isHidden = false;
        this.isAnimating = true;

        animateShow(this.dockUI, () => {
            this.isAnimating = false;
        });
    }

    hide() {
        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) {
            this.timers.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }

        const mode = this.settings ? (Settings.hideMode || 'none') : 'none';
        if (mode === 'none') {
            this.show();
            return;
        }

        if (!this.dockUI || !isActorAlive(this.dockUI.actor)) return;
        if (this.isHidden) return;
        if (this._isHovered || this._isPopupOrDragActive()) return;

        if (Main.overview && (Main.overview.visible || Main.overview.visibleTarget)) {
            this.show();
            return;
        }

        this.isHidden = true;
        this.isAnimating = true;

        animateHide(this.dockUI, () => {
            this.isAnimating = false;
        }, this._getHidePeek());
    }

    destroy() {
        this._clearTimers();
        this.timers.destroy();

        if (this.settings) {
            this.settings.disconnectObject(this);
        }

        this._cursorTracker.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        this._trackedWindows.forEach(win => {
            if (win) win.disconnectObject(this);
        });
        this._trackedWindows.clear();

        if (this.edgeDetection) {
            this.edgeDetection.destroy();
            this.edgeDetection = null;
        }

        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            this.dockUI.actor.disconnectObject(this);
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;
            this.dockUI.actor.opacity = 255;
        }

        this.dockUI = null;
        this.settings = null;
    }
}