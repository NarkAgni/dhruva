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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { buildModules } from './Modules.js';
import AppContextMenu from './ContextMenu.js';
import AppManager from '../core/AppManager.js';
import DockManager from '../core/DockManager.js';
import FloatManager from '../core/FloatManager.js';
import ScrollManager from '../core/ScrollManager.js';
import MonitorManager from '../core/MonitorManager.js';
import { debounce, hexToRgba } from '../core/Utils.js';
import AutoHideManager from '../core/AutoHideManager.js';
import WorkspaceFilter from '../core/WorkspaceFilter.js';
import { cleanupTrashEffects } from './effects/TrashEffect.js';
import { animateIconClick } from './effects/IconClickEffect.js';
import NotificationManager from '../core/NotificationManager.js';
import { setupDragAndDrop, applyIconFilter } from './DragDrop.js';
import { applyDockTheme, extractWallpaperDominantColor, getChameleonAccentColor } from './Themes.js';
import { setupMagnification, teardownMagnification, applyRealtimeFrame, resetMagnification } from './Magnifier.js';
import { setupWindowEffects, teardownWindowEffects, animateMinimize, animateRestore, animateLaunch } from './effects/WindowEffects.js';


export default class DockUI {
    constructor(settings, openPrefsCallback, uuid, monitorIndex = null) {
        this._isDestroyed = false;
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.appManager = new AppManager(uuid);
        this.dockPosition = this.settings.get_string('dock-position') || 'BOTTOM';

        this.settingsSignals = [];
        this.appSystemSignals = [];
        this.displaySignals = [];
        this.wmSignals = [];
        this.workspaceSignals = [];
        this._activeContextMenu = null;
        this._ignoreAppTimers = [];
        this._musicPopupOpen = false;
        this._musicPopupPollId = null;
        this._musicPopupStageCaptureId = null;
        this._isolateMonitorRenderDelayId = null;
        this._handleAlignIdleId = null;
        this._magnifierSetupIdleId = null;
        this._cursorResetTimeouts = [];
        this._pillSignalMap = new Map();

        if (!DockUI._instances) DockUI._instances = new Set();
        DockUI._instances.add(this);

        this.actor = new Clutter.Actor({ name: 'DhruvaContainer', reactive: true });
        this.actor.clip_to_allocation = false;
        this.actor._isDestroyed = false;
        this.actor._dockUI = this;

        ScrollManager.setupDockScroll(this.actor, this.settings);

        this.actor.connect('button-release-event', (_actor, event) => {
            if (event.get_button() === 3 && !this._activeContextMenu) {
                const state = event.get_state();
                if ((state & Clutter.ModifierType.CONTROL_MASK) && this.openPrefsCallback) {
                    this.openPrefsCallback();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.bgActor = new St.Widget({ name: 'DhruvaBackground', style_class: 'plank-like-dock-bg' });
        this.bgActor.clip_to_allocation = false;
        this.bgActor.reactive = true;
        this.bgActor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                const state = event.get_state();
                if ((state & Clutter.ModifierType.CONTROL_MASK) && this.openPrefsCallback) {
                    this.openPrefsCallback();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.boxActor = new St.BoxLayout({
            name: 'Dhruva',
            style_class: 'plank-like-dock',
            reactive: true,
            track_hover: true,
        });
        this.boxActor.set_vertical(this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
        this.boxActor.clip_to_allocation = false;

        this.boxActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };

        this.actor.bgActor = this.bgActor;
        this.actor.boxActor = this.boxActor;
        this.actor.add_child(this.bgActor);
        this.actor.add_child(this.boxActor);

        this.monitorManager = new MonitorManager(this.settings, monitorIndex);
        this.dockManager = new DockManager(this, settings);
        this.notificationManager = new NotificationManager(this);

        this.floatManager = new FloatManager(this);
        this._isFloating = false;


        this._setupLayoutUpdates();
        this._setupChameleonWatcher();
        this._applyDynamicStyles();

        this.queueRender = debounce(this._renderDock.bind(this), 5);

        this.appSystemSignals.push(this.appManager.appSystem.connect('installed-changed', () => this.queueRender()));
        this.appSystemSignals.push(this.appManager.appSystem.connect('app-state-changed', () => this.queueRender()));

        this.wmSignals.push(global.window_manager.connect('destroy', () => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender();
        }));

        this.wmSignals.push(global.window_manager.connect('map', (wm, actor) => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender();

            if (this.actor) {
                this.actor._fixedSlots = null;
                this.actor._tooltipHoveredIndex = -1;
                this.actor._magTooltipAppId = null;
                try { resetMagnification(this.actor); } catch (_e) { }
            }

            if (this.settings.get_boolean('isolate-monitors')) {
                if (this._isolateMonitorRenderDelayId) {
                    GLib.source_remove(this._isolateMonitorRenderDelayId);
                    this._isolateMonitorRenderDelayId = null;
                }
                this._isolateMonitorRenderDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._isolateMonitorRenderDelayId = null;
                    if (!this._isDestroyed) this.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
            }

            if (this._isDestroyed || !this._pendingLaunches || this._pendingLaunches.length === 0) return;

            const win = actor.meta_window;
            if (!win || win.get_window_type() !== Meta.WindowType.NORMAL) return;

            const tracker = Shell.WindowTracker.get_default();
            const winApp = tracker.get_window_app(win);
            const winClass = win.get_wm_class() ? win.get_wm_class().toLowerCase() : '';

            let matchedIndex = -1;

            for (let i = 0; i < this._pendingLaunches.length; i++) {
                let p = this._pendingLaunches[i];
                if (p.appId && winApp && winApp.get_id() === p.appId) {
                    matchedIndex = i; break;
                } else if (p.isFolder && (winClass.includes('nautilus') || winClass.includes('files'))) {
                    matchedIndex = i; break;
                }
            }

            if (matchedIndex !== -1) {
                const pending = this._pendingLaunches.splice(matchedIndex, 1)[0];

                if (this.settings.get_boolean('isolate-monitors')) {
                    const targetMonitor = this.monitorManager.getCurrentMonitor().index;
                    if (win.get_monitor() !== targetMonitor) {
                        win.move_to_monitor(targetMonitor);
                    }
                }

                try {
                    animateLaunch(win, pending.btn, this.dockPosition);
                } catch (e) {
                    actor.opacity = 255;
                }
            }
        }));

        this.displaySignals.push(global.display.connect('notify::focus-window', () => {
            if (this._isDestroyed) return;
            const recentClick = this.actor._lastIconClickTime && (Date.now() - this.actor._lastIconClickTime < 1000);
            if (this.actor._launchingApp || recentClick) return;
            this.queueRender();
        }));

        this.displaySignals.push(global.display.connect('window-entered-monitor', () => {
            if (!this._isDestroyed && this.settings.get_boolean('isolate-monitors')) {
                this.queueRender();
            }
        }));

        this.displaySignals.push(global.display.connect('window-left-monitor', () => {
            if (!this._isDestroyed && this.settings.get_boolean('isolate-monitors')) {
                this.queueRender();
            }
        }));

        this.workspaceSignals.push(global.workspace_manager.connect('active-workspace-changed', () => {
            if (this._isDestroyed) return;
            try {
                if (this.settings.get_boolean('isolate-workspaces')) {
                    this.actor._lastIconClickTime = 0;
                    this.queueRender();
                }
            } catch (e) { }
        }));

        const settingsToWatch = [
            'icon-size', 'show-grid-button', 'show-running-indicators', 'hover-zoom', 'hover-zoom-factor',
            'lock-icons', 'show-apps-preview', 'click-effect', 'show-trash', 'show-clock',
            'clock-position', 'clock-font-size', 'show-desktop-button', 'show-home', 'show-downloads',
            'show-documents', 'show-pictures', 'show-videos', 'show-music', 'context-menu-size',
            'big-preview-size', 'minimize-effect', 'stroke-width', 'indicator-style', 'indicator-color',
            'indicator-size', 'indicator-spacing', 'indicator-glow', 'custom-folders', 'isolate-workspaces',
            'isolate-monitors', 'show-notification-badges', 'show-mounts'
        ];

        settingsToWatch.forEach(key => {
            this.settingsSignals.push(this.settings.connect(`changed::${key}`, () => {
                if (this.actor) {
                    try { resetMagnification(this.actor); } catch (e) { }
                }
                this.queueRender();
                this._updateLayout();
            }));
        });

        [
            'background-color', 'background-opacity', 'border-radius', 'stroke-color', 'stroke-opacity',
            'dock-padding', 'dock-height', 'icon-spacing', 'dock-theme', 'use-gradient', 'background-gradient-color',
            'gradient-direction'
        ].forEach(key => {
            this.settingsSignals.push(this.settings.connect(`changed::${key}`, () => {
                if (this.actor) {
                    try { resetMagnification(this.actor); } catch (e) { }
                }
                this._applyDynamicStyles();
                this._updateLayout();
            }));
        });

        ['dock-position', 'full-width', 'icon-alignment', 'grid-button-position'].forEach(key => {
            this.settingsSignals.push(this.settings.connect(`changed::${key}`, () => {
                this.dockPosition = this.settings.get_string('dock-position');
                this.boxActor.set_vertical(this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
                this._renderDock();
            }));
        });

        this.settingsSignals.push(this.settings.connect('changed::dock-margin', () => {
            if (!this._isDestroyed && this.dockManager) this.dockManager.updatePosition();
        }));
        this.settingsSignals.push(this.settings.connect('changed::preferred-monitor', () => {
            if (this._isDestroyed) return;
            this.dockManager.updatePosition();
            this.queueRender();
        }));

        this.volumeMonitor = Gio.VolumeMonitor.get();
        this.volumeSignals = [];
        this.volumeSignals.push(this.volumeMonitor.connect('mount-added', () => this.queueRender()));
        this.volumeSignals.push(this.volumeMonitor.connect('mount-removed', () => this.queueRender()));
        this._setupTrashMonitor();

        this.queueRender();
    }

    _setupLayoutUpdates() {
        this.boxActor.connect('notify::allocation', () => {
            if (this._allocIdleId) return;
            this._allocIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._allocIdleId = null;
                if (!this._isDestroyed && this.actor && this.actor.is_mapped()) {
                    this._updateLayout();
                    if (Main.overview.visible) this._applyOverviewDockMargin();
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _setupTrashMonitor() {
        this._trashMonitor = null;
        this._trashMonitorId = null;
        this._trashRefreshId = null;

        try {
            const trashDir = Gio.File.new_for_uri('trash://');
            this._trashMonitor = trashDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._trashMonitorId = this._trashMonitor.connect('changed', () => {
                if (this._isDestroyed) return;
                if (this._trashRefreshId) return;

                this._trashRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                    this._trashRefreshId = null;
                    if (!this._isDestroyed) this.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (_e) { }
    }

    triggerPostDragSettle() {
        if (this._isDestroyed) return;
        if (this._postDragSettleId) {
            GLib.source_remove(this._postDragSettleId);
        }
        this._postDragSettleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._postDragSettleId = null;
            if (!this._isDestroyed) {
                this._pendingRender = false;
                this._renderDock();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupChameleonWatcher() {
        try {
            this._bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
            const onWallpaperChange = () => {
                if (this._isDestroyed) return;
                this._chameleonColor = null;
                this._chameleonAccent = null;
                const currentTheme = this.settings.get_string('dock-theme');
                if (currentTheme === 'chameleon') {
                    this._applyDynamicStyles();
                    this.queueRender();
                }
            };
            this._bgSignalId = this._bgSettings.connect('changed::picture-uri', onWallpaperChange);
            this._bgSignalId2 = this._bgSettings.connect('changed::picture-uri-dark', onWallpaperChange);
        } catch (e) { }
    }

    _updateLayout() {
        if (this._isDestroyed || !this.actor || !this.boxActor) return;
        if (!this.actor.is_mapped()) return;
        try {
            if (this._wasDragging && !this.actor._isDragging) {
                this._wasDragging = false;
                if (this.actor._wasRealDrag) {
                    this.actor._wasRealDrag = false;
                    this.triggerPostDragSettle();
                }
            }
            if (this.actor._isDragging) {
                this._wasDragging = true;
            }

            let isFullWidth = this.settings.get_boolean('full-width');

            const pos = this.settings.get_string('dock-position');
            const isVertical = pos === 'LEFT' || pos === 'RIGHT';
            const gridPos = this.settings.get_string('grid-button-position') || 'END';
            const alignment = this.settings.get_string('icon-alignment') || 'CENTER';
            const monitorResult = this.monitorManager.getCurrentMonitor();
            if (!monitorResult || !monitorResult.monitor) return;
            const monitor = Main.layoutManager.getWorkAreaForMonitor(monitorResult.index);

            let [, boxW] = this.boxActor.get_preferred_width(-1);
            let [, boxH] = this.boxActor.get_preferred_height(-1);
            boxW = boxW || 10;
            boxH = boxH || 10;

            let gridW = 0, gridH = 0;
            if (this.gridBtn && this.gridBtn.visible && isFullWidth) {
                [, gridW] = this.gridBtn.get_preferred_width(-1);
                [, gridH] = this.gridBtn.get_preferred_height(-1);
            }

            const sWidth = !isFullWidth ? this.settings.get_int('stroke-width') : 0;

            const hoverZoom = this.settings.get_boolean('hover-zoom');
            const maxZoom = hoverZoom ? this.settings.get_double('hover-zoom-factor') : 1.0;
            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
            const iconSize = this.settings.get_int('icon-size');
            const maxExpansion = hoverZoom ? (iconSize * 3.5 * (actualMax - 1.0)) : 0;

            let actorW = isFullWidth ? (isVertical ? Math.max(boxW, gridW) + (sWidth * 2) : monitor.width) : boxW + (sWidth * 2);
            let actorH = isFullWidth ? (isVertical ? monitor.height : Math.max(boxH, gridH) + (sWidth * 2)) : boxH + (sWidth * 2);

            this.actor.set_size(actorW, actorH);

            let contentW = boxW;
            let contentH = boxH;
            if (isFullWidth && this.gridBtn && this.gridBtn.visible) {
                contentW += gridW + 80;
                contentH += gridH + 80;
            }

            const totalW = contentW + maxExpansion + (sWidth * 2);
            const totalH = contentH + maxExpansion + (sWidth * 2);

            let scale = 1.0;
            const paddingBuffer = 20;

            if (isVertical && totalH > monitor.height - paddingBuffer) {
                scale = (monitor.height - paddingBuffer) / totalH;
            } else if (!isVertical && totalW > monitor.width - paddingBuffer) {
                scale = (monitor.width - paddingBuffer) / totalW;
            }

            let pivotX = 0.5, pivotY = 0.5;
            if (pos === 'LEFT') pivotX = 0.0;
            else if (pos === 'RIGHT') pivotX = 1.0;
            else if (pos === 'TOP') pivotY = 0.0;
            else if (pos === 'BOTTOM') pivotY = 1.0;

            if (isFullWidth) {
                if (!isVertical) {
                    if (alignment === 'START') pivotX = 0.0;
                    else if (alignment === 'END') pivotX = 1.0;
                } else {
                    if (alignment === 'START') pivotY = 0.0;
                    else if (alignment === 'END') pivotY = 1.0;
                }
            }

            this.actor.set_pivot_point(pivotX, pivotY);
            this.actor.set_scale(scale, scale);

            let bgX, bgY, bgW, bgH;
            if (isFullWidth) {
                bgW = isVertical ? boxW + (sWidth * 2) : monitor.width / scale;
                bgH = isVertical ? monitor.height / scale : boxH + (sWidth * 2);

                if (!isVertical) {
                    bgX = -pivotX * monitor.width * ((1.0 / scale) - 1.0);
                    if (pos === 'BOTTOM') bgY = actorH - bgH;
                    else if (pos === 'TOP') bgY = 0;
                    else bgY = (actorH - bgH) / 2;
                } else {
                    bgY = -pivotY * monitor.height * ((1.0 / scale) - 1.0);
                    if (pos === 'RIGHT') bgX = actorW - bgW;
                    else if (pos === 'LEFT') bgX = 0;
                    else bgX = (actorW - bgW) / 2;
                }
            } else {
                bgW = actorW; bgH = actorH; bgX = 0; bgY = 0;
            }

            const padScale = 20 / scale;
            let gx = 0, gy = 0;
            let actualGridPos = gridPos;

            if (isFullWidth && this.gridBtn && this.gridBtn.visible) {
                if (alignment === 'START' && gridPos === 'START') actualGridPos = 'END';
                if (alignment === 'END' && gridPos === 'END') actualGridPos = 'START';

                if (actualGridPos === 'START') {
                    gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + padScale;
                    gy = isVertical ? bgY + padScale : bgY + (bgH - gridH) / 2;
                } else {
                    gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + bgW - gridW - padScale;
                    gy = isVertical ? bgY + bgH - gridH - padScale : bgY + (bgH - gridH) / 2;
                }
                this.gridBtn.set_position(gx, gy);
            }

            let contentX = sWidth, contentY = sWidth;
            const halfExp = maxExpansion / 2;
            const safetyGap = 40 / scale;

            if (!isVertical) {
                if (isFullWidth) {
                    if (alignment === 'START') contentX = bgX + padScale + halfExp;
                    else if (alignment === 'END') contentX = bgX + bgW - boxW - padScale - halfExp;
                    else contentX = bgX + (bgW - boxW) / 2;
                }
                contentY = bgY + (bgH - boxH) / 2;
            } else {
                if (isFullWidth) {
                    if (alignment === 'START') contentY = bgY + padScale + halfExp;
                    else if (alignment === 'END') contentY = bgY + bgH - boxH - padScale - halfExp;
                    else contentY = bgY + (bgH - boxH) / 2;
                }
                contentX = bgX + (bgW - boxW) / 2;
            }

            if (isFullWidth && this.gridBtn && this.gridBtn.visible) {
                if (!isVertical) {
                    if (actualGridPos === 'START') {
                        const gridRight = gx + gridW + safetyGap;
                        const boxLeft = contentX - halfExp;
                        if (boxLeft < gridRight) contentX += (gridRight - boxLeft);
                    } else {
                        const gridLeft = gx - safetyGap;
                        const boxRight = contentX + boxW + halfExp;
                        if (boxRight > gridLeft) contentX -= (boxRight - gridLeft);
                    }
                } else {
                    if (actualGridPos === 'START') {
                        const gridBottom = gy + gridH + safetyGap;
                        const boxTop = contentY - halfExp;
                        if (boxTop < gridBottom) contentY += (gridBottom - boxTop);
                    } else {
                        const gridTop = gy - safetyGap;
                        const boxBottom = contentY + boxH + halfExp;
                        if (boxBottom > gridTop) contentY -= (boxBottom - gridTop);
                    }
                }
            }

            this.boxActor.set_position(contentX, contentY);

            this.actor._isFullWidth = isFullWidth;
            this.bgActor._baseW = bgW;
            this.bgActor._baseH = bgH;

            this.bgActor.set_position(bgX, bgY);
            this.bgActor.set_size(bgW, bgH);

            if (this.floatManager && typeof this.floatManager._alignHandlesToEdges === 'function') {
                if (!this._handleAlignIdleId) {
                    this._handleAlignIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._handleAlignIdleId = null;
                        if (!this._isDestroyed && this.floatManager) {
                            this.floatManager._alignHandlesToEdges(bgX, bgY, bgW, bgH);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }

            if (this.dockManager && !this._isFloating) {
                this.dockManager.updatePosition();
            }

            if (this.actor._fixedSlots && !this.actor._isDragging) {
                this.actor._fixedSlots = null;
            }

            if (this.dockManager && this.actor.width > 0 && this.actor.height > 0) {
                if (!this._isFloating) {
                    this.dockManager.updatePosition();
                }
            }

            this.actor._cachedW = actorW;
            this.actor._cachedH = actorH;

            if (this.autoHideManager) {
                this.autoHideManager._updateEdgeTrigger();
                this.autoHideManager._scheduleUpdate(10);
            }
        } catch (e) { }
    }

    _applyDynamicStyles() {
        if (this._isDestroyed) return;
        if (!this.actor || !this.actor.is_mapped()) return;
        try {
            const isFullWidth = this.settings.get_boolean('full-width');
            let radius = isFullWidth ? 0 : this.settings.get_int('border-radius');

            const sWidth = this.settings.get_int('stroke-width');
            const sColorHex = this.settings.get_string('stroke-color');
            const sOpacity = this.settings.get_int('stroke-opacity') / 100.0;

            let borderStyle = sWidth > 0 && !isFullWidth ? `border: ${sWidth}px solid ${hexToRgba(sColorHex, sOpacity)};` : '';
            let baseLayoutCss = `border-radius: ${radius}px; ${borderStyle}`;

            const opacity = this.settings.get_int('background-opacity') / 100.0;

            let currentTheme = 'default';
            try { currentTheme = this.settings.get_string('dock-theme'); } catch (e) { }

            if (currentTheme === 'chameleon' && !this._chameleonColor) {
                const extracted = extractWallpaperDominantColor();
                if (extracted) {
                    this._chameleonColor = extracted;
                    this._chameleonAccent = getChameleonAccentColor(extracted.raw.r, extracted.raw.g, extracted.raw.b);
                } else {
                    this._chameleonColor = { bg: { r: 30, g: 30, b: 45 }, raw: { r: 80, g: 90, b: 120 } };
                    this._chameleonAccent = '#a0c8ff';
                }
            } else if (currentTheme !== 'chameleon') {
                this._chameleonColor = null;
                this._chameleonAccent = null;
            }

            const customConfig = {
                opacity: opacity,
                color1: hexToRgba(this.settings.get_string('background-color'), opacity),
                color2: hexToRgba(this.settings.get_string('background-gradient-color'), opacity),
                useGradient: this.settings.get_boolean('use-gradient'),
                direction: this.settings.get_string('gradient-direction'),
                chameleonColor: this._chameleonColor,
            };

            applyDockTheme(this.bgActor, currentTheme, baseLayoutCss, customConfig);

            const isVertical = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';
            const sidePad = this.settings.get_int('dock-padding');

            let heightPad = 6;
            try { heightPad = this.settings.get_int('dock-height'); } catch (e) { }

            let safeSidePad = isFullWidth ? sidePad : Math.max(sidePad, Math.ceil(radius * 0.45));
            let safeHeightPad = Math.max(heightPad, 4);

            let boxPad;
            if (isFullWidth) {
                boxPad = isVertical ? `4px ${safeHeightPad}px` : `${safeHeightPad}px 4px`;
            } else {
                boxPad = isVertical ? `${safeSidePad}px ${safeHeightPad}px` : `${safeHeightPad}px ${safeSidePad}px`;
            }

            const gap = this.settings.get_int('icon-spacing');

            this.boxActor.set_style(`background-color: transparent; padding: ${boxPad}; spacing: ${gap}px;`);

            if (currentTheme === 'chameleon' && this._chameleonColor) {
                const bg = this._chameleonColor.bg;
                this.actor._tooltipBg = `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.95)`;
                this.actor._tooltipFg = this._chameleonAccent;
                this.actor._clockFg = this._chameleonAccent;
            } else {
                this.actor._tooltipBg = 'rgba(20, 20, 22, 0.92)';
                this.actor._tooltipFg = 'rgba(255, 255, 255, 0.95)';
                this.actor._clockFg = 'rgba(255, 255, 255, 0.9)';
            }

            this.boxActor.get_children().forEach(c => {
                if (c.has_style_class_name && c.has_style_class_name('clock-module')) {
                    const label = c.get_child();
                    if (label) {
                        let fontSize = 15;
                        try { fontSize = this.settings.get_int('clock-font-size'); } catch (e) { }
                        label.set_style(`color: ${this.actor._clockFg}; font-size: ${fontSize}px; font-weight: 700; text-shadow: 0px 1px 3px rgba(0,0,0,0.7); padding: 0 2px;`);
                    }
                }
            });
        } catch (e) { }
    }

    _getIndicatorProps() {
        const indStyle = this.settings.get_string('indicator-style') || 'dot';
        const indSize = this.settings.get_int('indicator-size') || 4;
        const indGap = this.settings.get_int('indicator-spacing') || 4;
        const indGlow = this.settings.get_boolean('indicator-glow');
        const isVert = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';
        const iconSize = this.settings.get_int('icon-size') || 48;

        let currentTheme = 'default';
        try { currentTheme = this.settings.get_string('dock-theme'); } catch (e) { }
        const indColor = (currentTheme === 'chameleon' && this._chameleonAccent)
            ? this._chameleonAccent
            : (this.settings.get_string('indicator-color') || '#ffffff');

        let dw = indSize, dh = indSize, br = '100px';

        if (indStyle === 'dash') {
            const len = Math.max(12, indSize * 2.5);
            const thick = Math.max(2, Math.floor(indSize / 1.2));
            dw = isVert ? thick : len; dh = isVert ? len : thick; br = '2px';
        } else if (indStyle === 'line') {
            const len = iconSize;
            const thick = Math.max(2, Math.floor(indSize / 1.5));
            dw = isVert ? thick : len; dh = isVert ? len : thick; br = '2px';
        } else if (indStyle === 'square') {
            dw = indSize; dh = indSize; br = '2px';
        }

        let marginStr = '';
        if (this.dockPosition === 'BOTTOM') marginStr = `margin-top: ${indGap}px; margin-bottom: 2px;`;
        else if (this.dockPosition === 'TOP') marginStr = `margin-bottom: ${indGap}px; margin-top: 2px;`;
        else if (this.dockPosition === 'LEFT') marginStr = `margin-right: ${indGap}px; margin-left: 2px;`;
        else if (this.dockPosition === 'RIGHT') marginStr = `margin-left: ${indGap}px; margin-right: 2px;`;

        const shadowStr = indGlow ? `box-shadow: 0px 0px 8px ${hexToRgba(indColor, 0.8)};` : '';
        const style = `width: ${dw}px; height: ${dh}px; background-color: ${indColor}; border-radius: ${br}; ${shadowStr}`;

        return { dw, dh, style, marginStr };
    }

    _renderDock(forceRender = false) {
        if (this._isDestroyed) return;

        if (!this.actor || (!this.actor.is_mapped() && forceRender !== true && this._initialRenderDone)) {
            this._pendingRender = true;
            return;
        }
        this._initialRenderDone = true;

        try {
            if (this.actor._isDragging) { this._pendingRender = true; return; }

            if (this._dropSettling) { this._pendingRender = true; return; }

            if (this.actor._lastIconClickTime) {
                const elapsed = Date.now() - this.actor._lastIconClickTime;
                if (elapsed < 850) {
                    this._pendingRender = false;
                    if (!this._delayedRenderId) {
                        this._delayedRenderId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 850 - elapsed + 10, () => {
                            this._delayedRenderId = null;
                            this.queueRender();
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    return;
                }
            }

            this._pendingRender = false;

            const oldVisuals = new Map();
            const cacheActor = (c) => {
                try {
                    if (!c || (typeof c.is_destroyed === 'function' && c.is_destroyed())) return;
                    let id = null;
                    if (c._delegate?.app?.get_id) id = c._delegate.app.get_id();
                    else if (c.has_style_class_name?.('clock-module')) id = 'dhruva-clock';
                    else if (c.get_child?.()?.has_style_class_name?.('dock-grid-icon')) id = 'dhruva-grid-button';

                    if (id) {
                        oldVisuals.set(id, {
                            sx: c.scale_x, sy: c.scale_y,
                            tx: c.translation_x, ty: c.translation_y
                        });
                    }
                } catch (_e) { }
            };

            let externalActors = [];
            if (!this._safeHouse) {
                this._safeHouse = new St.Widget({ visible: false });
                this.actor.add_child(this._safeHouse);
            }

            if (this.boxActor) {
                try {
                    this.boxActor.get_children().forEach(c => {
                        cacheActor(c);
                        const sClass = typeof c.get_style_class_name === 'function' ? c.get_style_class_name() : (c.style_class || '');
                        const isDhruvaElement = sClass.includes('dock-app-button') ||
                            sClass.includes('dock-separator') ||
                            sClass.includes('dock-drag-handle') ||
                            (sClass.includes('clock-module') && c.get_child?.()?.has_style_class_name?.('dock-clock-label')) ||
                            c._isModule;

                        if (!isDhruvaElement || c._isExternal) {
                            if (typeof c.add_style_class_name === 'function') c.add_style_class_name('clock-module');
                            c._isExternal = true;
                            externalActors.push(c);
                            this.boxActor.remove_child(c);
                            this._safeHouse.add_child(c);
                        }
                    });
                } catch (_e) { }
            }

            if (this._safeHouse && typeof this._safeHouse.get_children === 'function') {
                try {
                    this._safeHouse.get_children().forEach(c => {
                        if (!c || !c._isExternal) return;
                        if (!externalActors.includes(c)) externalActors.push(c);
                    });
                } catch (_e) { }
            }

            if (this.gridBtn) {
                try { cacheActor(this.gridBtn); } catch (_e) { }
            }

            let _gridBtnOnActor = false;
            if (this.gridBtn) {
                try { _gridBtnOnActor = this.gridBtn.get_parent() === this.actor; } catch (_e) { }
            }

            this.boxActor.destroy_all_children();

            if (this.gridBtn) {
                const _btn = this.gridBtn;
                this.gridBtn = null;
                if (_gridBtnOnActor) {
                    try { _btn.destroy(); } catch (_e) { }
                }
            }

            const displayAppsRaw = this.appManager.getDisplayApps();
            let displayApps = displayAppsRaw;

            if (this._ignoringApps && this._ignoringApps.size > 0) {
                displayApps = displayAppsRaw.filter(app => {
                    if (typeof app.get_id !== 'function') return true;
                    if (this.appManager.hasApp(app)) return true;
                    return !this._ignoringApps.has(app.get_id());
                });
            }

            const iconSize = this.settings.get_int('icon-size');
            const showIndicators = this.settings.get_boolean('show-running-indicators');
            const hoverZoom = this.settings.get_boolean('hover-zoom');
            const showTooltips = this.settings.get_boolean('show-apps-preview');
            const zoomFactor = this.settings.get_double('hover-zoom-factor');
            const isFullWidth = this.settings.get_boolean('full-width');
            const isVerticalDock = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';

            const pinnedButtons = [];
            const unpinnedButtons = [];
            const runningStateCache = new Map();

            const getAppRunningState = (app) => {
                if (runningStateCache.has(app)) return runningStateCache.get(app);

                let isRunning = app.get_state() === Shell.AppState.RUNNING;
                let finalActiveWindows = WorkspaceFilter.filterWindows(app.get_windows(), this.settings);

                if (this.settings.get_boolean('isolate-monitors')) {
                    const currentMonitorIndex = this.monitorManager.getCurrentMonitor().index;
                    finalActiveWindows = finalActiveWindows.filter(w => w.get_monitor() === currentMonitorIndex);
                }

                if (this.settings.get_boolean('isolate-workspaces') && finalActiveWindows.length === 0) {
                    isRunning = false;
                }

                if (this.settings.get_boolean('isolate-monitors') && finalActiveWindows.length === 0) {
                    isRunning = false;
                }

                if (this._ignoringApps && typeof app.get_id === 'function' && this._ignoringApps.has(app.get_id())) {
                    isRunning = false;
                }

                const result = { isRunning, finalActiveWindows };
                runningStateCache.set(app, result);
                return result;
            };

            const hasAnyRunningIndicator = showIndicators && displayApps.some(app => {
                const state = getAppRunningState(app);
                return state.isRunning;
            });

            displayApps.forEach(app => {
                const runningState = getAppRunningState(app);
                const isRunning = runningState.isRunning;
                const finalActiveWindows = runningState.finalActiveWindows;

                const appBox = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    clip_to_allocation: false
                });
                appBox.set_vertical(!isVerticalDock);
                appBox.set_pivot_point(0.5, 0.5);

                const actualMaxZoom = hoverZoom ? (1.0 + (zoomFactor - 1.0) * 2.0) : 1.0;
                const renderSize = Math.ceil(iconSize * actualMaxZoom);
                const icon = app.create_icon_texture(renderSize);
                icon.set_size(iconSize, iconSize);

                const iconBin = new St.Bin({
                    child: icon, width: iconSize, height: iconSize,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true, y_expand: true
                });
                iconBin.set_pivot_point(0.5, 0.5);

                let iconWrapper = new St.Widget({
                    layout_manager: new Clutter.BinLayout(),
                    width: iconSize,
                    height: iconSize,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    clip_to_allocation: false,
                    x_expand: true, y_expand: true
                });

                iconWrapper.add_child(iconBin);

                if (this.settings.get_boolean('show-notification-badges')) {
                    const count = this.notificationManager.getUnreadCount(app);
                    if (count > 0) {
                        const badge = this.notificationManager.createBadgeActor(count, iconSize);
                        if (badge) {
                            iconWrapper.add_child(badge);
                        }
                    }
                }

                if (isRunning && showIndicators) {
                    const indProps = this._getIndicatorProps();
                    const indStyle = this.settings.get_string('indicator-style') || 'dot';
                    const numDots = (finalActiveWindows.length > 1 && indStyle !== 'line') ? 2 : 1;

                    const dotBox = new St.BoxLayout({
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER
                    });
                    dotBox.set_vertical(isVerticalDock);
                    dotBox._isIndicator = true;
                    dotBox.set_style(`${indProps.marginStr} spacing: 4px;`);

                    for (let i = 0; i < numDots; i++) {
                        const dot = new St.Widget({
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER
                        });
                        dot.set_size(indProps.dw, indProps.dh);
                        dot.set_style(indProps.style);
                        dotBox.add_child(dot);
                    }

                    if (this.dockPosition === 'BOTTOM' || this.dockPosition === 'RIGHT') {
                        appBox.add_child(iconWrapper); appBox.add_child(dotBox);
                    } else {
                        appBox.add_child(dotBox); appBox.add_child(iconWrapper);
                    }
                } else {
                    appBox.add_child(iconWrapper);
                }

                const btn = new St.Bin({
                    child: appBox, style_class: 'dock-app-button',
                    reactive: true, track_hover: true, can_focus: false,
                    clip_to_allocation: false
                });
                btn.set_pivot_point(0.5, 0.5);
                btn._hasRunningIndicator = isRunning && showIndicators;

                btn._delegate = { app: app };

                setupDragAndDrop(btn, app, this);
                if (hoverZoom) applyIconFilter(btn);

                btn.connect('button-press-event', (_actor, event) => {
                    if (this._activeContextMenu) return Clutter.EVENT_STOP;

                    if (event.get_button() === 1) {
                        this.actor._lastIconClickTime = Date.now();
                    }
                    const [px, py] = event.get_coords();
                    btn._pressX = px; btn._pressY = py;
                    return Clutter.EVENT_PROPAGATE;
                });

                btn._activateCallback = (buttonNum, state = 0) => {
                    const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
                    if (buttonNum === 1) {
                        Main.overview.hide();

                        if (isCtrl) {
                            if (app.get_state() === Shell.AppState.RUNNING && typeof app.can_open_new_window === 'function' && app.can_open_new_window()) {
                                app.open_new_window(-1);
                            } else {
                                app.activate();
                            }
                            this._scheduleCursorResetBurst();
                            animateIconClick(iconBin, this.settings.get_string('click-effect'));
                            return;
                        }

                        if (this.settings.get_boolean('isolate-monitors')) {
                            const currentMonitorIndex = this.monitorManager.getCurrentMonitor().index;
                            windows = windows.filter(w => w.get_monitor() === currentMonitorIndex);
                        }

                        animateIconClick(iconBin, this.settings.get_string('click-effect'));

                        const windows = app.get_windows();
                        const focusWin = global.display.get_focus_window();
                        const activeWin = windows.find(w => w === focusWin);

                        if (activeWin) {
                            animateMinimize(activeWin, btn, this.dockPosition);
                        }
                        else if (windows[0]) {
                            animateRestore(windows[0], btn, this.dockPosition);
                        }
                        else {
                            this.actor._launchingApp = true;

                            if (this._launchTimeoutId) GLib.source_remove(this._launchTimeoutId);
                            this._launchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                                this.actor._launchingApp = false;
                                this._launchTimeoutId = null;
                                return GLib.SOURCE_REMOVE;
                            });

                            if (app.get_state() === Shell.AppState.RUNNING && typeof app.can_open_new_window === 'function' && app.can_open_new_window()) {
                                app.open_new_window(-1);
                            } else {
                                app.activate();
                            }

                            this._scheduleCursorResetBurst();

                            if (!this._pendingLaunches) this._pendingLaunches = [];
                            const pid = app.get_id();
                            this._pendingLaunches.push({ appId: pid, btn: btn });

                            if (!this._pendingLaunchTimeouts) this._pendingLaunchTimeouts = [];
                            const launchGuard = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                                this.actor._launchingApp = false;
                                this._pendingLaunchTimeouts = (this._pendingLaunchTimeouts || []).filter(id => id !== launchGuard);
                                return GLib.SOURCE_REMOVE;
                            });
                            this._pendingLaunchTimeouts.push(launchGuard);
                        }
                    } else if (buttonNum === 3) {
                        new AppContextMenu(this, app, btn, isCtrl, this.openPrefsCallback).show(this.dockPosition);
                    }
                };

                btn.connect('button-release-event', (_actor, event) => {
                    if (this._activeContextMenu) {
                        this._activeContextMenu.hide();
                        return Clutter.EVENT_STOP;
                    }

                    const button = event.get_button();
                    const state = event.get_state();

                    if (this.settings.get_boolean('lock-icons')) {
                        const [rx, ry] = event.get_coords();
                        const dx = Math.abs(rx - (btn._pressX || rx));
                        const dy = Math.abs(ry - (btn._pressY || ry));
                        if (dx > 15 || dy > 15) return Clutter.EVENT_STOP;
                    }

                    if (button === 1) {
                        if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
                        this.actor._lastIconClickTime = Date.now();
                        btn._activateCallback(1, state);
                        return Clutter.EVENT_STOP;
                    }
                    if (button === 3) { btn._activateCallback(3, state); return Clutter.EVENT_STOP; }
                    return Clutter.EVENT_PROPAGATE;
                });

                ScrollManager.setupAppScroll(btn, () => WorkspaceFilter.filterWindows(app.get_windows(), this.settings), this.settings);

                if (this.appManager.hasApp(app)) {
                    pinnedButtons.push(btn);
                } else {
                    unpinnedButtons.push(btn);
                }
            });

            const mods = buildModules(this, iconSize);
            const systemModules = mods.systemModules || [];
            const clockModule = mods.clockModule || null;

            let gridBtn = null;
            if (this.settings.get_boolean('show-grid-button')) {
                const gridIconSize = Math.floor(iconSize * 1.35);
                const gridIcon = new St.Icon({
                    icon_name: 'view-app-grid-symbolic',
                    icon_size: gridIconSize,
                    style_class: 'dock-grid-icon'
                });
                gridIcon.set_style('color: #ffffff;');
                gridIcon.set_pivot_point(0.5, 0.5);

                const gridIconBin = new St.Bin({
                    child: gridIcon, width: iconSize, height: iconSize,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER
                });
                gridIconBin.set_pivot_point(0.5, 0.5);

                gridBtn = new St.Bin({
                    child: gridIconBin, style_class: 'dock-app-button',
                    reactive: true, track_hover: true, can_focus: false
                });
                gridBtn.set_pivot_point(0.5, 0.5);
                gridBtn._hasRunningIndicator = false;

                let hasVisiblePill = externalActors.some(ea => this._hasExternalActorDockFootprint(ea));
                gridBtn._isStatic = hasVisiblePill;

                if (hoverZoom) applyIconFilter(gridBtn);

                gridBtn._activateCallback = (buttonNum) => {
                    if (buttonNum === 1) {
                        animateIconClick(gridIconBin, this.settings.get_string('click-effect'));
                        try {
                            const isAppsPageVisible = Main.overview.visible &&
                                Main.overview._overview?._controls?._appDisplay?.visible;

                            if (isAppsPageVisible) {
                                Main.overview.hide();
                            } else {
                                Main.overview.showApps();
                            }
                        } catch (_e) {
                            if (Main.overview.visible) {
                                Main.overview.hide();
                            } else {
                                Main.overview.showApps();
                            }
                        }
                    }
                };

                gridBtn.connect('button-press-event', (_actor, event) => {
                    if (this._activeContextMenu) return Clutter.EVENT_STOP;
                    return Clutter.EVENT_PROPAGATE;
                });

                gridBtn.connect('button-release-event', (_actor, event) => {
                    if (this._activeContextMenu) {
                        this._activeContextMenu.hide();
                        return Clutter.EVENT_STOP;
                    }

                    if (event.get_button() === 1) {
                        if (this.actor._lastIconClickTime !== undefined) this.actor._lastIconClickTime = Date.now();
                        gridBtn._activateCallback(1);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                this.gridBtn = gridBtn;

                this.gridBtn._delegate = {
                    app: {
                        is_module: true,
                        get_id: () => 'dhruva-grid-button',
                        get_name: () => 'Applications',
                        get_state: () => 0,
                        get_windows: () => [],
                    }
                };
            }

            const createSeparator = (isFull = false) => {
                const sep = new St.Widget({ style_class: 'dock-separator' });

                if (isVerticalDock) {
                    sep.set_style(`height: 2px; background-color: rgba(255,255,255,0.4); border-radius: 2px; margin: 4px 0;`);
                    sep.set_x_align(Clutter.ActorAlign.FILL);
                    sep.set_x_expand(true);
                } else {
                    sep.set_style(`width: 2px; background-color: rgba(255,255,255,0.4); border-radius: 2px; margin: 0 8px;`);
                    sep.set_y_align(Clutter.ActorAlign.FILL);
                    sep.set_y_expand(true);
                }
                return sep;
            };

            const startComponents = [];
            const endComponents = [];

            let gridPos = 'END';
            try { gridPos = this.settings.get_string('grid-button-position'); } catch (e) { }

            let clockPos = 'END';
            try { clockPos = this.settings.get_string('clock-position'); } catch (e) { }

            if (clockModule && clockPos === 'START') {
                startComponents.push(clockModule);
                startComponents.push(createSeparator(true));
            }

            if (gridPos !== 'START') {
                if ((gridBtn && !isFullWidth) || systemModules.length > 0) {
                    endComponents.push(createSeparator(false));
                }
                systemModules.forEach(m => endComponents.push(m));

                if (externalActors.length > 0) {
                    externalActors.forEach(ea => {
                        if (ea.get_parent?.() === this._safeHouse) this._safeHouse.remove_child(ea);
                        endComponents.push(ea);

                        if (typeof this.onMusicPillInjected === 'function') {
                            this.onMusicPillInjected(ea);
                        }
                    });
                }

                if (gridBtn && !isFullWidth) endComponents.push(gridBtn);
            } else {
                if (externalActors.length > 0) {
                    externalActors.forEach(ea => {
                        if (ea.get_parent?.() === this._safeHouse) this._safeHouse.remove_child(ea);
                        endComponents.push(ea);

                        if (typeof this.onMusicPillInjected === 'function') {
                            this.onMusicPillInjected(ea);
                        }
                    });
                }
            }

            if (clockModule && clockPos !== 'START') {
                endComponents.push(createSeparator(true));
                endComponents.push(clockModule);
            }

            const applyOldVisuals = (c) => {
                let cid = null;
                if (c._delegate?.app?.get_id) cid = c._delegate.app.get_id();
                else if (c.has_style_class_name?.('clock-module')) cid = 'dhruva-clock';
                else if (c.get_child?.()?.has_style_class_name?.('dock-grid-icon')) cid = 'dhruva-grid-button';

                if (cid && oldVisuals.has(cid)) {
                    let v = oldVisuals.get(cid);
                    const sx = typeof v.sx === 'number' ? v.sx : 1.0;
                    const sy = typeof v.sy === 'number' ? v.sy : 1.0;
                    const tx = typeof v.tx === 'number' ? v.tx : 0;
                    const ty = typeof v.ty === 'number' ? v.ty : 0;

                    const nearDefault =
                        Math.abs(sx - 1.0) <= 0.08 &&
                        Math.abs(sy - 1.0) <= 0.08 &&
                        Math.abs(tx) <= 6 &&
                        Math.abs(ty) <= 6;

                    c.scale_x = nearDefault ? sx : 1.0;
                    c.scale_y = nearDefault ? sy : 1.0;
                    c.translation_x = nearDefault ? tx : 0;
                    c.translation_y = nearDefault ? ty : 0;

                    const appBox = c.get_child?.();
                    if (appBox && typeof appBox.get_children === 'function') {
                        appBox.get_children().forEach(child => {
                            if (child._isIndicator) {
                                child.set_pivot_point(0.5, 0.5);
                                child.scale_x = nearDefault ? (1.0 / Math.max(0.01, sx)) : 1.0;
                                child.scale_y = nearDefault ? (1.0 / Math.max(0.01, sy)) : 1.0;
                            }
                        });
                    }
                }
            };

            startComponents.forEach(c => { applyOldVisuals(c); this.boxActor.add_child(c); });

            pinnedButtons.forEach(c => { applyOldVisuals(c); this.boxActor.add_child(c); });

            if (pinnedButtons.length > 0 && unpinnedButtons.length > 0) {
                const runningSep = createSeparator(false);
                if (isVerticalDock) {
                    runningSep.set_style(`height: 2px; background-color: rgba(255,255,255,0.12); border-radius: 2px; margin: 4px 0;`);
                } else {
                    runningSep.set_style(`width: 2px; background-color: rgba(255,255,255,0.12); border-radius: 2px; margin: 0 8px;`);
                }
                this.boxActor.add_child(runningSep);
            }

            unpinnedButtons.forEach(c => { applyOldVisuals(c); this.boxActor.add_child(c); });

            endComponents.forEach(c => {
                applyOldVisuals(c);
                this.boxActor.add_child(c);
                if (c._isExternal) {
                    try { c.unref(); } catch (_e) { }
                }
            });

            if (isFullWidth && this.gridBtn) {
                applyOldVisuals(this.gridBtn);
                this.actor.add_child(this.gridBtn);
            }

            const hasAnyModuleIndicator = systemModules.some(m => m && m._hasRunningIndicator);
            this._applyIndicatorBaselineAlignment(hasAnyRunningIndicator || hasAnyModuleIndicator);

            if (this.actor) {
                this.actor._fixedSlots = null;
                this.actor._tooltipHoveredIndex = -1;
                this.actor._magTooltipAppId = null;
            }

            if (hoverZoom || showTooltips) {
                teardownMagnification(this.actor);

                if (this._magnifierSetupIdleId) {
                    GLib.source_remove(this._magnifierSetupIdleId);
                    this._magnifierSetupIdleId = null;
                }
                this._magnifierSetupIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._magnifierSetupIdleId = null;
                    if (this._isDestroyed || !this.actor || !this.boxActor) return GLib.SOURCE_REMOVE;
                    setupMagnification(this.actor, this.settings, () => this.dockPosition);

                    global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                        if (this._isDestroyed || !this.actor || !this.boxActor) return false;
                        if (!this.actor.is_mapped()) return false;
                        try {
                            this.actor._fixedSlots = null;
                            const [cx, cy] = global.get_pointer();
                            const [ax, ay] = this.actor.get_transformed_position();

                            const hoverZoom = this.settings.get_boolean('hover-zoom');
                            const maxZoom = hoverZoom ? this.settings.get_double('hover-zoom-factor') : 1.0;
                            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
                            const overflow = this.settings.get_int('icon-size') * actualMax;

                            const padX = isVerticalDock ? 25 : Math.max(25, overflow);
                            const padY = isVerticalDock ? Math.max(25, overflow) : 25;

                            if (cx >= ax - padX && cx <= ax + this.actor.width + padX &&
                                cy >= ay - padY && cy <= ay + this.actor.height + padY) {
                                applyRealtimeFrame(this.actor, cx, cy, isVerticalDock, this.settings, Date.now());
                            } else {
                                resetMagnification(this.actor);
                            }
                        } catch (e) { }
                        return false;
                    });
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                teardownMagnification(this.actor);
            }

            this._applyDynamicStyles();
            this._updateLayout();
        } catch (e) {
            console.error('[Dhruva-Debug] _renderDock silent crash detected:', e, e.stack);
        }
    }

    _collectExternalActors() {
        const actors = [];
        const seen = new Set();

        const collectFrom = (container) => {
            if (!container || typeof container.get_children !== 'function') return;
            container.get_children().forEach(child => {
                if (!child || !child._isExternal || seen.has(child)) return;
                seen.add(child);
                actors.push(child);
            });
        };

        collectFrom(this.boxActor);
        collectFrom(this._safeHouse);
        return actors;
    }

    _hasExternalActorDockFootprint(actor) {
        if (!actor) return false;
        if (actor.visible === false) return false;
        if (typeof actor.is_destroyed === 'function' && actor.is_destroyed()) return false;
        
        if (actor.opacity === 0) return false;

        let width = 0;
        let height = 0;

        try {
            let [minW, natW] = actor.get_preferred_width(-1);
            let [minH, natH] = actor.get_preferred_height(-1);
            width = natW;
            height = natH;
        } catch (_e) {}

        if (width <= 1 || height <= 1) {
            try { [width, height] = actor.get_transformed_size(); } catch (_e) { }
        }
        if (width <= 1 || height <= 1) {
            width = Math.max(width, actor.width || 0);
            height = Math.max(height, actor.height || 0);
        }

        return width > 15 && height > 1;
    }

    _isMusicPopupControllerOpen(controller) {
        if (!controller) return false;

        const expandedOpen = !!(controller._expandedPlayer && controller._expandedPlayer.visible);
        const playerMenuOpen = !!(controller._playerMenu && controller._playerMenu.visible);
        if (expandedOpen || playerMenuOpen) return true;

        try {
            if (controller._pill && controller._pill._isPopupOpen) return true;
        } catch (_e) { }

        return false;
    }

    _isMusicPopupOpen() {
        const externalActors = this._collectExternalActors();
        return externalActors.some(actor => this._isMusicPopupControllerOpen(actor?._controller));
    }

    _getMusicPopupHitActors() {
        const hitActors = [];
        const externalActors = this._collectExternalActors();

        externalActors.forEach(actor => {
            const controller = actor?._controller;
            if (!controller) return;

            if (controller._expandedPlayer && controller._expandedPlayer.visible) {
                hitActors.push(controller._expandedPlayer._box || controller._expandedPlayer);
            }

            if (controller._playerMenu && controller._playerMenu.visible) {
                hitActors.push(controller._playerMenu._box || controller._playerMenu);
            }
        });

        return hitActors;
    }

    _isPointInsideActor(actor, px, py, pad = 0) {
        if (!actor || !actor.visible) return false;
        try {
            const [ax, ay] = actor.get_transformed_position();
            const [aw, ah] = actor.get_transformed_size();
            if (aw <= 0 || ah <= 0) return false;

            return px >= ax - pad && px <= ax + aw + pad && py >= ay - pad && py <= ay + ah + pad;
        } catch (_e) {
            return false;
        }
    }

    _isPointInsideMusicPopup(px, py) {
        const hitActors = this._getMusicPopupHitActors();
        if (hitActors.length === 0) return false;
        return hitActors.some(actor => this._isPointInsideActor(actor, px, py, 8));
    }

    _closeMusicPopups() {
        const externalActors = this._collectExternalActors();
        externalActors.forEach(actor => {
            const controller = actor?._controller;
            if (!controller) return;

            try {
                if (controller._expandedPlayer && controller._expandedPlayer.visible && typeof controller._expandedPlayer.hide === 'function') {
                    controller._expandedPlayer.hide();
                } else if (typeof controller.closeMenu === 'function') {
                    controller.closeMenu();
                }
            } catch (_e) { }

            try {
                if (controller._playerMenu && controller._playerMenu.visible && typeof controller._playerMenu.hide === 'function') {
                    controller._playerMenu.hide();
                } else if (typeof controller.closePlayerMenu === 'function') {
                    controller.closePlayerMenu();
                }
            } catch (_e) { }
        });

        this._musicPopupOpen = this._isMusicPopupOpen();
        this._syncMusicPopupOutsideClickCapture();
    }

    _syncMusicPopupOutsideClickCapture() {
        if (this._musicPopupOpen && !this._musicPopupStageCaptureId) {
            this._musicPopupStageCaptureId = global.stage.connect('captured-event', (_stage, event) => {
                if (this._isDestroyed || !this._musicPopupOpen) return Clutter.EVENT_PROPAGATE;
                if (event.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_PROPAGATE;

                const button = event.get_button();
                if (button !== 1 && button !== 3) return Clutter.EVENT_PROPAGATE;

                const [px, py] = event.get_coords();
                if (this._isPointInsideMusicPopup(px, py)) return Clutter.EVENT_PROPAGATE;

                this._closeMusicPopups();
                if (this.autoHideManager) this.autoHideManager._scheduleUpdate(0);
                return Clutter.EVENT_PROPAGATE;
            });
        } else if (!this._musicPopupOpen && this._musicPopupStageCaptureId) {
            try { global.stage.disconnect(this._musicPopupStageCaptureId); } catch (_e) { }
            this._musicPopupStageCaptureId = null;
        }
    }

    _startMusicPopupMonitor() {
        if (this._musicPopupPollId) return;
        this._musicPopupPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 220, () => {
            if (this._isDestroyed) {
                this._musicPopupPollId = null;
                return GLib.SOURCE_REMOVE;
            }

            const hasExternalActors = this._collectExternalActors().length > 0;
            if (!hasExternalActors && !this._musicPopupOpen) {
                return GLib.SOURCE_CONTINUE;
            }

            const openNow = hasExternalActors ? this._isMusicPopupOpen() : false;
            if (openNow !== this._musicPopupOpen) {
                this._musicPopupOpen = openNow;
                this._syncMusicPopupOutsideClickCapture();

                if (this.autoHideManager) {
                    if (openNow) this.autoHideManager._show(true);
                    this.autoHideManager._scheduleUpdate(0);
                }
            } else if (openNow && this.autoHideManager && this.autoHideManager.isHidden) {
                this.autoHideManager._show(true);
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopMusicPopupMonitor() {
        if (this._musicPopupPollId) {
            GLib.source_remove(this._musicPopupPollId);
            this._musicPopupPollId = null;
        }

        if (this._musicPopupStageCaptureId) {
            try { global.stage.disconnect(this._musicPopupStageCaptureId); } catch (_e) { }
            this._musicPopupStageCaptureId = null;
        }
    }

    isPreviewTooltipVisible() {
        const tooltip = this.actor?._magTooltip;
        return !!(tooltip && tooltip.visible && tooltip.opacity > 0);
    }

    shouldIgnoreAutoHide() {
        if (this.isPreviewTooltipVisible()) return true;
        return this._musicPopupOpen || this._isMusicPopupOpen();
    }

    _applyIndicatorBaselineAlignment(_hasAnyIndicator) {
        const isVerticalDock = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';

        const resetOffset = (actor) => {
            if (!actor) return;
            if (!actor._dhruvaIndicatorOffsetApplied) return;
            if (isVerticalDock) actor.translation_x = 0;
            else actor.translation_y = 0;
            actor._dhruvaIndicatorOffsetApplied = false;
        };

        const dockChildren = this.boxActor ? this.boxActor.get_children() : [];
        dockChildren.forEach(resetOffset);
        if (this.gridBtn) resetOffset(this.gridBtn);
    }

    onMusicPillInjected(pillActor) {
        if (!pillActor) return;

        const updateState = () => {
            if (this._isDestroyed) return;

            const currentOp = pillActor.opacity;
            const lastOp = pillActor._lastOpacity !== undefined ? pillActor._lastOpacity : 255;

            if (currentOp < lastOp && currentOp < 255 && pillActor.visible) {
                try { 
                    if (typeof pillActor.remove_all_transitions === 'function') {
                        pillActor.remove_all_transitions(); 
                    }
                } catch(_e){}
                pillActor.opacity = 0;
                pillActor.visible = false;
                pillActor._dhruvaHidden = true;
            } 
            else if (currentOp === 0 && pillActor.visible) {
                pillActor.visible = false;
                pillActor._dhruvaHidden = true; 
            } 
            else if (currentOp > 0 && pillActor._dhruvaHidden && currentOp >= lastOp) {
                pillActor.visible = true;
                pillActor._dhruvaHidden = false;
            }

            pillActor._lastOpacity = pillActor.opacity;
            
            if (this.gridBtn) {
                this.gridBtn._isStatic = (pillActor.visible && pillActor.width > 0);
            }

            const currentWidth = pillActor.width;
            if (pillActor._lastKnownWidth !== currentWidth) {
                pillActor._lastKnownWidth = currentWidth;

                if (this._pillAllocIdle) return;
                this._pillAllocIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._pillAllocIdle = null;
                    if (!this._isDestroyed) {
                        if (this.boxActor && typeof this.boxActor.queue_relayout === 'function') {
                            this.boxActor.queue_relayout();
                        }
                        if (this._updateLayout) this._updateLayout();
                        if (Main.overview.visible) this._applyOverviewDockMargin();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        };

        if (!pillActor._signalAttached) {
            pillActor._lastKnownWidth = -1;
            pillActor._dhruvaHidden = false;
            pillActor._lastOpacity = pillActor.opacity;
            pillActor.connect('notify::visible', updateState);
            pillActor.connect('notify::allocation', updateState); 
            pillActor.connect('notify::opacity', updateState);
            pillActor._signalAttached = true;
        }

        updateState();
    }

    show() {
        Main.layoutManager.addChrome(this.actor, { affectsStruts: false, trackFullscreen: true });

        this._mappedSignalId = this.actor.connect('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            if (this._mappedSignalId) {
                this.actor.disconnect(this._mappedSignalId);
                this._mappedSignalId = null;
            }
            if (!this._isDestroyed) {
                this._renderDock();
                if (this.dockManager) this.dockManager.updatePosition();
            }
        });

        this._monitorId = global.display.connect('workareas-changed', () => {
            if (this._isDestroyed) return;
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager._updateEdgeTrigger();
        });

        setupWindowEffects(this.settings);

        this.autoHideManager = new AutoHideManager(this, this.settings);
        this._startMusicPopupMonitor();

        const origHide = this.autoHideManager._hide.bind(this.autoHideManager);
        this.autoHideManager._hide = (...args) => {
            if (Main.overview.visible) return;
            origHide(...args);
        };

        if (typeof this.autoHideManager._checkState === 'function') {
            const origCheck = this.autoHideManager._checkState.bind(this.autoHideManager);
            this.autoHideManager._checkState = (...args) => {
                if (Main.overview.visible) return;
                origCheck(...args);
            };
        }

        this._overviewShowingId = Main.overview.connect('showing', () => {
            if (this.actor) this.actor.show();
            if (this.autoHideManager) this.autoHideManager._show(true);
            if (this.actor && typeof this.actor.queue_relayout === 'function') this.actor.queue_relayout();
            if (this.boxActor && typeof this.boxActor.queue_relayout === 'function') this.boxActor.queue_relayout();
            this._updateLayout();
            this._applyOverviewDockMargin();
        });

        this._overviewHidingId = Main.overview.connect('hiding', () => {
            this._clearOverviewDockMargin();
        });

        if (Main.overview.visible) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed) {
                    this._updateLayout();
                    this._applyOverviewDockMargin();
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        if (this.floatManager && typeof this.floatManager.applyPendingPatch === 'function') {
            this.floatManager.applyPendingPatch();
        }
    }

    _scheduleOverviewMarginRetry() {
        if (this._overviewMarginRetryId || this._isDestroyed) return;
        this._overviewMarginRetryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            this._overviewMarginRetryId = null;
            if (this._isDestroyed || !Main.overview.visible) return GLib.SOURCE_REMOVE;
            this._updateLayout();
            this._applyOverviewDockMargin();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyOverviewDockMargin() {
        try {
            const controls = Main.overview._overview?._controls;
            if (!controls) return;

            const pos = this.settings.get_string('dock-position') || 'BOTTOM';
            let dockH = this.actor?._cachedH || this.actor?.height || 0;
            let dockW = this.actor?._cachedW || this.actor?.width || 0;
            const margin = this.settings.get_int('dock-margin') || 0;
            const stroke = Math.max(0, this.settings.get_int('stroke-width') || 0) * 2;

            if (this.actor && this.actor.is_mapped()) {
                const [tw, th] = this.actor.get_transformed_size();
                dockW = Math.max(dockW, Math.round(tw || 0));
                dockH = Math.max(dockH, Math.round(th || 0));
            }

            if ((dockW <= 1 || dockH <= 1) && this.boxActor) {
                const [, prefW] = this.boxActor.get_preferred_width(-1);
                const [, prefH] = this.boxActor.get_preferred_height(-1);
                dockW = Math.max(dockW, Math.round((prefW || 0) + stroke));
                dockH = Math.max(dockH, Math.round((prefH || 0) + stroke));
            }

            const needsVerticalSpace = pos === 'BOTTOM' || pos === 'TOP';
            const needsHorizontalSpace = pos === 'LEFT' || pos === 'RIGHT';
            if ((needsVerticalSpace && dockH <= 1) || (needsHorizontalSpace && dockW <= 1)) {
                this._scheduleOverviewMarginRetry();
                return;
            }

            if (this._savedOverviewMargins === undefined) {
                this._savedOverviewMargins = {
                    bottom: controls.margin_bottom ?? 0,
                    top: controls.margin_top ?? 0,
                    left: controls.margin_left ?? 0,
                    right: controls.margin_right ?? 0,
                };
            }

            const extra = 35;

            controls.margin_bottom = this._savedOverviewMargins.bottom;
            controls.margin_top = this._savedOverviewMargins.top;
            controls.margin_left = this._savedOverviewMargins.left;
            controls.margin_right = this._savedOverviewMargins.right;

            if (pos === 'BOTTOM') controls.margin_bottom = Math.round(dockH + margin + extra);
            else if (pos === 'TOP') controls.margin_top = Math.round(dockH + margin + extra);
            else if (pos === 'LEFT') controls.margin_left = Math.round(dockW + margin + extra);
            else if (pos === 'RIGHT') controls.margin_right = Math.round(dockW + margin + extra);

        } catch (_e) { }
    }

    _clearOverviewDockMargin() {
        try {
            if (this._overviewMarginRetryId) {
                GLib.source_remove(this._overviewMarginRetryId);
                this._overviewMarginRetryId = null;
            }

            const controls = Main.overview._overview?._controls;
            if (!controls || this._savedOverviewMargins === undefined) return;

            controls.margin_bottom = this._savedOverviewMargins.bottom;
            controls.margin_top = this._savedOverviewMargins.top;
            controls.margin_left = this._savedOverviewMargins.left;
            controls.margin_right = this._savedOverviewMargins.right;
            this._savedOverviewMargins = undefined;

        } catch (_e) { }
    }

    _setDefaultCursor() {
        try {
            if (typeof Meta.CursorShape !== 'undefined') {
                global.display.set_cursor(Meta.CursorShape.DEFAULT);
            } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DEFAULT !== undefined) {
                global.display.set_cursor(Meta.Cursor.DEFAULT);
            }
        } catch (_e) { }
    }

    _scheduleCursorResetBurst() {
        this._setDefaultCursor();

        if (!this._cursorResetTimeouts) this._cursorResetTimeouts = [];
        this._cursorResetTimeouts.forEach(id => GLib.source_remove(id));
        this._cursorResetTimeouts = [];

        const delays = Array.from({length: 100}, (_, i) => i * 50); 
        
        delays.forEach(delayMs => {
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._cursorResetTimeouts = (this._cursorResetTimeouts || []).filter(id => id !== timeoutId);
                if (!this._isDestroyed) this._setDefaultCursor();
                return GLib.SOURCE_REMOVE;
            });
            this._cursorResetTimeouts.push(timeoutId);
        });
    }

    destroy() {
        this._isDestroyed = true;
        if (this.actor) this.actor._isDestroyed = true;
        this._stopMusicPopupMonitor();
        if (DockUI._instances) DockUI._instances.delete(this);

        if (this.queueRender?.cancel) this.queueRender.cancel();

        try {
            this.settingsSignals.forEach(id => this.settings.disconnect(id));
            this.settingsSignals = [];

            this.appSystemSignals.forEach(id => this.appManager.appSystem.disconnect(id));
            this.appSystemSignals = [];

            this.displaySignals.forEach(id => global.display.disconnect(id));
            this.displaySignals = [];

            if (this.wmSignals) {
                this.wmSignals.forEach(id => global.window_manager.disconnect(id));
                this.wmSignals = [];
            }

            if (this.workspaceSignals) {
                this.workspaceSignals.forEach(id => global.workspace_manager.disconnect(id));
                this.workspaceSignals = [];
            }

            if (this._allocIdleId) { GLib.source_remove(this._allocIdleId); this._allocIdleId = null; }
            if (this._isolateMonitorRenderDelayId) { GLib.source_remove(this._isolateMonitorRenderDelayId); this._isolateMonitorRenderDelayId = null; }
            if (this._handleAlignIdleId) { GLib.source_remove(this._handleAlignIdleId); this._handleAlignIdleId = null; }
            if (this._magnifierSetupIdleId) { GLib.source_remove(this._magnifierSetupIdleId); this._magnifierSetupIdleId = null; }

            if (this._delayedRenderId) { GLib.source_remove(this._delayedRenderId); this._delayedRenderId = null; }
            if (this._launchGuardId) { GLib.source_remove(this._launchGuardId); this._launchGuardId = null; }
            if (this._pendingCleanupId) { GLib.source_remove(this._pendingCleanupId); this._pendingCleanupId = null; }
            if (this._folderLaunchTimerId) { GLib.source_remove(this._folderLaunchTimerId); this._folderLaunchTimerId = null; }
            if (this._postDragSettleId) { GLib.source_remove(this._postDragSettleId); this._postDragSettleId = null; }
            if (this._pillAllocIdle) { GLib.source_remove(this._pillAllocIdle); this._pillAllocIdle = null; }
            if (this._overviewMarginRetryId) { GLib.source_remove(this._overviewMarginRetryId); this._overviewMarginRetryId = null; }
            if (this._trashRefreshId) { GLib.source_remove(this._trashRefreshId); this._trashRefreshId = null; }
            if (this._cursorResetTimeouts) {
                this._cursorResetTimeouts.forEach(id => GLib.source_remove(id));
                this._cursorResetTimeouts = [];
            }

            if (this._ignoreAppTimers) {
                this._ignoreAppTimers.forEach(id => GLib.source_remove(id));
                this._ignoreAppTimers = [];
            }

            try { if (this.floatManager) { this.floatManager.destroy(); this.floatManager = null; } } catch (e) { }

            cleanupTrashEffects();

            try { teardownWindowEffects(); } catch (e) { }
            try { teardownMagnification(this.actor); } catch (e) { }
            try { if (this.dockManager) this.dockManager.destroy(); } catch (e) { }

            if (this._pendingLaunchTimeouts) {
                this._pendingLaunchTimeouts.forEach(id => GLib.source_remove(id));
                this._pendingLaunchTimeouts = [];
            }

            if (this._folderTimeouts) {
                this._folderTimeouts.forEach(id => GLib.source_remove(id));
                this._folderTimeouts = [];
            }

            this._pendingRender = false;

            try { if (this.autoHideManager) { this.autoHideManager.destroy(); this.autoHideManager = null; } } catch (e) { }
            if (this._monitorId) global.display.disconnect(this._monitorId);
            if (this._overviewShowingId) { Main.overview.disconnect(this._overviewShowingId); this._overviewShowingId = null; }
            if (this._overviewHidingId) { Main.overview.disconnect(this._overviewHidingId); this._overviewHidingId = null; }
            this._clearOverviewDockMargin();

            if (this.actor) {
                if (this._mappedSignalId) {
                    try { this.actor.disconnect(this._mappedSignalId); } catch (e) { }
                    this._mappedSignalId = null;
                }
                try { Main.layoutManager.removeChrome(this.actor); } catch (e) { }
                try { this.actor.destroy(); } catch (e) { }
            }

            if (this.notificationManager) {
                this.notificationManager.destroy();
                this.notificationManager = null;
            }

            if (this.volumeSignals && this.volumeMonitor) {
                this.volumeSignals.forEach(id => this.volumeMonitor.disconnect(id));
                this.volumeSignals = [];
            }

            if (this._trashMonitor && this._trashMonitorId) {
                try { this._trashMonitor.disconnect(this._trashMonitorId); } catch (e) { }
                this._trashMonitorId = null;
            }
            this._trashMonitor = null;

            if (this._pillSignalMap && this._pillSignalMap.size > 0) {
                this._pillSignalMap.forEach((ids, pillActor) => {
                    if (!pillActor) return;
                    try { if (ids.visibleId) pillActor.disconnect(ids.visibleId); } catch (_e) { }
                    try { if (ids.allocId) pillActor.disconnect(ids.allocId); } catch (_e) { }
                    try { if (ids.opacityId) pillActor.disconnect(ids.opacityId); } catch (_e) { }
                    try { if (ids.destroyId) pillActor.disconnect(ids.destroyId); } catch (_e) { }
                });
                this._pillSignalMap.clear();
            }

            if (this._bgSettings) {
                if (this._bgSignalId) {
                    try { this._bgSettings.disconnect(this._bgSignalId); } catch (_e) { }
                }
                if (this._bgSignalId2) {
                    try { this._bgSettings.disconnect(this._bgSignalId2); } catch (_e) { }
                }
                this._bgSignalId = null;
                this._bgSignalId2 = null;
                this._bgSettings = null;
            }
        } catch (e) { }
    }
}
