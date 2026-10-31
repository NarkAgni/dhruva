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
import { StartMenu } from '../startmenu/StartMenu.js';
import DockManager from '../../core/DockManager.js';
import { updateLayout } from './DockLayoutEngine.js';
import ScrollManager from '../../core/ScrollManager.js';
import { Settings } from '../../core/SettingsManager.js';
import { isFullBarLayout } from '../../core/LayoutMode.js';
import { destroyExternalDrop } from '../ExternalDrop.js';
import MonitorManager from '../../core/MonitorManager.js';
import PanelIntegrator from '../../core/PanelIntegrator.js';
import { applyDynamicStyles, refreshChameleonColor, cancelChameleonColor } from './DockThemeResolver.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { refreshTrashState } from '../modules/TrashModule.js';
import { cleanupTrashEffects } from '../effects/TrashEffect.js';
import NotificationManager from '../../core/NotificationManager.js';
import { cancelIconPicker } from '../folder-menu/FolderIconFiles.js';
import DockGrabController from './DockGrabController.js';
import AutoHideManager from '../../core/autohide/AutoHideManager.js';
import DockOverviewController from './DockOverviewController.js';
import { teardownMagnification } from '../magnifier/MagnifierReset.js';
import { requestAttention, cancelDockTransitions } from './DockTransitions.js';
import { setupWindowEffects, teardownWindowEffects, animateLaunch } from '../effects/WindowEffects.js';
import { getWindowIdentity, pruneExpiredLaunches, claimLaunchForWindow } from './LaunchMatcher.js';
import { counterScaleButtonIndicators } from './DockButtonBase.js';
import { debounce, setBoxVertical, isActorAlive, captureActorRect, clearIconColorCache } from '../../core/Utils.js';
import { renderDock, getIndicatorProps, syncOverflowWithPanel, syncRunningStates, cleanupDockRenderer, isDockLayoutUnchanged } from './DockRenderer.js';


