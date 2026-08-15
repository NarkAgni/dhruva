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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import AppGridUI from '../AppGridUI.js';
import { debounce } from '../../core/Utils.js';
import AppManager from '../../core/AppManager.js';
import DockManager from '../../core/DockManager.js';
import ScrollManager from '../../core/ScrollManager.js';
import FolderManager from '../../core/FolderManager.js';
import MonitorManager from '../../core/MonitorManager.js';
import { TimerRegistry } from '../../core/TimerRegistry.js';
import { resetCursorToDefault } from '../shared/CursorUtils.js';
import { cleanupTrashEffects } from '../effects/TrashEffect.js';
import { teardownMagnification } from '../magnifier/Magnifier.js';
import NotificationManager from '../../core/NotificationManager.js';
import AutoHideManager from '../../core/autohide/AutoHideManager.js';
import { applyOverviewDockMargin, clearOverviewDockMargin } from './OverviewMargin.js';
import { setupWindowEffects, teardownWindowEffects } from '../effects/WindowEffects.js';
import { renderDock, applyDynamicStyles, getIndicatorProps, updateLayout, captureActorRect, isActorAlive } from './DockRenderer.js';


const WATCHED_SETTINGS = [
    'icon-size', 'show-grid-button', 'show-running-indicators', 'hover-zoom', 'hover-zoom-factor',
    'lock-icons', 'show-apps-preview', 'click-effect', 'show-trash', 'show-clock', 'use-24h-clock',
    'clock-position', 'clock-font-size', 'show-desktop-button', 'show-home', 'show-downloads',
    'show-documents', 'show-pictures', 'show-videos', 'show-music', 'context-menu-size',
    'big-preview-size', 'minimize-effect', 'stroke-width', 'indicator-style', 'indicator-color',
    'indicator-size', 'indicator-spacing', 'indicator-glow', 'custom-folders', 'isolate-workspaces',
    'isolate-monitors', 'show-notification-badges', 'show-mounts', 'show-app-separator', 'separator-width',
    'show-module-separator', 'separator-height', 'dock-padding', 'dock-height', 'tooltip-opacity',
    'separator-color', 'separator-opacity', 'running-separator-width', 'running-separator-height',
    'running-separator-color', 'running-separator-opacity', 'grid-icon-color', 'custom-grid-icon',
    'custom-grid-icon-scale', 'use-old-grid-icon', 'app-folders', 'show-unpinned-apps',
    'desktop-btn-width', 'desktop-btn-opacity', 'desktop-btn-color', 'show-independent-in-overview'
];

const STYLE_SETTINGS = [
    'background-color', 'background-opacity', 'border-radius', 'stroke-color', 'stroke-opacity',
    'icon-spacing', 'dock-theme', 'use-gradient', 'background-gradient-color',
    'gradient-direction'
];

export default class DockUI {
    static _instances = new Set();

    constructor(settings, openPrefsCallback, uuid, monitorIndex = null) {
        this._isDestroyed = false;
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.dockPosition = this.settings.get_string('dock-position') || 'BOTTOM';

        this.registry = new TimerRegistry();
        this._activeContextMenu = null;
        this._cursorResetTimeouts = [];

        this.appManager = new AppManager(uuid, this.settings);
        this.folderManager = new FolderManager(this.settings, uuid);
        this.monitorManager = new MonitorManager(this.settings, monitorIndex);
        this.dockManager = new DockManager(this, settings);
        this.notificationManager = new NotificationManager(this);
        this.appGridUI = new AppGridUI(this);
        this._initActors();
        this._bindMethods();
        this._connectSignals();
        DockUI._instances.add(this);
        this.queueRender();
    }

    _bindMethods() {
        this._renderDock = (force) => renderDock(this, force);
        this._updateLayout = () => updateLayout(this);
        this._applyDynamicStyles = () => applyDynamicStyles(this);
        this._getIndicatorProps = () => getIndicatorProps(this);
        this._captureActorRect = (actor, fb) => captureActorRect(this, actor, fb);
        this.isActorAlive = isActorAlive;
        
        this.queueRender = debounce((force) => {
            if (typeof this._renderDock === 'function') {
                this._renderDock(force);
            }
        }, 5);
    }

