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
import { animateShow, animateHide, getHideOffsets } from './AutoHideAnimations.js';
import { WindowOverlapDetection, getVisibleMonitorWindows } from './WindowOverlapDetection.js';


const INIT_SYNC_DELAY_MS = 350;
const DEFAULT_CHECK_DEBOUNCE_MS = 50;
const WINDOW_EVENT_CHECK_MS = 20;
const WINDOW_RAISE_CHECK_MS = 16;
const FAST_CHECK_MS = 10;
const MIN_HIDE_DELAY_MS = 20;
const WINDOW_GEOMETRY_CHECK_MS = 32;

export default class AutoHideManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this.timers = new TimeoutTracker();

        this.isHidden = false;
        this.isAnimating = false;
        this._isHovered = false;
        this._isTrayDragging = false;
        this._wasFullscreen = false;
        this._isGrabPassThrough = false;
        this._isPointerCaptured = false;
        this._isUnredirectBlocked = false;
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
            () => this._onPointerEnter(),
            () => this._onPointerLeave(),
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

        this._initSyncTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, INIT_SYNC_DELAY_MS, () => {
            this._initSyncTimeoutId = 0;
            if (this._isDockAlive()) this.syncMode();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isDockAlive() {
        return Boolean(this.dockUI) && isActorAlive(this.dockUI.actor);
    }

    _getMode() {
        return Settings.hideMode || 'none';
    }

    _isOverviewOpen() {
        return Main.overview.visible || Main.overview.visibleTarget;
    }

    _onPointerEnter() {
        this._isHovered = true;
        this.showWithDelay();
    }

    _onPointerLeave() {
        this._isHovered = false;
        this.scheduleCheck(DEFAULT_CHECK_DEBOUNCE_MS);
    }

    _bindEvents() {
        if (this._isDockAlive()) {
            this.dockUI.actor.connectObject(
                'enter-event', () => {
                    this._onPointerEnter();
                    return Clutter.EVENT_PROPAGATE;
                },
                'leave-event', () => {
                    this._onPointerLeave();
                    return Clutter.EVENT_PROPAGATE;
                },
                this
            );
        }

        global.display.connectObject(
            'notify::focus-window', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
            'window-created', (_d, win) => this._trackWindow(win),
            'in-fullscreen-changed', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
            'restacked', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
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
            'size-change', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
            'map', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
            'destroy', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
            this
        );

        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this.scheduleCheck(WINDOW_EVENT_CHECK_MS),
            this
        );

        Main.overview.connectObject(
            'showing', () => this.show(),
            'hiding', () => this.scheduleCheck(DEFAULT_CHECK_DEBOUNCE_MS),
            'hidden', () => this.scheduleCheck(FAST_CHECK_MS),
            this
        );

        this._rebindAllOpenWindows();
    }

    _rebindAllOpenWindows() {
        const activeWs = global.workspace_manager.get_active_workspace();
        if (!activeWs) return;

        global.display.get_tab_list(Meta.TabList.NORMAL, activeWs).forEach(win => this._trackWindow(win));
    }

    _trackWindow(win) {
        if (!win || this._trackedWindows.has(win)) return;
        this._trackedWindows.add(win);

        win.connectObject(
            'position-changed', () => this._scheduleWindowGeometryCheck(),
            'size-changed', () => this._scheduleWindowGeometryCheck(),
            'raised', () => this.scheduleCheck(WINDOW_RAISE_CHECK_MS),
            'notify::fullscreen', () => this.scheduleCheck(FAST_CHECK_MS),
            'unmanaged', () => {
                win.disconnectObject(this);
                this._trackedWindows.delete(win);
                this.scheduleCheck(WINDOW_EVENT_CHECK_MS);
            },
            this
        );
    }

    syncMode() {
        if (!this._isDockAlive()) return;
        this._clearTimers();

        if (this._getMode() !== 'none') {
            this.edgeDetection.show();
            this._rebindAllOpenWindows();
            this.scheduleCheck(0);
            return;
        }

        const actor = this.dockUI.actor;
        this.edgeDetection.hide();
        this._setUnredirectBlocked(false);
        actor.remove_all_transitions();
        this.isHidden = false;
        this.isAnimating = false;
        actor.translation_x = 0;
        actor.translation_y = 0;
        actor.opacity = 255;
        actor.show();
    }

    setWindowGrabPassThrough(enabled) {
        if (!this._isDockAlive()) return;
        const nextState = Boolean(enabled);
        if (this._isGrabPassThrough === nextState) return;
        this._isGrabPassThrough = nextState;

        this.edgeDetection.setPassThrough(nextState);

        if (nextState) {
            this.forceHideImmediately();
            this.dockUI._dockBlur._hideBlur();
        } else if (this._getMode() === 'none') {
            this.show();
        } else {
            this._applyHiddenPosition();
            this.scheduleCheck(WINDOW_EVENT_CHECK_MS);
        }
    }

    updateTriggerGeometry() {
        if (this.edgeDetection) this.edgeDetection.updateGeometry();
    }

    _cancelHide() {
        this.timers.remove(this._hideTimeoutId);
        this._hideTimeoutId = 0;
    }

    _cancelShow() {
        this.timers.remove(this._showTimeoutId);
        this._showTimeoutId = 0;
    }

    _clearTimers() {
        this._cancelHide();
        this._cancelShow();
        this.timers.remove(this._initSyncTimeoutId);
        this.timers.remove(this._checkDebounceId);
        this._initSyncTimeoutId = 0;
        this._checkDebounceId = 0;
    }

    _scheduleWindowGeometryCheck() {
        if (!this._checkDebounceId) this.scheduleCheck(WINDOW_GEOMETRY_CHECK_MS);
    }

    scheduleCheck(delayMs) {
        this.timers.remove(this._checkDebounceId);
        this._checkDebounceId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._checkDebounceId = 0;
            if (this._isDockAlive()) this.checkVisibility();
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
        if (isActive && !this._isPointerCaptured) this.edgeDetection.show();
        else this.edgeDetection.hide();
    }

    _getHidePeek() {
        return this._wasFullscreen || this._isPointerCaptured ? 0 : Settings.autohidePeek;
    }

    _animateToHidden() {
        this.isAnimating = true;
        animateHide(this.dockUI, () => this._onHideFinished(), this._getHidePeek());
    }

    _onHideFinished() {
        this.isAnimating = false;
        this._setUnredirectBlocked(!this.isHidden || this._getHidePeek() > 0);
    }

    _applyHiddenPosition() {
        if (!this.isHidden || this._isGrabPassThrough || !this._isDockAlive()) return;
        this._animateToHidden();
    }

    _setUnredirectBlocked(blocked) {
        if (this._isUnredirectBlocked === blocked) return;
        this._isUnredirectBlocked = blocked;

        const compositor = global.compositor;
        if (compositor && compositor.disable_unredirect) {
            if (blocked) compositor.disable_unredirect();
            else compositor.enable_unredirect();
        } else if (blocked) {
            Meta.disable_unredirect_for_display(global.display);
        } else {
            Meta.enable_unredirect_for_display(global.display);
        }
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
        if (this._isOverviewOpen()) return false;
        return getVisibleMonitorWindows(this.dockUI).some(win => win.is_fullscreen());
    }

    _isFullscreenBlocked() {
        return !this._canShowInFullscreen() && this._isCurrentMonitorFullscreen();
    }

    _isPopupOrDragActive() {
        const d = this.dockUI;
        return Boolean(
            d._activeContextMenu ||
            d._activeFolderMenu ||
            d._activeTrayMenu ||
            (d._overflowMenu && d._overflowMenu._isOpen) ||
            (d._startMenu && d._startMenu.isOpen) ||
            d.actor._isDragging ||
            this._isTrayDragging ||
            (d.panelIntegrator && d.panelIntegrator.hasOpenPopupOrDrag())
        );
    }

    _revealIfEngaged() {
        if (this._isHovered) {
            this._revealWithDelay();
            return true;
        }
        if (this._isPopupOrDragActive()) {
            this._reveal();
            return true;
        }
        return false;
    }

    _enterFullscreenState() {
        if (this._wasFullscreen) return;
        this._wasFullscreen = true;
        this.dockUI._updateStruts();
        this._applyHiddenPosition();
    }

    _leaveFullscreenState() {
        if (!this._wasFullscreen) return;
        this._wasFullscreen = false;
        this.dockUI._updateStruts();
        this.dockUI.queueRender('incremental');
        this._applyHiddenPosition();
    }

    checkVisibility() {
        if (!this._isDockAlive() || !isActorAlive(this.dockUI.boxActor) || this._isGrabPassThrough) return;

        this._cancelHide();

        if (this._isOverviewOpen()) {
            this._reveal();
            return;
        }

        if (this._isCurrentMonitorFullscreen()) {
            this._enterFullscreenState();

            if (!this._canShowInFullscreen()) {
                this._syncEdge(false);
                this._slideOut();
                return;
            }

            this._syncEdge(true);
            if (!this._revealIfEngaged()) this._scheduleHide();
            return;
        }

        this._leaveFullscreenState();

        const mode = this._getMode();
        if (mode === 'none') {
            this._reveal();
            return;
        }

        this._syncEdge(true);
        if (this._revealIfEngaged()) return;

        if (this.overlapDetection.shouldHide(mode)) this._scheduleHide();
        else this._revealWithDelay();
    }

    _scheduleHide() {
        const finalDelay = Math.max(MIN_HIDE_DELAY_MS, Settings.hideDelay);

        this._hideTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, finalDelay, () => {
            this._hideTimeoutId = 0;
            if (this._isDockAlive()) this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _slideOut() {
        this._cancelHide();
        this._cancelShow();
        this._isHovered = false;

        if (this.isHidden || !this._isDockAlive()) return;

        this.isHidden = true;
        this._animateToHidden();
    }

    forceHideImmediately() {
        this._clearTimers();
        this._isHovered = false;
        this.isHidden = true;
        this.isAnimating = false;

        if (!this._isDockAlive()) return;

        const actor = this.dockUI.actor;
        const { hideX, hideY } = getHideOffsets(this.dockUI);
        actor.remove_all_transitions();
        actor.translation_x = hideX;
        actor.translation_y = hideY;
        actor.opacity = 0;
        this._setUnredirectBlocked(false);
    }

    showWithDelay() {
        if (this._isGrabPassThrough || this._isFullscreenBlocked()) return;
        this._revealWithDelay();
    }

    _revealWithDelay() {
        this._cancelHide();

        const unhideDelay = Settings.unhideDelay;
        if (unhideDelay <= 0) {
            this._reveal();
            return;
        }

        this._cancelShow();
        this._showTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, unhideDelay, () => {
            this._showTimeoutId = 0;
            if (this._isDockAlive()) this.show();
            return GLib.SOURCE_REMOVE;
        });
    }

    show() {
        if (this._isFullscreenBlocked()) return;
        this._reveal();
    }

    _reveal() {
        if (this._isGrabPassThrough || this.dockUI._originalPosForOverview) return;

        this._cancelHide();
        this._cancelShow();

        if (!this._isDockAlive()) return;
        this._setUnredirectBlocked(true);

        const actor = this.dockUI.actor;
        const isFullyShown = !this.isHidden && !this.isAnimating &&
            actor.opacity === 255 && actor.translation_x === 0 && actor.translation_y === 0;
        if (isFullyShown) return;

        this.isHidden = false;
        this.isAnimating = true;
        animateShow(this.dockUI, () => {
            this.isAnimating = false;
        });
    }

    hide() {
        this._cancelHide();
        this._cancelShow();

        if (this._getMode() === 'none') {
            this.show();
            return;
        }

        if (!this._isDockAlive() || this.isHidden) return;
        if (this._isHovered || this._isPopupOrDragActive()) return;

        if (this._isOverviewOpen()) {
            this._reveal();
            return;
        }

        this.isHidden = true;
        this._animateToHidden();
    }

    destroy() {
        this._clearTimers();
        this.timers.destroy();
        this._setUnredirectBlocked(false);

        this.settings.disconnectObject(this);
        this._cursorTracker.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        this._trackedWindows.forEach(win => win.disconnectObject(this));
        this._trackedWindows.clear();

        this.edgeDetection.destroy();
        this.edgeDetection = null;

        if (this._isDockAlive()) {
            const actor = this.dockUI.actor;
            actor.disconnectObject(this);
            actor.translation_x = 0;
            actor.translation_y = 0;
            actor.opacity = 255;
        }

        this.dockUI = null;
        this.settings = null;
    }
}