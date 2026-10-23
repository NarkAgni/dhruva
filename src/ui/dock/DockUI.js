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
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import AppGridUI from '../AppGridUI.js';
import { BlurPanel } from '../blur/BlurPanel.js';
import DockManager from '../../core/DockManager.js';
import { updateLayout } from './DockLayoutEngine.js';
import ScrollManager from '../../core/ScrollManager.js';
import { Settings } from '../../core/SettingsManager.js';
import { destroyExternalDrop } from '../ExternalDrop.js';
import MonitorManager from '../../core/MonitorManager.js';
import PanelIntegrator from '../../core/PanelIntegrator.js';
import { applyDynamicStyles, refreshChameleonColor, cancelChameleonColor } from './DockThemeResolver.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { refreshTrashState } from '../modules/TrashModule.js';
import { cleanupTrashEffects } from '../effects/TrashEffect.js';
import NotificationManager from '../../core/NotificationManager.js';
import { cancelIconPicker } from '../folder-menu/FolderIconFiles.js';
import AutoHideManager from '../../core/autohide/AutoHideManager.js';
import { teardownMagnification } from '../magnifier/MagnifierReset.js';
import { requestAttention, cancelDockTransitions } from './DockTransitions.js';
import { applyOverviewDockMargin, clearOverviewDockMargin } from './OverviewMargin.js';
import { setupWindowEffects, teardownWindowEffects, animateLaunch } from '../effects/WindowEffects.js';
import { debounce, setBoxVertical, isActorAlive, captureActorRect, clearIconColorCache } from '../../core/Utils.js';
import { renderDock, getIndicatorProps, syncOverflowWithPanel, syncRunningStates, cleanupDockRenderer } from './DockRenderer.js';


const RENDER_DEBOUNCE_MS = 5;
const PANEL_OVERFLOW_DEBOUNCE_MS = 40;
const LAUNCH_EXPIRY_MS = 8000;
const CURSOR_BURST_DELAYS = [50, 150, 300, 600, 1000, 1500, 2000];
const OVERVIEW_FADE_OUT_MS = 120;
const OVERVIEW_FADE_IN_MS = 180;
const STRUT_SETTLE_MS = 60;

const BLUR_SETTING_KEYS = [
    'blur-enabled',
    'blur-mode',
    'blur-static-source',
    'blur-static-preset',
    'blur-custom-photo',
    'blur-intensity',
    'blur-vibrancy',
    'blur-brightness',
    'blur-border-glow',
    'blur-highlight-angle',
    'blur-tint-color',
    'blur-tint-opacity'
];

const WATCHED_SETTINGS = [
    'icon-size', 'show-running-indicators', 'hover-zoom', 'hover-zoom-factor',
    'lock-icons', 'show-apps-preview', 'click-effect', 'show-clock', 'use-24h-clock',
    'clock-position', 'clock-font-size', 'show-desktop-button', 'show-home', 'show-downloads',
    'show-documents', 'show-pictures', 'show-videos', 'show-music', 'context-menu-size',
    'big-preview-size', 'minimize-effect', 'stroke-width', 'indicator-style', 'indicator-color',
    'indicator-size', 'indicator-glow', 'custom-folders', 'isolate-workspaces',
    'isolate-monitors', 'show-notification-badges', 'show-mounts', 'show-app-separator', 'separator-width',
    'show-module-separator', 'separator-height', 'dock-padding', 'dock-height', 'tooltip-opacity',
    'separator-color', 'separator-opacity', 'running-separator-width', 'running-separator-height',
    'running-separator-color', 'running-separator-opacity', 'show-panel-separator', 'panel-separator-width',
    'panel-separator-height', 'panel-separator-color', 'panel-separator-opacity', 'grid-icon-color', 'custom-grid-icon',
    'custom-grid-icon-scale', 'use-old-grid-icon', 'app-folders', 'show-unpinned-apps',
    'desktop-btn-width', 'desktop-btn-opacity', 'desktop-btn-color', 'show-independent-in-overview',
    'indicator-color-mode', 'autohide-animation-speed', 'window-effect-speed'
];

const STYLE_SETTINGS = [
    'background-color', 'background-opacity', 'context-menu-opacity', 'border-radius', 'stroke-color', 'stroke-opacity',
    'icon-spacing', 'dock-theme', 'use-gradient', 'background-gradient-color',
    'gradient-direction', 'dynamic-panel', 'dynamic-panel-length', 'dynamic-panel-position'
];

export default class DockUI {
    static _instances = null;

    constructor(settings, openPrefsCallback, appManager, folderManager, monitorIndex = null) {
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.dockPosition = Settings.dockPosition || 'BOTTOM';

        this.registry = new TimeoutTracker();
        this._launchUnpause = {};
        this._activeContextMenu = null;
        this._cursorResetTimeouts = [];
        this._originalPosForOverview = null;
        this._isWindowGrabbed = false;
        this._grabbedWindow = null;
        this._isGrabTouchingDock = false;

        this._actorRegistry = new Map();
        this._separatorRegistry = new Map();
        this._currentOrder = [];
        this._itemSpans = new Map();
        this._overflowMenu = null;
        this._overflowKeys = '';
        this._panelSyncLaterId = 0;
        this._pendingRenderState = {
            mode: 'incremental',
            force: false,
            reason: '',
            dirtyKeys: new Set()
        };
        this._isRendering = false;
        this._pendingRender = false;
        this._previousIconCount = undefined;


        this.appManager = appManager;
        this.folderManager = folderManager;

        this.monitorManager = new MonitorManager(this.settings, monitorIndex);
        this.dockManager = new DockManager(this);
        this.isPanelHost = monitorIndex === null || monitorIndex === Main.layoutManager.primaryIndex;
        this.panelIntegrator = new PanelIntegrator(this, this.isPanelHost);
        this.notificationManager = new NotificationManager(this);
        this.appGridUI = new AppGridUI(this);
        this._initActors();
        this._bindMethods();
        this._connectSignals();

        if (!DockUI._instances) DockUI._instances = new Set();
        DockUI._instances.add(this);
    }