    _initActors() {
        this.actor = new Clutter.Actor({ name: 'DhruvaContainer', reactive: true });
        this.actor.clip_to_allocation = false;
        this.actor._dockUI = this;

        this.bgActor = new St.Widget({ name: 'DhruvaBackground', style_class: 'plank-like-dock-bg', reactive: true, clip_to_allocation: false });
        this.boxActor = new St.BoxLayout({ name: 'Dhruva', style_class: 'plank-like-dock', reactive: true, track_hover: true, clip_to_allocation: false });

        this.boxActor.set_vertical(this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
        this.boxActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };

        this.actor.add_child(this.bgActor);
        this.actor.add_child(this.boxActor);
        this.actor.bgActor = this.bgActor;
        this.actor.boxActor = this.boxActor;

        ScrollManager.setupDockScroll(this.actor, this.settings);
    }

    _connectSignals() {
        this.appManager.onStateChanged(() => this.queueRender());
        this.folderManager.onStateChanged(() => this.queueRender());

        const handlePrefsTrigger = (_actor, event) => {
            if (event.get_button() === 3 && !this._activeContextMenu) {
                if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) && this.openPrefsCallback) {
                    this.openPrefsCallback();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        };

        this.registry.connectSignal(this.actor, 'button-release-event', handlePrefsTrigger);
        this.registry.connectSignal(this.bgActor, 'button-press-event', handlePrefsTrigger);

        this.registry.connectSignal(this.boxActor, 'notify::allocation', () => {
            if (this._allocIdleId) return;
            this._allocIdleId = this.registry.addIdle(GLib.PRIORITY_DEFAULT, () => {
                this._allocIdleId = null;
                if (!this._isDestroyed && this.actor?.is_mapped()) {
                    this._updateLayout();
                    
                    if (Main.overview.dash && !this.settings.get_boolean('independent-dock')) {
                        const pos = this.dockPosition;
                        const margin = this.settings.get_int('dock-margin') || 0;
                        const extra = 95;
                        
                        if (pos === 'BOTTOM' || pos === 'TOP') {
                            Main.overview.dash.set_height(this.actor.height + margin + extra);
                            Main.overview.dash.set_width(-1);
                        } else {
                            Main.overview.dash.set_width(this.actor.width + margin + extra);
                            Main.overview.dash.set_height(-1);
                        }
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
        });

        this.registry.connectSignal(this.appManager.appSystem, 'installed-changed', () => this.queueRender());
        this.registry.connectSignal(this.appManager.appSystem, 'app-state-changed', () => this.queueRender());

        this.registry.connectSignal(global.window_manager, 'destroy', () => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender();
        });

        this.registry.connectSignal(global.window_manager, 'map', (wm, actor) => {
            if (this.actor) {
                this.actor._lastIconClickTime = 0;
                this.actor._fixedSlots = null;
                this.actor._tooltipHoveredIndex = -1;
                this.actor._magTooltipAppId = null;
            }
            this.queueRender();

            if (this.settings.get_boolean('isolate-monitors')) {
                if (this._isolateMonitorRenderDelayId) GLib.source_remove(this._isolateMonitorRenderDelayId);
                this._isolateMonitorRenderDelayId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._isolateMonitorRenderDelayId = null;
                    if (!this._isDestroyed) this.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
            }

            if (this._isDestroyed || !this._pendingLaunches || this._pendingLaunches.length === 0) return;
            const nowMs = Date.now();
            this._pendingLaunches = this._pendingLaunches.filter(p => p && (nowMs - (p.createdAt || nowMs)) < 8000);
            if (this._pendingLaunches.length === 0) return;

            const win = actor.meta_window;
            if (!win || win.get_window_type() !== Meta.WindowType.NORMAL) return;

            const tracker = Shell.WindowTracker.get_default();
            const winApp = tracker.get_window_app(win);
            const winClass = win.get_wm_class() ? win.get_wm_class().toLowerCase() : '';

            let matchedIndex = -1;
            for (let i = 0; i < this._pendingLaunches.length; i++) {
                const p = this._pendingLaunches[i];
                if (p.appId && winApp && winApp.get_id() === p.appId) {
                    matchedIndex = i;
                    break;
                } else if (p.isFolder && (winClass.includes('nautilus') || winClass.includes('files'))) {
                    matchedIndex = i;
                    break;
                }
            }

            if (matchedIndex !== -1) {
                const pending = this._pendingLaunches.splice(matchedIndex, 1)[0];
                if (this.settings.get_boolean('isolate-monitors')) {
                    const targetMonitor = this.monitorManager.getCurrentMonitor().index;
                    if (win.get_monitor() !== targetMonitor) win.move_to_monitor(targetMonitor);
                }

                try {
                    const iconRect = pending.iconRect || this._captureActorRect(pending.btn, win);
                    import('../effects/WindowEffects.js').then(module => {
                        module.animateLaunch(win, pending.btn, this.dockPosition, iconRect);
                    }).catch(() => { if (this.isActorAlive(actor)) actor.opacity = 255; });
                } catch (_e) {
                    if (this.isActorAlive(actor)) actor.opacity = 255;
                }
            }
        });

        this.registry.connectSignal(global.display, 'notify::focus-window', () => {
            if (this._isDestroyed) return;
            const recentClick = this.actor._lastIconClickTime && (Date.now() - this.actor._lastIconClickTime < 1000);
            if (!this.actor._launchingApp && !recentClick) this.queueRender();
        });

        this.registry.connectSignal(global.display, 'window-entered-monitor', () => {
            if (!this._isDestroyed && this.settings.get_boolean('isolate-monitors')) this.queueRender();
        });

        this.registry.connectSignal(global.display, 'window-left-monitor', () => {
            if (!this._isDestroyed && this.settings.get_boolean('isolate-monitors')) this.queueRender();
        });

        this.registry.connectSignal(global.workspace_manager, 'active-workspace-changed', () => {
            if (this._isDestroyed) return;
            if (this.settings.get_boolean('isolate-workspaces')) {
                this.actor._lastIconClickTime = 0;
                this.queueRender();
            }
        });

        WATCHED_SETTINGS.forEach(key => {
            this.registry.connectSignal(this.settings, `changed::${key}`, () => {
                this.autoHideManager?._forceShow();
                this.queueRender();
                this._updateLayout();
            });
        });

        STYLE_SETTINGS.forEach(key => {
            this.registry.connectSignal(this.settings, `changed::${key}`, () => {
                this.autoHideManager?._forceShow();
                this._applyDynamicStyles();
                this._updateLayout();
            });
        });

        ['full-width', 'icon-alignment', 'grid-button-position'].forEach(key => {
            this.registry.connectSignal(this.settings, `changed::${key}`, () => {
                this.autoHideManager?._forceShow();
                this.boxActor.set_vertical(this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
                this._renderDock();
                if (key === 'full-width') this._updateStruts();
            });
        });

        this.registry.connectSignal(this.settings, 'changed::hide-mode', () => {
            this._updateStruts();
            this.queueRender();
        });

        this.registry.connectSignal(this.settings, 'changed::dock-position', () => {
            this.autoHideManager?._forceShow();
            const newPos = this.settings.get_string('dock-position');
            const isNewVertical = newPos === 'LEFT' || newPos === 'RIGHT';

            this.dockPosition = newPos;
            this.boxActor.set_vertical(isNewVertical);
            this.queueRender();

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed) {
                    this._updateLayout();
                    if (this.dockManager) this.dockManager.updatePosition();
                }
                return GLib.SOURCE_REMOVE;
            });
        });

        this.registry.connectSignal(this.settings, 'changed::dock-margin', () => {
            if (!this._isDestroyed && this.dockManager) this.dockManager.updatePosition();
        });

        this.registry.connectSignal(this.settings, 'changed::preferred-monitor', () => {
            if (this._isDestroyed) return;
            this.dockManager.updatePosition();
            this.queueRender();
        });

        this.volumeMonitor = Gio.VolumeMonitor.get();
        this.registry.connectSignal(this.volumeMonitor, 'mount-added', () => this.queueRender());
        this.registry.connectSignal(this.volumeMonitor, 'mount-removed', () => this.queueRender());

        this._setupChameleonWatcher();
        this._setupTrashMonitor();
    }

    _setupTrashMonitor() {
        try {
            const trashDir = Gio.File.new_for_uri('trash:///');
            this._trashMonitor = trashDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this.registry.connectSignal(this._trashMonitor, 'changed', () => {
                if (this._isDestroyed || this._trashRefreshId) return;
                this._trashRefreshId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                    this._trashRefreshId = null;
                    if (!this._isDestroyed) this.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (_e) { }
    }

    _setupChameleonWatcher() {
        try {
            this._bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
            const onWallpaperChange = () => {
                if (this._isDestroyed) return;
                this._chameleonColor = null;
                this._chameleonAccent = null;
                if (this.settings.get_string('dock-theme') === 'chameleon') {
                    this._applyDynamicStyles();
                    this.queueRender();
                }
            };
            this.registry.connectSignal(this._bgSettings, 'changed::picture-uri', onWallpaperChange);
            this.registry.connectSignal(this._bgSettings, 'changed::picture-uri-dark', onWallpaperChange);
        } catch (_e) { }
    }

    _updateStruts() {
        if (this._isDestroyed || !this.actor) return;
        const hideMode = this.settings.get_string('hide-mode');
        const isNeverHide = (hideMode === 'never' || hideMode === 'none');

        if (this.actor._affectsStruts !== isNeverHide) {
            this.actor._affectsStruts = isNeverHide;
            try { Main.layoutManager.removeChrome(this.actor); } catch (_e) { }
            Main.layoutManager.addChrome(this.actor, {
                affectsStruts: isNeverHide,
                trackFullscreen: true
            });
        }
    }

    isPreviewTooltipVisible() {
        const tooltip = this.actor?._magTooltip;
        return !!(tooltip && tooltip.visible && tooltip.opacity > 0);
    }

    shouldIgnoreAutoHide() {
        if (this.isPreviewTooltipVisible()) return true;
        return !!(this._activeFolderMenu || this._pauseAutoHide);
    }

    _applyIndicatorBaselineAlignment() {
        const isVerticalDock = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';
        const resetOffset = (actor) => {
            if (!actor || !actor._dhruvaIndicatorOffsetApplied) return;
            if (isVerticalDock) actor.translation_x = 0;
            else actor.translation_y = 0;
            actor._dhruvaIndicatorOffsetApplied = false;
        };

        const dockChildren = this.boxActor ? this.boxActor.get_children() : [];
        dockChildren.forEach(resetOffset);
        if (this.gridBtn) resetOffset(this.gridBtn);
    }

    show() {
        this._updateStruts();

        const mappedId = this.actor.connect('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            this.actor.disconnect(mappedId);
            if (!this._isDestroyed) {
                this._renderDock();
                if (this.dockManager) this.dockManager.updatePosition();
            }
        });

        this.registry.connectSignal(global.display, 'workareas-changed', () => {
            if (this._isDestroyed) return;
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager._updateEdgeTrigger();
        });

        setupWindowEffects(this.settings);
        this.autoHideManager = new AutoHideManager(this, this.settings);

        if (this.settings.get_boolean('independent-dock')) {
            if (Main.overview.dash) Main.overview.dash.show();
        } else {
            if (Main.overview.dash) Main.overview.dash.hide();
        }

        this.registry.connectSignal(Main.overview, 'showing', () => {
            const isIndependent = this.settings.get_boolean('independent-dock');
            const showInOverview = this.settings.get_boolean('show-independent-in-overview');

            if (isIndependent) {
                if (showInOverview) {
                    const currentPos = this.settings.get_string('dock-position');
                    
                    if (currentPos !== 'LEFT') {
                        try {
                            const tmpPath = GLib.get_tmp_dir() + '/dhruva_dock_pos.txt';
                            const file = Gio.File.new_for_path(tmpPath);
                            const outStream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
                            const dataStream = new Gio.DataOutputStream({ base_stream: outStream });
                            dataStream.put_string(currentPos, null);
                            dataStream.close(null);
                        } catch (e) {}
                        
                        this.settings.set_string('dock-position', 'LEFT');
                    }
                    
                    if (this.isActorAlive(this.actor)) {
                        this.actor.show();
                        this.actor.opacity = 255;
                    }
                } else {
                    if (this.isActorAlive(this.actor)) {
                        this.actor.hide();
                        this.actor.opacity = 0;
                    }
                }
                if (Main.overview.dash) Main.overview.dash.show();
            } else {
                if (this.isActorAlive(this.actor)) {
                    this.actor.show();
                    this.actor.opacity = 255;
                }
                if (this.autoHideManager) this.autoHideManager._show(true);
            }

            if (!this._isDestroyed && (!isIndependent || showInOverview)) {
                this._updateLayout();
            }
        });

        this.registry.connectSignal(Main.overview, 'hiding', () => {
            const isIndependent = this.settings.get_boolean('independent-dock');
            const showInOverview = this.settings.get_boolean('show-independent-in-overview');

            if (isIndependent && showInOverview) {
                try {
                    const tmpPath = GLib.get_tmp_dir() + '/dhruva_dock_pos.txt';
                    const file = Gio.File.new_for_path(tmpPath);
                    if (file.query_exists(null)) {
                        const inStream = file.read(null);
                        const dataInStream = new Gio.DataInputStream({ base_stream: inStream });
                        const [posLine] = dataInStream.read_line_utf8(null);
                        dataInStream.close(null);
                        
                        if (posLine) {
                            this.settings.set_string('dock-position', posLine.trim());
                        }
                        file.delete(null);
                    }
                } catch (e) {}
            }

            if (isIndependent) {
                if (this.isActorAlive(this.actor)) this.actor.show();
                if (this.autoHideManager) {
                    this.autoHideManager.isHidden = true;
                    this.autoHideManager._show(true);
                }
            } else {
                if (this.autoHideManager) this.autoHideManager._scheduleUpdate(0);
            }
        });

        this.registry.connectSignal(Main.overview, 'hidden', () => {
            clearOverviewDockMargin(this);
        });

        if (Main.overview.visible) {
            this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed) {
                    this._updateLayout();
                    if (!this.settings.get_boolean('independent-dock') && !Main.overview.animationInProgress) {
                        applyOverviewDockMargin(this);
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _scheduleCursorResetBurst() {
        if (typeof resetCursorToDefault === 'function') resetCursorToDefault();

        this._cursorResetTimeouts.forEach(id => GLib.source_remove(id));
        this._cursorResetTimeouts = [];

        [50, 150, 300, 600, 1000, 1500, 2000].forEach(delayMs => {
            const timeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._cursorResetTimeouts = this._cursorResetTimeouts.filter(id => id !== timeoutId);

                if (!this._isDestroyed) {
                    const tracker = Shell.WindowTracker.get_default();

                    if (typeof tracker.get_startup_sequences === 'function') {
                        const sequences = tracker.get_startup_sequences();
                        if (sequences && sequences.length > 0) {
                            for (let i = 0; i < sequences.length; i++) {
                                if (typeof sequences[i].complete === 'function') {
                                    sequences[i].complete();
                                }
                            }
                        }
                    }

                    if (typeof resetCursorToDefault === 'function') resetCursorToDefault();
                }
                return GLib.SOURCE_REMOVE;
            });
            this._cursorResetTimeouts.push(timeoutId);
        });
    }

    triggerPostDragSettle() {
        if (this._isDestroyed) return;
        if (this._postDragSettleId) GLib.source_remove(this._postDragSettleId);

        this._postDragSettleId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
            this._postDragSettleId = null;
            if (!this._isDestroyed) {
                this._pendingRender = false;
                this._renderDock();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._isDestroyed = true;
        DockUI._instances.delete(this);

        this.queueRender?.cancel?.();

        this._cursorResetTimeouts?.forEach(id => GLib.source_remove(id));
        this.registry?.destroy();

        this.autoHideManager?.destroy();
        this.dockManager?.destroy();
        this.appGridUI?.destroy();
        this.notificationManager?.destroy();

        cleanupTrashEffects();
        try { teardownWindowEffects(); } catch (_e) { }
        try { teardownMagnification(this.actor); } catch (_e) { }

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
        }

        clearOverviewDockMargin(this);
    }
}