const RENDER_DEBOUNCE_MS = 5;
const PANEL_OVERFLOW_DEBOUNCE_MS = 40;
const INDICATOR_REFRESH_DEBOUNCE_MS = 50;
const WINDOW_SETTLE_REFRESH_MS = 80;
const ISOLATE_MONITOR_RENDER_DELAY_MS = 150;
const PRELOAD_APPS_DELAY_MS = 2500;
const SESSION_MENU_KEYS = ['activeContextMenu', 'activeFolderMenu', 'activeTrayMenu'];
const DOCK_MENU_KEYS = ['activeContextMenu', 'activeFolderMenu'];
const CURSOR_BURST_DELAYS = [50, 150, 300, 600, 1000, 1500, 2000];

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
        this.activeContextMenu = null;
        this.pendingLaunches = [];
        this._cursorResetTimeouts = [];
        this._overviewController = new DockOverviewController(this);
        this._grabController = new DockGrabController(this);

        this._actorRegistry = new Map();
        this._separatorRegistry = new Map();
        this._currentOrder = [];
        this._itemSpans = new Map();
        this.overflowMenu = null;
        this.startMenu = null;
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
        this._preloadStartMenu();

        if (!DockUI._instances) DockUI._instances = new Set();
        DockUI._instances.add(this);
    }

    _bindMethods() {
        this.render = (mode = 'incremental', force = false) => renderDock(this, mode, force);
        this.updateLayout = () => updateLayout(this);

        this.checkPanelOverflow = debounce(() => syncOverflowWithPanel(this), PANEL_OVERFLOW_DEBOUNCE_MS);
        this.refreshIndicatorColors = debounce(() => syncRunningStates(this, true), INDICATOR_REFRESH_DEBOUNCE_MS);
        this.syncPanelSpace = () => {
            if (this._panelSyncLaterId) return;
            this._panelSyncLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._panelSyncLaterId = 0;
                if (isActorAlive(this.actor)) {
                    this.updateLayout();
                    this.checkPanelOverflow();
                }
                return GLib.SOURCE_REMOVE;
            });
        };
        this._applyDynamicStyles = () => applyDynamicStyles(this);
        this._getIndicatorProps = () => getIndicatorProps(this);
        this.isActorAlive = isActorAlive;

        const executeScheduledRender = this._executeScheduledRender = debounce(() => {
            if (this.render) {
                const state = this._pendingRenderState || { mode: 'incremental', force: false };
                const modeToRun = state.mode || 'incremental';
                const forceToRun = Boolean(state.force);

                this._pendingRenderState.mode = 'incremental';
                this._pendingRenderState.force = false;
                this._pendingRenderState.reason = '';
                this._pendingRenderState.dirtyKeys.clear();

                this.render(modeToRun, forceToRun);
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

        this.dockBlur = new BlurPanel(this.bgActor, this.settings, this._getDockCornerRadius(), this.actor);

        this._syncBlurGeometry = () => {
            if (this.dockBlur) {
                this.dockBlur.setCornerRadius(this._getDockCornerRadius());
                this.dockBlur.syncGeometry();
            }
        };

        ScrollManager.setupDockScroll(this.actor);
    }

    hasActivePopupOrDrag() {
        return Boolean(
            this.activeContextMenu ||
            this.activeFolderMenu ||
            this.activeTrayMenu ||
            (this.overflowMenu && this.overflowMenu.isOpen) ||
            (this.startMenu && this.startMenu.isOpen) ||
            this.actor._isDragging ||
            (this.panelIntegrator && this.panelIntegrator.hasOpenPopupOrDrag())
        );
    }

    _getDockCornerRadius() {
        return isFullBarLayout() ? 0 : Settings.borderRadius;
    }

    _connectSignals() {
        this.appManager.attachDock(this);
        this._bindMenuDismissal();
        this._bindAllocation();
        this._bindAppEvents();
        this._bindWindowEvents();
        this._bindDisplayEvents();
        this._bindRenderSettings();
        this._bindPlacementSettings();
        this._bindSystemWatchers();
        this._schedulePreloadApps();
    }

    _closeMenus(menuKeys) {
        let closedAny = false;
        for (const key of menuKeys) {
            if (!this[key]) continue;
            this[key].hide();
            this[key] = null;
            closedAny = true;
        }
        return closedAny;
    }

    _isEventOnMenuButton(event, menu) {
        if (!menu || !isActorAlive(menu.buttonActor)) return false;
        const target = global.stage.get_event_actor(event);
        return Boolean(target) && menu.buttonActor.contains(target);
    }

    _onEmptySpaceClick(event) {
        if (this._isEventOnMenuButton(event, this.activeContextMenu) || this._isEventOnMenuButton(event, this.activeFolderMenu)) {
            return Clutter.EVENT_PROPAGATE;
        }
        return this._closeMenus(DOCK_MENU_KEYS) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    _bindMenuDismissal() {
        Main.sessionMode.connectObject('updated', () => this._closeMenus(SESSION_MENU_KEYS), this);

        const onClick = (_actor, event) => this._onEmptySpaceClick(event);
        this.actor.connectObject('button-press-event', onClick, 'button-release-event', onClick, this);
        this.bgActor.connectObject('button-press-event', onClick, this);
        this.boxActor.connectObject('button-press-event', onClick, this);
    }

    _bindAllocation() {
        this.boxActor.connectObject('notify::allocation', () => {
            if (this._allocIdleId) return;
            this._allocIdleId = this.registry.addIdle(GLib.PRIORITY_DEFAULT, () => {
                this._allocIdleId = 0;
                if (isActorAlive(this.actor) && this.actor.is_mapped()) {
                    this.updateLayout();
                    this._overviewController.syncPlacement();
                }
                return GLib.SOURCE_REMOVE;
            });
        }, this);
    }

    _bindAppEvents() {
        this.appManager.appSystem.connectObject(
            'installed-changed', () => this.queueRender('incremental'),
            'app-state-changed', () => this._refreshForWindows(false),
            this
        );
    }

    _refreshNowAndSoon(timerKey) {
        this._refreshForWindows(true);
        this.registry.remove(this[timerKey]);
        this[timerKey] = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, WINDOW_SETTLE_REFRESH_MS, () => {
            this[timerKey] = 0;
            this._refreshForWindows(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _bindWindowEvents() {
        const captureBlur = () => this.dockBlur.queueCapture();

        global.window_manager.connectObject(
            'destroy', () => {
                this.actor._lastIconClickTime = 0;
                this._refreshNowAndSoon('_wmDestroyRenderId');
            },
            'map', (_wm, actor) => this._onWindowMapped(actor),
            'switch-workspace', captureBlur,
            'minimize', captureBlur,
            'unminimize', captureBlur,
            'size-change', captureBlur,
            this
        );
    }

    _onWindowMapped(windowActor) {
        this.actor._lastIconClickTime = 0;
        this.actor._fixedSlots = null;
        this.actor._tooltipHoveredIndex = -1;
        this.actor._magTooltipAppId = null;
        this._refreshNowAndSoon('_wmMapRenderId');

        if (Settings.isolateMonitors) {
            this.registry.remove(this._isolateMonitorRenderDelayId);
            this._isolateMonitorRenderDelayId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, ISOLATE_MONITOR_RENDER_DELAY_MS, () => {
                this._isolateMonitorRenderDelayId = 0;
                this.queueRender('incremental');
                return GLib.SOURCE_REMOVE;
            });
        }

        this._animatePendingLaunch(windowActor.meta_window);
    }

    _animatePendingLaunch(win) {
        if (this.pendingLaunches.length === 0) return;
        this.pendingLaunches = pruneExpiredLaunches(this.pendingLaunches, Date.now());
        if (this.pendingLaunches.length === 0) return;

        if (!win || win.get_window_type() !== Meta.WindowType.NORMAL) return;

        const identity = getWindowIdentity(win, Shell.WindowTracker.get_default());
        const launch = claimLaunchForWindow(this.pendingLaunches, identity);
        if (!launch) return;

        if (Settings.isolateMonitors) {
            const targetMonitor = this.monitorManager.getCurrentMonitor().index;
            if (win.get_monitor() !== targetMonitor) win.move_to_monitor(targetMonitor);
        }

        animateLaunch(win, launch.btn, this.dockPosition, launch.iconRect || captureActorRect(launch.btn, win));
    }

    _bindDisplayEvents() {
        const renderIfIsolated = () => {
            if (!this.isWindowGrabbed && Settings.isolateMonitors) this.queueRender('incremental');
        };

        global.display.connectObject(
            'restacked', () => this.dockBlur.queueCapture(),
            'grab-op-begin', (_display, window) => this._grabController.onGrabBegin(window),
            'grab-op-end', () => this._grabController.onGrabEnd(),
            'notify::focus-window', () => this._onFocusWindowChanged(),
            'window-entered-monitor', renderIfIsolated,
            'window-left-monitor', renderIfIsolated,
            this
        );

        global.workspace_manager.connectObject('active-workspace-changed', () => {
            if (!Settings.isolateWorkspaces) return;
            this.actor._lastIconClickTime = 0;
            this.queueRender('incremental');
        }, this);
    }

    _onFocusWindowChanged() {
        if (this.isWindowGrabbed) return;
        this._updateRunningStatesFast();

        const overflowClosed = !this.overflowMenu || !this.overflowMenu.isOpen;
        if (Settings.hybridPanelMode && this._overflowKeys && overflowClosed && global.display.get_focus_window()) {
            this._refreshForWindows(true);
        }
    }

    _repaintOpenMenus() {
        for (const key of SESSION_MENU_KEYS) {
            const menu = this[key];
            if (menu && menu.bgDrawingArea) menu.bgDrawingArea.queue_repaint();
        }
        if (this.overflowMenu) this.overflowMenu.queueRepaint();
    }

    _connectSettings(keys, handler) {
        for (const key of keys) this.settings.connectObject(`changed::${key}`, handler, this);
    }

    _bindRenderSettings() {
        this._connectSettings(WATCHED_SETTINGS, () => {
            this.queueRender('full', true);
            this.updateLayout();
        });

        this._connectSettings(STYLE_SETTINGS, () => {
            this._applyDynamicStyles();
            this.updateLayout();
            this.dockManager.updatePosition();
            this.checkPanelOverflow();
            this._repaintOpenMenus();
        });

        this._connectSettings(BLUR_SETTING_KEYS, () => {
            this.dockBlur.syncSettings();
            this.dockBlur.syncGeometry();
            this._applyDynamicStyles();
            this.updateLayout();
        });

        this._connectSettings(['grid-button-position', 'show-grid-button'], () => this.queueRender('full', true));

        this._connectSettings(['show-music-pill', 'music-pill-position'], () => {
            if (this._musicPill) {
                this._musicPill.destroy();
                this._musicPill = null;
            }

            this.queueRender('full', true);
            this.registry.remove(this._musicPillIdleId);
            this._musicPillIdleId = this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._musicPillIdleId = 0;
                this.updateLayout();
                this.dockManager.updatePosition();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _bindPlacementSettings() {
        this._connectSettings(['hide-mode'], () => this.updateStruts());

        this._connectSettings(['dock-margin'], () => {
            this.updateLayout();
            this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            this.updateStruts();
        });

        this._connectSettings(['preferred-monitor'], () => {
            this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            this.updateStruts();
            this.queueRender('full', true);
        });
    }

    _bindSystemWatchers() {
        this.volumeMonitor = Gio.VolumeMonitor.get();
        this.volumeMonitor.connectObject(
            'mount-added', () => this.queueRender('incremental'),
            'mount-removed', () => this.queueRender('incremental'),
            this
        );

        this._setupChameleonWatcher();
        this._syncTrashMonitor();
        this._connectSettings(['show-trash'], () => {
            this._trashIsFull = undefined;
            this._syncTrashMonitor();
            this.queueRender('incremental', true);
        });

        this._iconThemeSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        this._iconThemeSettings.connectObject('changed::icon-theme', () => {
            clearIconColorCache();
            this.queueRender('full', true);
        }, this);
    }

    _schedulePreloadApps() {
        this.registry.remove(this._preloadAppsTimeoutId);
        this._preloadAppsTimeoutId = this.registry.addTimeout(GLib.PRIORITY_LOW, PRELOAD_APPS_DELAY_MS, () => {
            this._preloadAppsTimeoutId = 0;
            const controls = Main.overview._overview && Main.overview._overview._controls;
            if (controls && controls._appDisplay && controls._appDisplay._ensureIcon) {
                controls._appDisplay.create_all_apps();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _refreshForWindows(force) {
        if (this._initialLayoutDone && !this._isRendering && isActorAlive(this.actor) && isDockLayoutUnchanged(this)) {
            this.actor._magTooltipAppId = null;
            this._updateRunningStatesFast();
            return;
        }
        this.queueRender('incremental', force);
    }

    _updateRunningStatesFast() {
        if (!isActorAlive(this.boxActor)) return;
        syncRunningStates(this);
        if (!this.actor._isZoomActive) return;

        for (const { actor } of this._actorRegistry.values()) {
            if (!isActorAlive(actor)) continue;
            const sx = actor.scale_x || 1.0;
            const sy = actor.scale_y || 1.0;
            if (Math.abs(sx - 1.0) > 0.001 || Math.abs(sy - 1.0) > 0.001) {
                counterScaleButtonIndicators(actor, this.dockPosition);
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
            if (this.dockBlur) {
                this.dockBlur._hasContent = false;
                this.dockBlur.queueCapture();
            }
        };
        this._bgSettings.connectObject('changed::picture-uri', onWallpaperChange, this);
        this._bgSettings.connectObject('changed::picture-uri-dark', onWallpaperChange, this);

        this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        this._interfaceSettings.connectObject('changed::color-scheme', onWallpaperChange, this);
    }

    get isOverviewActive() {
        return this._overviewController.isActive;
    }

    get isRelocatedForOverview() {
        return this._overviewController.isRelocated;
    }

    get isWindowGrabbed() {
        return this._grabController.isGrabbed;
    }

    applyOverviewLeftPosition() {
        this._overviewController.applyLeftPosition();
    }

    isOnSharedMonitorEdge() {
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

    updateStruts() {
        if (!this.actor || !isActorAlive(this.actor)) return;

        const isSharedEdge = (this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT') && this.isOnSharedMonitorEdge();
        const shouldAffectStruts = (Settings.hideMode === 'none') &&
            !this.isOverviewActive &&
            !this.isWindowGrabbed &&
            !isSharedEdge;

        if (shouldAffectStruts && !this.isWindowGrabbed) {
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

        if (this.dockManager && !this.isOverviewActive && !this.isWindowGrabbed) {
            this.dockManager.updatePosition();
        }

        const activeWorkspace = global.display.get_workspace_manager().get_active_workspace();
        if (activeWorkspace && activeWorkspace.check_unfocused_window_drag) {
            activeWorkspace.check_unfocused_window_drag();
        }
    }

    show() {
        const isSharedEdge = (this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT') && this.isOnSharedMonitorEdge();
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

        this.render('full', true);
        if (this.dockManager) {
            this.dockManager.updatePosition();
        }
        this.updateLayout();

        if (this._showInitIdleId) {
            this.registry.remove(this._showInitIdleId);
            this._showInitIdleId = 0;
        }
        this._showInitIdleId = this.registry.addIdle(GLib.PRIORITY_LOW, () => {
            this._showInitIdleId = 0;
            if (isActorAlive(this.actor)) {
                if (this.dockManager) this.dockManager.updatePosition();
                this.updateLayout();
                this.actor.remove_all_transitions();
                this.actor.opacity = 255;
                if (this.dockBlur) {
                    this.dockBlur.syncGeometry();
                    this.dockBlur.syncSettings();
                    this.dockBlur.queueCapture(true);
                }
                this.queueRender('full', true);
            }
            return GLib.SOURCE_REMOVE;
        });

        this.actor.connectObject('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            if (this.dockManager) this.dockManager.updatePosition();
            this.updateLayout();

            if (this._mappedRenderTimeoutId) {
                this.registry.remove(this._mappedRenderTimeoutId);
                this._mappedRenderTimeoutId = 0;
            }
            this._mappedRenderTimeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 60, () => {
                this._mappedRenderTimeoutId = 0;
                if (isActorAlive(this.actor) && this.actor.is_mapped()) {
                    this.updateLayout();
                    this.queueRender('incremental', true);
                }
                return GLib.SOURCE_REMOVE;
            });

            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            if (this.dockBlur) {
                this.dockBlur.syncGeometry();
                this.dockBlur.syncSettings();
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

                this.updateLayout();
                if (this.dockManager && !this.isOverviewActive) {
                    this.dockManager.updatePosition();
                }
                if (this.autoHideManager) {
                    this.autoHideManager.updateTriggerGeometry();
                }
                if (this.dockBlur) {
                    this.dockBlur.syncGeometry();
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
        this._overviewController.bind();
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

    _preloadStartMenu() {
        if (!Settings.hybridPanelMode || !Settings.startMenu) return;
        this.registry.addIdle(GLib.PRIORITY_LOW, () => {
            if (!this.startMenu && isActorAlive(this.actor)) this.startMenu = new StartMenu(this);
            return GLib.SOURCE_REMOVE;
        });
    }

    toggleStartMenu() {
        if (!this.startMenu) this.startMenu = new StartMenu(this);
        this.startMenu.toggle();
    }

    destroy() {
        this._grabController.destroy();
        global.stage.disconnectObject(this);
        global.stage.disconnectObject(this._launchUnpause);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._overviewController.destroy();
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
        this.refreshIndicatorColors.cancel();
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
            '_showInitIdleId',
            '_mappedRenderTimeoutId',
            '_geomResizeTimeoutId',
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

        if (this.activeContextMenu) {
            this.activeContextMenu.hide();
            this.activeContextMenu = null;
        }
        if (this.activeFolderMenu) {
            this.activeFolderMenu.hide();
            this.activeFolderMenu = null;
        }
        if (this.overflowMenu) {
            this.overflowMenu.destroy();
            this.overflowMenu = null;
        }
        if (this.startMenu) {
            this.startMenu.destroy();
            this.startMenu = null;
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

        if (this.dockBlur) {
            this.dockBlur.destroy();
            this.dockBlur = null;
        }

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
        }
        cancelIconPicker();
    }
}