    _bindMethods() {
        this._renderDock = (mode = 'incremental', force = false) => renderDock(this, mode, force);
        this._updateLayout = () => updateLayout(this);

        this.checkPanelOverflow = debounce(() => syncOverflowWithPanel(this), PANEL_OVERFLOW_DEBOUNCE_MS);
        this.syncPanelSpace = () => {
            if (this._panelSyncLaterId) return;
            this._panelSyncLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._panelSyncLaterId = 0;
                if (isActorAlive(this.actor)) {
                    this._updateLayout();
                    this.checkPanelOverflow();
                }
                return GLib.SOURCE_REMOVE;
            });
        };
        this._applyDynamicStyles = () => applyDynamicStyles(this);
        this._getIndicatorProps = () => getIndicatorProps(this);
        this._captureActorRect = (actor, fb) => captureActorRect(actor, fb);
        this.isActorAlive = isActorAlive;

        const executeScheduledRender = this._executeScheduledRender = debounce(() => {
            if (this._renderDock) {
                const state = this._pendingRenderState || { mode: 'incremental', force: false };
                const modeToRun = state.mode || 'incremental';
                const forceToRun = Boolean(state.force);

                this._pendingRenderState.mode = 'incremental';
                this._pendingRenderState.force = false;
                this._pendingRenderState.reason = '';
                this._pendingRenderState.dirtyKeys.clear();

                this._renderDock(modeToRun, forceToRun);
            }
        }, RENDER_DEBOUNCE_MS);

        this.queueRender = (mode = 'incremental', force = false, reason = '') => {
            if (!this._pendingRenderState) {
                this._pendingRenderState = { mode: 'incremental', force: false, reason: '', dirtyKeys: new Set() };
            }
            if (mode === 'full' || this._pendingRenderState.mode === 'full') {
                this._pendingRenderState.mode = 'full';
            } else {
                this._pendingRenderState.mode = mode;
            }
            if (force) {
                this._pendingRenderState.force = true;
            }
            if (reason) {
                this._pendingRenderState.reason = reason;
            }
            executeScheduledRender();
        };
    }

    _initActors() {
        this.actor = new Clutter.Actor({ name: 'DhruvaContainer', reactive: true });
        this.actor.clip_to_allocation = false;
        this.actor._dockUI = this;
        this.actor.remove_all_transitions();
        this.actor.opacity = 0;

        this.bgActor = new St.Widget({ name: 'DhruvaBackground', style_class: 'plank-like-dock-bg', reactive: true, clip_to_allocation: false });
        this.bgActor.remove_all_transitions();

        this.boxActor = new St.BoxLayout({ name: 'Dhruva', style_class: 'plank-like-dock', reactive: true, track_hover: true, clip_to_allocation: false });

        setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
        this.boxActor._delegate = null;

        this.actor.add_child(this.bgActor);
        this.actor.add_child(this.boxActor);
        this.actor.bgActor = this.bgActor;
        this.actor.boxActor = this.boxActor;

        if (this.panelIntegrator) {
            if (this.panelIntegrator.leftContainer) {
                this.actor.add_child(this.panelIntegrator.leftContainer);
            }
            if (this.panelIntegrator.container) {
                this.actor.add_child(this.panelIntegrator.container);
            }
        }

        const isDynamicPanel = Settings.hybridPanelMode && Boolean(this.settings && this.settings.get_boolean('dynamic-panel'));
        const isFullBar = Settings.fullWidth || (Settings.hybridPanelMode && !isDynamicPanel);
        const dockRadius = isFullBar ? 0 : Settings.borderRadius;
        this._dockBlur = new BlurPanel(this.bgActor, this.settings, dockRadius, this.actor);

        this._syncBlurGeometry = () => {
            if (this._dockBlur) {
                const dynNow = Settings.hybridPanelMode && Boolean(this.settings && this.settings.get_boolean('dynamic-panel'));
                const fullBarNow = Settings.fullWidth || (Settings.hybridPanelMode && !dynNow);
                this._dockBlur.setCornerRadius(fullBarNow ? 0 : Settings.borderRadius);
                this._dockBlur.syncGeometry();
            }
        };

        ScrollManager.setupDockScroll(this.actor);
    }

    _connectSignals() {
        this.appManager.attachDock(this);

        Main.sessionMode.connectObject('updated', () => {
            if (this._activeContextMenu) {
                this._activeContextMenu.hide();
                this._activeContextMenu = null;
            }
            if (this._activeFolderMenu) {
                this._activeFolderMenu.hide();
                this._activeFolderMenu = null;
            }
            if (this._activeTrayMenu) {
                this._activeTrayMenu.hide();
                this._activeTrayMenu = null;
            }
        }, this);

        const handleEmptySpaceClick = () => {
            let menuClosed = false;

            if (this._activeContextMenu) {
                this._activeContextMenu.hide();
                this._activeContextMenu = null;
                menuClosed = true;
            }
            if (this._activeFolderMenu) {
                this._activeFolderMenu.hide();
                this._activeFolderMenu = null;
                menuClosed = true;
            }

            return menuClosed ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        };

        this.actor.connectObject('button-press-event', handleEmptySpaceClick, this);
        this.actor.connectObject('button-release-event', handleEmptySpaceClick, this);
        this.bgActor.connectObject('button-press-event', handleEmptySpaceClick, this);
        this.boxActor.connectObject('button-press-event', handleEmptySpaceClick, this);

        this.boxActor.connectObject('notify::allocation', () => {
            if (this._allocIdleId) return;
            this._allocIdleId = this.registry.addIdle(GLib.PRIORITY_DEFAULT, () => {
                this._allocIdleId = null;
                if (this.actor && isActorAlive(this.actor) && this.actor.is_mapped()) {
                    this._updateLayout();
                    if (this._isOverviewActive && this.dockPosition === 'LEFT') {
                        this._applyOverviewLeftPosition();
                    } else if (Main.overview.visible || Main.overview.visibleTarget) {
                        applyOverviewDockMargin(this);
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        this.appManager.appSystem.connectObject('installed-changed', () => this.queueRender('incremental'), this);
        this.appManager.appSystem.connectObject('app-state-changed', () => this.queueRender('incremental'), this);

        global.window_manager.connectObject('destroy', () => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender('incremental', true);
            if (this._wmDestroyRenderId) {
                this.registry.remove(this._wmDestroyRenderId);
                this._wmDestroyRenderId = 0;
            }
            this._wmDestroyRenderId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                this._wmDestroyRenderId = 0;
                this.queueRender('incremental', true);
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        global.window_manager.connectObject(
            'switch-workspace', () => {
                if (this._dockBlur) this._dockBlur.queueCapture();
            },
            'minimize', () => {
                if (this._dockBlur) this._dockBlur.queueCapture();
            },
            'unminimize', () => {
                if (this._dockBlur) this._dockBlur.queueCapture();
            },
            'size-change', () => {
                if (this._dockBlur) this._dockBlur.queueCapture();
            },
            this
        );

        if (global.display) {
            global.display.connectObject(
                'restacked', () => {
                    if (this._dockBlur) this._dockBlur.queueCapture();
                },
                'grab-op-begin', (_display, window, grabOp) => {
                    if (this._dockBlur) this._dockBlur.beginDragTracking(window);
                    this._onWindowGrabBegin(window, grabOp);
                },
                'grab-op-end', () => {
                    if (this._dockBlur) this._dockBlur.endDragTracking();
                    this._onWindowGrabEnd();
                },
                this
            );
        }

        global.window_manager.connectObject('map', (_wm, actor) => {
            if (this.actor) {
                this.actor._lastIconClickTime = 0;
                this.actor._fixedSlots = null;
                this.actor._tooltipHoveredIndex = -1;
                this.actor._magTooltipAppId = null;
            }
            this.queueRender('incremental', true);
            if (this._wmMapRenderId) {
                this.registry.remove(this._wmMapRenderId);
                this._wmMapRenderId = 0;
            }
            this._wmMapRenderId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                this._wmMapRenderId = 0;
                this.queueRender('incremental', true);
                return GLib.SOURCE_REMOVE;
            });

            if (Settings.isolateMonitors) {
                if (this._isolateMonitorRenderDelayId) {
                    this.registry.remove(this._isolateMonitorRenderDelayId);
                }
                this._isolateMonitorRenderDelayId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._isolateMonitorRenderDelayId = null;
                    this.queueRender('incremental');
                    return GLib.SOURCE_REMOVE;
                });
            }

            if (!this._pendingLaunches || this._pendingLaunches.length === 0) return;
            const nowMs = Date.now();
            this._pendingLaunches = this._pendingLaunches.filter(p => p && (nowMs - (p.createdAt || nowMs)) < LAUNCH_EXPIRY_MS);
            if (this._pendingLaunches.length === 0) return;

            const win = actor.meta_window;
            if (!win || win.get_window_type() !== Meta.WindowType.NORMAL) return;

            const tracker = Shell.WindowTracker.get_default();
            const winApp = tracker.get_window_app(win);
            const winClass = win.get_wm_class() ? win.get_wm_class().toLowerCase() : '';

            let matchedIndex = -1;
            for (let i = 0; i < this._pendingLaunches.length; i++) {
                const p = this._pendingLaunches[i];
                let isMatch = false;
                if (p.appId && winApp && winApp.get_id() === p.appId) {
                    isMatch = true;
                } else if (p.appId && winClass) {
                    const appBase = p.appId.toLowerCase().replace('.desktop', '');
                    if (appBase.includes(winClass) || winClass.includes(appBase)) {
                        isMatch = true;
                    }
                } else if (p.isFolder && (winClass.includes('nautilus') || winClass.includes('files'))) {
                    isMatch = true;
                }

                if (isMatch && !p.consumed) {
                    matchedIndex = i;
                    p.consumed = true;
                    break;
                }
            }

            if (matchedIndex !== -1) {
                const pending = this._pendingLaunches[matchedIndex];
                if (Settings.isolateMonitors) {
                    const targetMonitor = this.monitorManager.getCurrentMonitor().index;
                    if (win.get_monitor() !== targetMonitor) win.move_to_monitor(targetMonitor);
                }

                const iconRect = pending.iconRect || this._captureActorRect(pending.btn, win);
                animateLaunch(win, pending.btn, this.dockPosition, iconRect);
            }
        }, this);

        global.display.connectObject('notify::focus-window', () => {
            if (this._isWindowGrabbed) return;
            this._updateRunningStatesFast();

            if (Settings.hybridPanelMode && this._overflowKeys && (!this._overflowMenu || !this._overflowMenu._isOpen)) {
                const focusWin = global.display.get_focus_window();
                if (focusWin) this.queueRender('incremental', true);
            }
        }, this);

        global.display.connectObject('window-entered-monitor', () => {
            if (this._isWindowGrabbed) return;
            if (Settings.isolateMonitors) this.queueRender('incremental');
        }, this);

        global.display.connectObject('window-left-monitor', () => {
            if (this._isWindowGrabbed) return;
            if (Settings.isolateMonitors) this.queueRender('incremental');
        }, this);

        global.workspace_manager.connectObject('active-workspace-changed', () => {
            if (Settings.isolateWorkspaces) {
                this.actor._lastIconClickTime = 0;
                this.queueRender('incremental');
            }
        }, this);

        WATCHED_SETTINGS.forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                this.queueRender('full', true);
                this._updateLayout();
            }, this);
        });

        STYLE_SETTINGS.forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                this._applyDynamicStyles();
                this._updateLayout();
                if (this.dockManager) this.dockManager.updatePosition();
                this.checkPanelOverflow();

                if (this._activeContextMenu && this._activeContextMenu.bgDrawingArea) {
                    this._activeContextMenu.bgDrawingArea.queue_repaint();
                }
                if (this._activeFolderMenu && this._activeFolderMenu.bgDrawingArea) {
                    this._activeFolderMenu.bgDrawingArea.queue_repaint();
                }
                if (this._activeTrayMenu && this._activeTrayMenu.bgDrawingArea) {
                    this._activeTrayMenu.bgDrawingArea.queue_repaint();
                }
                if (this._overflowMenu && this._overflowMenu._bubble) {
                    this._overflowMenu._bubble.queue_repaint();
                }
            }, this);
        });

        BLUR_SETTING_KEYS.forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                if (this._dockBlur) {
                    this._dockBlur.syncSettings();
                    this._dockBlur.syncGeometry();
                }
                this._applyDynamicStyles();
                this._updateLayout();
            }, this);
        });

        this.settings.connectObject(
            'changed::grid-button-position', () => {
                this.queueRender('full', true);
            },
            'changed::show-grid-button', () => {
                this.queueRender('full', true);
            },
            this
        );

        ['show-music-pill', 'music-pill-position'].forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                if (this._musicPill) {
                    this._musicPill.destroy();
                    this._musicPill = null;
                }

                this.queueRender('full', true);
                if (this._musicPillIdleId) {
                    this.registry.remove(this._musicPillIdleId);
                    this._musicPillIdleId = 0;
                }
                this._musicPillIdleId = this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._musicPillIdleId = 0;
                    this._updateLayout();
                    if (this.dockManager) this.dockManager.updatePosition();
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        });

        this.settings.connectObject('changed::hide-mode', () => {
            this._updateStruts();
        }, this);

        this.settings.connectObject('changed::dock-margin', () => {
            this._updateLayout();
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            this._updateStruts();
        }, this);

        this.settings.connectObject('changed::preferred-monitor', () => {
            this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            this._updateStruts();
            this.queueRender('full', true);
        }, this);

        this.volumeMonitor = Gio.VolumeMonitor.get();
        this.volumeMonitor.connectObject('mount-added', () => this.queueRender('incremental'), this);
        this.volumeMonitor.connectObject('mount-removed', () => this.queueRender('incremental'), this);

        this._setupChameleonWatcher();
        this._syncTrashMonitor();
        this.settings.connectObject('changed::show-trash', () => {
            this._trashIsFull = undefined;
            this._syncTrashMonitor();
            this.queueRender('incremental', true);
        }, this);

        this._iconThemeSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        this._iconThemeSettings.connectObject('changed::icon-theme', () => {
            if (clearIconColorCache) clearIconColorCache();
            this.queueRender('full', true);
        }, this);

        if (this._preloadAppsTimeoutId) {
            this.registry.remove(this._preloadAppsTimeoutId);
            this._preloadAppsTimeoutId = 0;
        }
        this._preloadAppsTimeoutId = this.registry.addTimeout(GLib.PRIORITY_LOW, 2500, () => {
            this._preloadAppsTimeoutId = 0;
            const controls = Main.overview._overview && Main.overview._overview._controls;
            if (controls && controls._appDisplay && controls._appDisplay._ensureIcon) {
                controls._appDisplay.create_all_apps();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateRunningStatesFast() {
        if (!isActorAlive(this.boxActor)) return;
        syncRunningStates(this);

        for (const entry of this._actorRegistry.values()) {
            const btn = entry.actor;
            if (!isActorAlive(btn)) continue;

            const sx = Math.max(0.01, btn.scale_x || 1.0);
            const sy = Math.max(0.01, btn.scale_y || 1.0);
            if (Math.abs(sx - 1.0) > 0.001 || Math.abs(sy - 1.0) > 0.001) {
                const antiSx = 1.0 / sx;
                const antiSy = 1.0 / sy;
                const appBox = btn.get_child ? btn.get_child() : null;
                if (appBox && appBox.get_children) {
                    appBox.get_children().forEach(c => {
                        if (c._isIndicator) {
                            const baseSx = c._baseScaleX !== undefined ? c._baseScaleX : 1.0;
                            const baseSy = c._baseScaleY !== undefined ? c._baseScaleY : 1.0;
                            c.scale_x = baseSx * antiSx;
                            c.scale_y = baseSy * antiSy;
                            c.translation_x = (c._baseTx || 0) * antiSx;
                            c.translation_y = (c._baseTy || 0) * antiSy;
                        }
                    });
                }
            }
        }
    }

    _teardownTrashMonitor() {
        if (this._trashInitId) {
            this.registry.remove(this._trashInitId);
            this._trashInitId = 0;
        }
        if (this._trashRefreshId) {
            this.registry.remove(this._trashRefreshId);
            this._trashRefreshId = 0;
        }
        if (this._trashMonitor) {
            this._trashMonitor.disconnectObject(this);
            this._trashMonitor.cancel();
            this._trashMonitor = null;
        }
    }

    _syncTrashMonitor(delayMs = 150, retriesLeft = 4) {
        this._teardownTrashMonitor();

        if (!Settings.showTrash) return;

        this._trashInitId = this.registry.addTimeout(GLib.PRIORITY_LOW, delayMs, () => {
            this._trashInitId = 0;
            if (!Settings.showTrash || !isActorAlive(this.actor)) return GLib.SOURCE_REMOVE;

            try {
                const trashDir = Gio.File.new_for_uri('trash:///');
                this._trashMonitor = trashDir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOUNTS, null);
                this._trashMonitor.connectObject('changed', (_mon, _file, _other, eventType) => {
                    if (eventType === Gio.FileMonitorEvent.PRE_UNMOUNT ||
                        eventType === Gio.FileMonitorEvent.UNMOUNTED) {
                        this._syncTrashMonitor(1000, 4);
                        return;
                    }

                    if (this._trashRefreshId) return;
                    this._trashRefreshId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                        this._trashRefreshId = null;
                        requestAttention(this, actor => actor._isTrash);
                        refreshTrashState(this);
                        return GLib.SOURCE_REMOVE;
                    });
                }, this);
            } catch (_e) {
                this._trashMonitor = null;
                if (retriesLeft > 0 && this.registry) {
                    this._syncTrashMonitor(delayMs * 2, retriesLeft - 1);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupChameleonWatcher() {
        this._bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        const onWallpaperChange = () => {
            if (Settings.dockTheme === 'chameleon') refreshChameleonColor(this);
            if (this._dockBlur) {
                this._dockBlur._hasContent = false;
                this._dockBlur.queueCapture();
            }
        };
        this._bgSettings.connectObject('changed::picture-uri', onWallpaperChange, this);
        this._bgSettings.connectObject('changed::picture-uri-dark', onWallpaperChange, this);

        this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        this._interfaceSettings.connectObject('changed::color-scheme', onWallpaperChange, this);
    }

    _syncDashVisibility() {
        if (Main.overview && Main.overview.dash) {
            if (this._hidesGnomeDash()) {
                Main.overview.dash.opacity = 0;
                Main.overview.dash.reactive = false;
            } else {
                Main.overview.dash.show();
                Main.overview.dash.opacity = 255;
                Main.overview.dash.reactive = true;
            }
        }
    }

    _hidesGnomeDash() {
        return !Settings.independentDock || Settings.hybridPanelMode;
    }

    _holdStruts() {
        if (this._strutRestoreId) {
            this.registry.remove(this._strutRestoreId);
            this._strutRestoreId = null;
        }
        if (!this.actor._affectsStruts || this._strutHolder) return;
        const [x, y] = this.actor.get_transformed_position();
        const [width, height] = this.actor.get_transformed_size();
        this._strutHolder = new Clutter.Actor({ reactive: false, x, y, width, height });
        Main.layoutManager.addChrome(this._strutHolder, { affectsStruts: true });
    }

    _releaseStrutHolder() {
        if (this._strutHolder) {
            Main.layoutManager.removeChrome(this._strutHolder);
            this._strutHolder.destroy();
            this._strutHolder = null;
        }
    }

    _enterOverviewPosition() {
        this._isOverviewActive = true;
        this._updateStruts();
        this.dockPosition = 'LEFT';
        setBoxVertical(this.boxActor, true);

        this.actor.remove_all_transitions();
        this.actor.opacity = 0;
        this.actor.show();

        this._renderDock('full', true);
        this._updateLayout();
        this._applyOverviewLeftPosition();

        this.actor.ease({
            opacity: 255,
            duration: OVERVIEW_FADE_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _fadeOutForOverview() {
        this.actor.remove_all_transitions();
        this.actor.ease({
            opacity: 0,
            duration: OVERVIEW_FADE_OUT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _leaveOverviewPosition() {
        const wasMoved = Boolean(this._originalPosForOverview);
        if (wasMoved) {
            this.dockPosition = this._originalPosForOverview;
            this._originalPosForOverview = null;
            this._isOverviewActive = false;
            setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
            this._renderDock('full', true);
        }
        this._updateLayout();
        if (this.dockManager) this.dockManager.updatePosition();
        if (wasMoved && this.autoHideManager) this.autoHideManager.forceHideImmediately();
    }

    _queueStrutRestore() {
        if (!this._strutHolder || this._strutRestoreId) return;
        this._strutRestoreId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, Settings.autohideAnimationSpeed + STRUT_SETTLE_MS, () => {
            this._strutRestoreId = null;
            this._updateStruts();
            this._releaseStrutHolder();
            return GLib.SOURCE_REMOVE;
        });
    }

    _showsInOverview() {
        return Settings.independentDock && Settings.showIndependentInOverview && !Settings.hybridPanelMode;
    }

    _applyOverviewLeftPosition() {
        if (!isActorAlive(this.actor)) return;
        const monResult = this.monitorManager.getCurrentMonitor();
        if (!monResult || !monResult.monitor) return;
        const mon = monResult.monitor;

        const dockH = this.actor.height || 400;

        const targetX = mon.x + Settings.dockMargin;
        const targetY = mon.y + Math.max(0, Math.floor((mon.height - dockH) / 2));

        this.actor.translation_x = 0;
        this.actor.translation_y = 0;
        this.actor.set_position(targetX, targetY);

        if (this.actor.get_parent()) {
            this.actor.get_parent().set_child_above_sibling(this.actor, null);
        }
    }

    _isOnSharedMonitorEdge() {
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length <= 1) return false;

        const monResult = this.monitorManager.getCurrentMonitor();
        if (!monResult || !monResult.monitor) return false;
        const mon = monResult.monitor;
        const pos = this.dockPosition;
        const TOLERANCE = 12;

        for (let i = 0; i < monitors.length; i++) {
            const other = monitors[i];
            if (other === mon) continue;

            if (pos === 'LEFT' || pos === 'RIGHT') {
                const vOverlap = Math.min(mon.y + mon.height, other.y + other.height) - Math.max(mon.y, other.y);
                if (vOverlap <= 0) continue;
                if (pos === 'LEFT' && Math.abs((other.x + other.width) - mon.x) <= TOLERANCE) return true;
                if (pos === 'RIGHT' && Math.abs(other.x - (mon.x + mon.width)) <= TOLERANCE) return true;
            } else if (pos === 'TOP' || pos === 'BOTTOM') {
                const hOverlap = Math.min(mon.x + mon.width, other.x + other.width) - Math.max(mon.x, other.x);
                if (hOverlap <= 0) continue;
                if (pos === 'TOP' && Math.abs((other.y + other.height) - mon.y) <= TOLERANCE) return true;
                if (pos === 'BOTTOM' && Math.abs(other.y - (mon.y + mon.height)) <= TOLERANCE) return true;
            }
        }
        return false;
    }

    _checkGrabbedWindowNearDock() {
        if (!this._isWindowGrabbed || !this._grabbedWindow || !isActorAlive(this.actor)) return false;

        const monResult = this._lockedGrabMonitor || this.monitorManager.getCurrentMonitor();
        const mon = monResult ? monResult.monitor : null;

        const dockX = this.actor.x;
        const dockY = this.actor.y;
        const dockW = (this.actor._cachedW || this.actor.width || 64) * (this.actor.scale_x || 1.0);
        const dockH = (this.actor._cachedH || this.actor.height || 64) * (this.actor.scale_y || 1.0);

        const CURSOR_TOLERANCE = 10;
        let dockLeft = dockX - CURSOR_TOLERANCE;
        let dockRight = dockX + dockW + CURSOR_TOLERANCE;
        const dockTop = dockY - CURSOR_TOLERANCE;
        const dockBottom = dockY + dockH + CURSOR_TOLERANCE;

        if (mon) {
            if (this.dockPosition === 'RIGHT') {
                dockRight = Math.max(dockRight, mon.x + mon.width + CURSOR_TOLERANCE);
                dockLeft = Math.min(dockLeft, (mon.x + mon.width) - dockW - CURSOR_TOLERANCE);
            } else if (this.dockPosition === 'LEFT') {
                dockLeft = Math.min(dockLeft, mon.x - CURSOR_TOLERANCE);
                dockRight = Math.max(dockRight, mon.x + dockW + CURSOR_TOLERANCE);
            }
        }

        const [px, py] = global.get_pointer();

        const isTouchingNow = (
            px >= dockLeft && px <= dockRight &&
            py >= dockTop && py <= dockBottom
        );

        if (isTouchingNow !== this._isGrabTouchingDock) {
            this._isGrabTouchingDock = isTouchingNow;

            if (isTouchingNow) {
                if (isActorAlive(this.actor)) this.actor.reactive = false;
                if (isActorAlive(this.bgActor)) this.bgActor.reactive = false;
                if (isActorAlive(this.boxActor)) this.boxActor.reactive = false;

                if (this.autoHideManager) {
                    this.autoHideManager.forceHideImmediately();
                    this.autoHideManager.setWindowGrabPassThrough(true);
                }
            } else {
                if (isActorAlive(this.actor)) this.actor.reactive = true;
                if (isActorAlive(this.bgActor)) this.bgActor.reactive = true;
                if (isActorAlive(this.boxActor)) this.boxActor.reactive = true;

                if (this.autoHideManager) {
                    this.autoHideManager.setWindowGrabPassThrough(false);
                    this.autoHideManager.scheduleCheck(20);
                }
            }
        }
        return true;
    }

    _onWindowGrabBegin(window, _grabOp) {
        if (!window) return;
        const winType = window.get_window_type ? window.get_window_type() : Meta.WindowType.NORMAL;
        if (winType !== Meta.WindowType.NORMAL && winType !== Meta.WindowType.DIALOG && winType !== Meta.WindowType.MODAL_DIALOG) {
            return;
        }

        const isMultiMonitor = Main.layoutManager.monitors && Main.layoutManager.monitors.length > 1;
        const isSideDock = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';

        if (!isMultiMonitor || !isSideDock) return;

        this._lockedGrabMonitor = this.monitorManager.getCurrentMonitor();

        this._isWindowGrabbed = true;
        this._grabbedWindow = window;
        this._isGrabTouchingDock = false;

        this._updateStruts();

        window.connectObject(
            'position-changed', () => this._checkGrabbedWindowNearDock(),
            this
        );

        if (this._grabWatchTimerId) {
            this.registry.remove(this._grabWatchTimerId);
            this._grabWatchTimerId = 0;
        }
        this._grabWatchTimerId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 25, () => {
            if (!this._isWindowGrabbed || !this._grabbedWindow) {
                this._grabWatchTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._checkGrabbedWindowNearDock();
            return GLib.SOURCE_CONTINUE;
        });

        this._checkGrabbedWindowNearDock();
    }

    _onWindowGrabEnd() {
        if (this._grabWatchTimerId) {
            this.registry.remove(this._grabWatchTimerId);
            this._grabWatchTimerId = 0;
        }

        if (!this._isWindowGrabbed) return;

        if (this._grabbedWindow) {
            this._grabbedWindow.disconnectObject(this);
            this._grabbedWindow = null;
        }

        this._isWindowGrabbed = false;
        this._lockedGrabMonitor = null;
        const wasTouching = this._isGrabTouchingDock;
        this._isGrabTouchingDock = false;

        if (isActorAlive(this.actor)) this.actor.reactive = true;
        if (isActorAlive(this.bgActor)) this.bgActor.reactive = true;
        if (isActorAlive(this.boxActor)) this.bgActor.reactive = true;

        this._updateStruts();

        if (wasTouching && this.autoHideManager) {
            this.autoHideManager.setWindowGrabPassThrough(false);
        } else if (this.autoHideManager) {
            this.autoHideManager.scheduleCheck(20);
        }

        if (Settings.isolateMonitors) {
            this.queueRender('incremental');
        }
    }

    _updateStruts() {
        if (!this.actor || !isActorAlive(this.actor)) return;

        const isSharedEdge = (this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT') && this._isOnSharedMonitorEdge();
        const shouldAffectStruts = (Settings.hideMode === 'none') &&
            !this._isOverviewActive &&
            !this._isWindowGrabbed &&
            !isSharedEdge;

        if (shouldAffectStruts && !this._isWindowGrabbed) {
            this.actor.translation_x = 0;
            this.actor.translation_y = 0;
        }

        if (this.actor._affectsStruts === shouldAffectStruts) return;
        this.actor._affectsStruts = shouldAffectStruts;

        Main.layoutManager._untrackActor(this.actor);
        Main.layoutManager._trackActor(this.actor, {
            affectsStruts: shouldAffectStruts,
            trackFullscreen: true,
        });

        if (this.dockManager && !this._isOverviewActive && !this._isWindowGrabbed) {
            this.dockManager.updatePosition();
        }

        const activeWorkspace = global.display.get_workspace_manager().get_active_workspace();
        if (activeWorkspace && activeWorkspace.check_unfocused_window_drag) {
            activeWorkspace.check_unfocused_window_drag();
        }
    }

    isPreviewTooltipVisible() {
        const tooltip = this.actor && this.actor._magTooltip;
        return Boolean(tooltip && tooltip.visible && tooltip.opacity > 0);
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
        const isSharedEdge = (this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT') && this._isOnSharedMonitorEdge();
        const shouldAffectStruts = (Settings.hideMode === 'none') && !isSharedEdge;
        this.actor._affectsStruts = shouldAffectStruts;
        this.actor.opacity = 0;

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: shouldAffectStruts,
            trackFullscreen: true
        });

        if (Settings.hybridPanelMode && this.panelIntegrator) {
            this.panelIntegrator.integrate();
        }

        this._renderDock('full', true);
        if (this.dockManager) {
            this.dockManager.updatePosition();
        }
        this._updateLayout();

        if (this._showInitIdleId) {
            this.registry.remove(this._showInitIdleId);
            this._showInitIdleId = 0;
        }
        this._showInitIdleId = this.registry.addIdle(GLib.PRIORITY_LOW, () => {
            this._showInitIdleId = 0;
            if (isActorAlive(this.actor)) {
                if (this.dockManager) this.dockManager.updatePosition();
                this._updateLayout();
                this.actor.remove_all_transitions();
                this.actor.opacity = 255;
                if (this._dockBlur) {
                    this._dockBlur.syncGeometry();
                    this._dockBlur.syncSettings();
                    this._dockBlur.queueCapture(true);
                }
                this.queueRender('full', true);
            }
            return GLib.SOURCE_REMOVE;
        });

        this.actor.connectObject('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            if (this.dockManager) this.dockManager.updatePosition();
            this._updateLayout();

            if (this._mappedRenderTimeoutId) {
                this.registry.remove(this._mappedRenderTimeoutId);
                this._mappedRenderTimeoutId = 0;
            }
            this._mappedRenderTimeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 60, () => {
                this._mappedRenderTimeoutId = 0;
                if (isActorAlive(this.actor) && this.actor.is_mapped()) {
                    this._updateLayout();
                    this.queueRender('incremental', true);
                }
                return GLib.SOURCE_REMOVE;
            });

            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            if (this._dockBlur) {
                this._dockBlur.syncGeometry();
                this._dockBlur.syncSettings();
            }
        }, this);

        const handleScreenGeometryChange = () => {
            if (this._geomResizeTimeoutId) {
                this.registry.remove(this._geomResizeTimeoutId);
            }
            this._geomResizeTimeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 30, () => {
                this._geomResizeTimeoutId = null;
                if (!isActorAlive(this.actor)) return GLib.SOURCE_REMOVE;

                const current = this.monitorManager.getCurrentMonitor();
                if (current && current.monitor) {
                    const mon = current.monitor;
                    const area = Main.layoutManager.getWorkAreaForMonitor(current.index);
                    const geometryKey = [mon.x, mon.y, mon.width, mon.height,
                        area.x, area.y, area.width, area.height].join(',');
                    if (geometryKey === this._lastGeometryKey) return GLib.SOURCE_REMOVE;
                    this._lastGeometryKey = geometryKey;
                }

                this._updateLayout();
                if (this.dockManager && !this._isOverviewActive) {
                    this.dockManager.updatePosition();
                }
                if (this.autoHideManager) {
                    this.autoHideManager.updateTriggerGeometry();
                }
                if (this._dockBlur) {
                    this._dockBlur.syncGeometry();
                }
                return GLib.SOURCE_REMOVE;
            });
        };

        global.display.connectObject('workareas-changed', handleScreenGeometryChange, this);
        Main.layoutManager.connectObject('monitors-changed', handleScreenGeometryChange, this);

        if (global.stage) {
            global.stage.connectObject('notify::width', handleScreenGeometryChange, this);
            global.stage.connectObject('notify::height', handleScreenGeometryChange, this);
        }

        setupWindowEffects(this.settings, this);
        this.autoHideManager = new AutoHideManager(this, this.settings);
        this._syncDashVisibility();

        Main.overview.connectObject('showing', () => {
            if (isActorAlive(this.actor)) {
                this.actor.remove_all_transitions();
                this.actor.translation_x = 0;
                this.actor.translation_y = 0;
            }

            if (!this._hidesGnomeDash()) {
                if (Main.overview.dash) {
                    Main.overview.dash.show();
                    Main.overview.dash.opacity = 255;
                }

                if (this._showsInOverview()) {
                    if (!this._originalPosForOverview) {
                        this._originalPosForOverview = Settings.dockPosition || this.dockPosition;
                    }
                    if (this._isOverviewActive) {
                        this.actor.ease({ opacity: 255, duration: OVERVIEW_FADE_IN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                    } else {
                        this._holdStruts();
                        this._fadeOutForOverview();
                    }
                } else if (isActorAlive(this.actor)) {
                    this.actor.opacity = 0;
                    this.actor.hide();
                }
            } else {
                if (Main.overview.dash) {
                    Main.overview.dash.opacity = 0;
                }
                if (isActorAlive(this.actor)) {
                    this.actor.show();
                    this.actor.opacity = 255;
                }
                if (this.autoHideManager) this.autoHideManager.show();
                this._updateLayout();
                applyOverviewDockMargin(this);
            }
        }, this);

        Main.overview.connectObject('shown', () => {
            if (this._originalPosForOverview && !this._isOverviewActive) {
                if (isActorAlive(this.actor)) this._enterOverviewPosition();
            } else if (this._hidesGnomeDash()) {
                applyOverviewDockMargin(this);
            }
        }, this);

        const controls = Main.overview._overview && Main.overview._overview._controls;
        if (controls && controls._stateAdjustment) {
            controls._stateAdjustment.connectObject('notify::value', () => {
                if (Main.overview.visible || Main.overview.visibleTarget) {
                    if (this._showsInOverview() && this._isOverviewActive) {
                        this._applyOverviewLeftPosition();
                    } else if (this._hidesGnomeDash()) {
                        applyOverviewDockMargin(this);
                    }
                }
            }, this);
        }

        Main.overview.connectObject('hiding', () => {
            if (this._originalPosForOverview) {
                if (isActorAlive(this.actor)) this._fadeOutForOverview();
            } else if (!this._hidesGnomeDash()) {
                if (isActorAlive(this.actor)) {
                    this.actor.opacity = 0;
                }
            }
        }, this);

        Main.overview.connectObject('hidden', () => {
            if (this._hidesGnomeDash()) clearOverviewDockMargin(this);
            this._syncDashVisibility();

            if (isActorAlive(this.actor)) {
                this.actor.remove_all_transitions();
                this._leaveOverviewPosition();
                this.actor.show();
            }

            if (this.autoHideManager) {
                this.autoHideManager.checkVisibility();
            }
            this._queueStrutRestore();
        }, this);

        if (Main.overview.visible) {
            if (this._overviewVisibleIdleId) {
                this.registry.remove(this._overviewVisibleIdleId);
                this._overviewVisibleIdleId = 0;
            }
            this._overviewVisibleIdleId = this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._overviewVisibleIdleId = 0;
                this._updateLayout();
                if (this._hidesGnomeDash() && !Main.overview.animationInProgress) {
                    applyOverviewDockMargin(this);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _scheduleCursorResetBurst() {
        if (!this._cursorResetTimeouts) {
            this._cursorResetTimeouts = [];
        } else {
            for (let i = 0; i < this._cursorResetTimeouts.length; i++) {
                if (this._cursorResetTimeouts[i]) {
                    this.registry.remove(this._cursorResetTimeouts[i]);
                }
            }
            this._cursorResetTimeouts = [];
        }

        CURSOR_BURST_DELAYS.forEach(delayMs => {
            const timeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, delayMs, () => {
                const idx = this._cursorResetTimeouts.indexOf(timeoutId);
                if (idx !== -1) this._cursorResetTimeouts.splice(idx, 1);
                const tracker = Shell.WindowTracker.get_default();

                if (tracker.get_startup_sequences) {
                    const sequences = tracker.get_startup_sequences();
                    if (sequences && sequences.length > 0) {
                        for (let i = 0; i < sequences.length; i++) {
                            if (sequences[i].complete) sequences[i].complete();
                        }
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
            this._cursorResetTimeouts.push(timeoutId);
        });
    }

    triggerPostDragSettle() {
        if (this._postDragSettleId) {
            this.registry.remove(this._postDragSettleId);
        }

        this._postDragSettleId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
            this._postDragSettleId = null;
            this._pendingRender = false;
            this.queueRender('incremental');
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._grabbedWindow) {
            this._grabbedWindow.disconnectObject(this);
            this._grabbedWindow = null;
        }
        global.stage.disconnectObject(this);
        global.stage.disconnectObject(this._launchUnpause);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        const controls = Main.overview._overview && Main.overview._overview._controls;
        if (controls && controls._stateAdjustment) {
            controls._stateAdjustment.disconnectObject(this);
        }
        Main.sessionMode.disconnectObject(this);

        if (this.appManager && this.appManager.appSystem) this.appManager.appSystem.disconnectObject(this);
        if (this.settings) this.settings.disconnectObject(this);
        if (this.volumeMonitor) this.volumeMonitor.disconnectObject(this);
        if (this._bgSettings) this._bgSettings.disconnectObject(this);
        if (this._interfaceSettings) this._interfaceSettings.disconnectObject(this);
        cancelChameleonColor(this);
        if (this._iconThemeSettings) this._iconThemeSettings.disconnectObject(this);
        this._teardownTrashMonitor();

        if (this.boxActor) this.boxActor.disconnectObject(this);
        if (this.bgActor) this.bgActor.disconnectObject(this);
        if (this.actor) {
            if (this.actor._launchTimeoutId) {
                this.registry.remove(this.actor._launchTimeoutId);
                this.actor._launchTimeoutId = null;
            }
            this.actor.disconnectObject(this);
        }
        if (DockUI._instances) {
            DockUI._instances.delete(this);
            if (DockUI._instances.size === 0) DockUI._instances = null;
        }

        this._executeScheduledRender.cancel();
        this.checkPanelOverflow.cancel();
        if (this._panelSyncLaterId) {
            global.compositor.get_laters().remove(this._panelSyncLaterId);
            this._panelSyncLaterId = 0;
        }

        if (this._cursorResetTimeouts) {
            this._cursorResetTimeouts.forEach(id => this.registry.remove(id));
            this._cursorResetTimeouts = [];
        }

        const timeoutProps = [
            '_allocIdleId',
            '_wmDestroyRenderId',
            '_wmMapRenderId',
            '_isolateMonitorRenderDelayId',
            '_musicPillIdleId',
            '_preloadAppsTimeoutId',
            '_strutRestoreId',
            '_grabWatchTimerId',
            '_showInitIdleId',
            '_mappedRenderTimeoutId',
            '_geomResizeTimeoutId',
            '_overviewVisibleIdleId',
            '_postDragSettleId',
        ];
        for (const prop of timeoutProps) {
            if (this[prop]) {
                this.registry.remove(this[prop]);
                this[prop] = 0;
            }
        }

        cleanupDockRenderer(this);
        if (this.registry) {
            this.registry.destroy();
            this.registry = null;
        }
        if (this.autoHideManager) {
            this.autoHideManager.destroy();
            this.autoHideManager = null;
        }
        if (this.panelIntegrator) {
            this.panelIntegrator.destroy();
            this.panelIntegrator = null;
        }
        if (this.dockManager) this.dockManager.destroy();
        if (this.appGridUI) this.appGridUI.destroy();
        if (this.notificationManager) this.notificationManager.destroy();

        destroyExternalDrop(this);
        cleanupTrashEffects();
        teardownWindowEffects(this);
        teardownMagnification(this.actor);

        if (this._activeContextMenu) {
            this._activeContextMenu.hide();
            this._activeContextMenu = null;
        }
        if (this._activeFolderMenu) {
            this._activeFolderMenu.hide();
            this._activeFolderMenu = null;
        }
        if (this._overflowMenu) {
            this._overflowMenu.destroy();
            this._overflowMenu = null;
        }
        if (this._musicPill) {
            this._musicPill.destroy();
            this._musicPill = null;
        }

        if (this.appManager) {
            this.appManager.detachDock(this);
            this.appManager = null;
        }
        this.folderManager = null;

        if (this._actorRegistry) this._actorRegistry.clear();
        if (this._separatorRegistry) this._separatorRegistry.clear();
        cancelDockTransitions(this);
        if (this._desktopToggle) {
            this._desktopToggle.destroy();
            this._desktopToggle = null;
        }

        if (this._dockBlur) {
            this._dockBlur.destroy();
            this._dockBlur = null;
        }

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
        }
        this._releaseStrutHolder();

        clearOverviewDockMargin(this);
        cancelIconPicker();
    }
}