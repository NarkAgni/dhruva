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

import { EdgeDetection } from './EdgeDetection.js';
import { TimeoutTracker } from '../TimeoutTracker.js';
import { animateShow, animateHide, getHideOffsets } from './AutoHideAnimations.js';
import { WindowOverlapDetection } from './WindowOverlapDetection.js';


export default class AutoHideManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this.timers = new TimeoutTracker();

        this.isHidden = false;
        this.isAnimating = false;
        this._isHovered = false;

        this._hideTimeoutId = 0;
        this._showTimeoutId = 0;
        this._checkDebounceId = 0;
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
                this.scheduleCheck(50);
            }
        );

        this._bindEvents();
        this.updateTriggerGeometry();

        this.settings.connectObject('changed::hide-mode', () => {
            this.syncMode();
        }, this);

        this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 350, () => {
            this.syncMode();
            return GLib.SOURCE_REMOVE;
        });
    }

    _bindEvents() {
        if (this.dockUI.actor) {
            this.dockUI.actor.connectObject(
                'enter-event', () => {
                    this._isHovered = true;
                    this.showWithDelay();
                    return Clutter.EVENT_PROPAGATE;
                },
                'leave-event', () => {
                    this._isHovered = false;
                    this.scheduleCheck(50);
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
                this.scheduleCheck(50);
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
                this.scheduleCheck(50);
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
        windows.forEach(win => {
            this._trackWindow(win);
        });
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
        const mode = this.settings ? (this.settings.get_string('hide-mode') || 'none') : 'none';
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

    updateTriggerGeometry() {
        if (this.edgeDetection) {
            this.edgeDetection.updateGeometry();
        }
    }

    _clearTimers() {
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
            this.checkVisibility();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isCurrentMonitorFullscreen() {
        const monitorResult = this.dockUI?.monitorManager?.getCurrentMonitor();
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

    checkVisibility() {
        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }

        if (this._isCurrentMonitorFullscreen()) {
            if (this.edgeDetection) this.edgeDetection.hide();
            this.forceHideImmediately();
            return;
        }

        const mode = this.settings ? (this.settings.get_string('hide-mode') || 'none') : 'none';
        if (mode !== 'none' && this.edgeDetection) {
            this.edgeDetection.show();
        }

        if (mode === 'none') {
            this.show();
            return;
        }

        if (this._isHovered) {
            this.showWithDelay();
            return;
        }

        if (Main.overview && (Main.overview.visible || Main.overview.visibleTarget)) {
            this.show();
            return;
        }

        if (this.dockUI._activeContextMenu || this.dockUI._activeFolderMenu) {
            this.show();
            return;
        }

        const shouldHide = this.overlapDetection.shouldHide(mode);

        if (shouldHide) {
            const userHideDelay = this.settings.get_int('hide-delay');
            const finalDelay = Math.max(20, userHideDelay);

            this._hideTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, finalDelay, () => {
                this._hideTimeoutId = 0;
                this.hide();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this.showWithDelay();
        }
    }

    forceHideImmediately() {
        this._clearTimers();
        this._isHovered = false;
        this.isHidden = true;
        this.isAnimating = false;

        if (!this.dockUI || !this.dockUI.actor) return;

        this.dockUI.actor.remove_all_transitions();
        const { hideX, hideY } = getHideOffsets(this.dockUI);
        this.dockUI.actor.translation_x = hideX;
        this.dockUI.actor.translation_y = hideY;
        this.dockUI.actor.opacity = 0;
    }

    showWithDelay() {
        if (this._isCurrentMonitorFullscreen()) return;

        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }

        const unhideDelay = this.settings.get_int('unhide-delay');
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
            this.show();
            return GLib.SOURCE_REMOVE;
        });
    }

    show() {
        if (this._isCurrentMonitorFullscreen()) return;

        if (this._hideTimeoutId) {
            this.timers.remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) {
            this.timers.remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }

        if (!this.dockUI || !this.dockUI.actor) return;
        if (!this.isHidden && !this.isAnimating && this.dockUI.actor.opacity === 255) return;

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

        const mode = this.settings ? (this.settings.get_string('hide-mode') || 'none') : 'none';
        if (mode === 'none') {
            this.show();
            return;
        }

        if (!this.dockUI || !this.dockUI.actor) return;
        if (this.isHidden && !this.isAnimating) return;
        if (this._isHovered) return;

        if (Main.overview && (Main.overview.visible || Main.overview.visibleTarget)) {
            this.show();
            return;
        }

        this.isHidden = true;
        this.isAnimating = true;

        animateHide(this.dockUI, () => {
            this.isAnimating = false;
        });
    }

    destroy() {
        this._clearTimers();
        this.timers.destroy();

        if (this.settings) {
            this.settings.disconnectObject(this);
        }

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

        if (this.dockUI && this.dockUI.actor) {
            this.dockUI.actor.disconnectObject(this);
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;
            this.dockUI.actor.opacity = 255;
        }

        this.dockUI = null;
        this.settings = null;
    }
}