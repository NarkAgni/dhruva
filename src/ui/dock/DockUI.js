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
import AppManager from '../../core/AppManager.js';
import DockManager from '../../core/DockManager.js';
import { updateLayout } from './DockLayoutEngine.js';
import ScrollManager from '../../core/ScrollManager.js';
import FolderManager from '../../core/FolderManager.js';
import { Settings } from '../../core/SettingsManager.js';
import MonitorManager from '../../core/MonitorManager.js';
import { applyDynamicStyles } from './DockThemeResolver.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { cleanupTrashEffects } from '../effects/TrashEffect.js';
import { renderDock, getIndicatorProps } from './DockRenderer.js';
import NotificationManager from '../../core/NotificationManager.js';
import AutoHideManager from '../../core/autohide/AutoHideManager.js';
import { teardownMagnification } from '../magnifier/MagnifierReset.js';
import { applyOverviewDockMargin, clearOverviewDockMargin } from './OverviewMargin.js';
import { setupWindowEffects, teardownWindowEffects, animateLaunch } from '../effects/WindowEffects.js';
import { debounce, setBoxVertical, isActorAlive, captureActorRect, clearIconColorCache } from '../../core/Utils.js';


const RENDER_DEBOUNCE_MS = 5;
const LAUNCH_EXPIRY_MS = 8000;
const CURSOR_BURST_DELAYS = [50, 150, 300, 600, 1000, 1500, 2000];

const WATCHED_SETTINGS = [
    'dock-margin', 'icon-size', 'show-grid-button', 'show-running-indicators', 'hover-zoom', 'hover-zoom-factor',
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
    'desktop-btn-width', 'desktop-btn-opacity', 'desktop-btn-color', 'show-independent-in-overview',
    'show-music-pill', 'music-pill-position', 'indicator-color-mode'
];

const STYLE_SETTINGS = [
    'background-color', 'background-opacity', 'border-radius', 'stroke-color', 'stroke-opacity',
    'icon-spacing', 'dock-theme', 'use-gradient', 'background-gradient-color',
    'gradient-direction'
];

export default class DockUI {
    static _instances = new Set();

    constructor(settings, openPrefsCallback, uuid, monitorIndex = null) {
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.dockPosition = Settings.dockPosition || 'BOTTOM';

        this.registry = new TimeoutTracker();
        this._activeContextMenu = null;
        this._cursorResetTimeouts = [];
        this._originalPosForOverview = null;

        this._actorRegistry = new Map();
        this._separatorRegistry = new Map();
        this._currentOrder = [];
        this._pendingRenderState = {
            mode: 'incremental',
            force: false,
            reason: '',
            dirtyKeys: new Set()
        };
        this._preRenderPositions = new Map();
        this._isRendering = false;
        this._pendingRender = false;
        this._previousIconCount = undefined;

        this._patchDashAdjustIconSize();

        this.appManager = new AppManager(uuid, this.settings);
        this.appManager.setDockUI(this);

        this.folderManager = new FolderManager(this.settings, uuid, this.appManager, this);

        this.monitorManager = new MonitorManager(this.settings, monitorIndex);
        this.dockManager = new DockManager(this, settings);
        this.notificationManager = new NotificationManager(this);
        this.appGridUI = new AppGridUI(this);
        this._initActors();
        this._bindMethods();
        this._connectSignals();
        DockUI._instances.add(this);
        this.queueRender('full', true);
    }

    _patchDashAdjustIconSize() {
        if (Main.overview && Main.overview.dash && !Main.overview.dash._dhruvaPatched) {
            const dash = Main.overview.dash;
            dash._dhruvaPatched = true;
            const origAdjustIconSize = dash._adjustIconSize;
            if (origAdjustIconSize) {
                dash._adjustIconSize = function () {
                    try {
                        const iconChildren = this._box ? this._box.get_children() : [];
                        if (iconChildren.length > 0) {
                            const firstChild = iconChildren[0];
                            const firstIcon = firstChild && firstChild.child ? firstChild.child : firstChild;
                            if (firstIcon && !firstIcon.icon) {
                                return;
                            }
                        }
                        origAdjustIconSize.call(this);
                    } catch (_e) { }
                };
            }
        }
    }

    _bindMethods() {
        this._renderDock = (mode = 'incremental', force = false) => renderDock(this, mode, force);
        this._updateLayout = () => updateLayout(this);
        this._applyDynamicStyles = () => applyDynamicStyles(this);
        this._getIndicatorProps = () => getIndicatorProps(this);
        this._captureActorRect = (actor, fb) => captureActorRect(actor, fb);
        this.isActorAlive = isActorAlive;

        const executeScheduledRender = debounce(() => {
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

        this.bgActor = new St.Widget({ name: 'DhruvaBackground', style_class: 'plank-like-dock-bg', reactive: true, clip_to_allocation: false });
        this.boxActor = new St.BoxLayout({ name: 'Dhruva', style_class: 'plank-like-dock', reactive: true, track_hover: true, clip_to_allocation: false });

        setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
        this.boxActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };

        this.actor.add_child(this.bgActor);
        this.actor.add_child(this.boxActor);
        this.actor.bgActor = this.bgActor;
        this.actor.boxActor = this.boxActor;

        ScrollManager.setupDockScroll(this.actor);
    }

    _connectSignals() {
        this.appManager.onStateChanged(() => this.queueRender('incremental'));
        this.folderManager.onStateChanged(() => this.queueRender('incremental'));

        Main.sessionMode.connectObject('updated', () => {
            if (this._activeContextMenu) {
                this._activeContextMenu.hide();
                this._activeContextMenu = null;
            }
            if (this._activeFolderMenu) {
                this._activeFolderMenu.hide();
                this._activeFolderMenu = null;
            }
        }, this);

        const handlePrefsTrigger = (_actor, event) => {
            if (event.get_button() === 3 && !this._activeContextMenu) {
                if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) && this.openPrefsCallback) {
                    const res = this.openPrefsCallback();
                    if (res instanceof Promise) res.catch(e => console.warn('[Dhruva]', e.message));
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        };

        this.actor.connectObject('button-release-event', handlePrefsTrigger, this);
        this.bgActor.connectObject('button-press-event', handlePrefsTrigger, this);

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
            this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                this.queueRender('incremental', true);
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        global.window_manager.connectObject('map', (_wm, actor) => {
            if (this.actor) {
                this.actor._lastIconClickTime = 0;
                this.actor._fixedSlots = null;
                this.actor._tooltipHoveredIndex = -1;
                this.actor._magTooltipAppId = null;
            }
            this.queueRender('incremental', true);
            this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
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
                try {
                    animateLaunch(win, pending.btn, this.dockPosition, iconRect);
                } catch (_e) {
                    if (isActorAlive(actor)) actor.opacity = 255;
                }
            }
        }, this);

        global.display.connectObject('notify::focus-window', () => {
            this.queueRender('incremental', true);
        }, this);

        global.display.connectObject('window-entered-monitor', () => {
            if (Settings.isolateMonitors) this.queueRender('incremental');
        }, this);

        global.display.connectObject('window-left-monitor', () => {
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
            }, this);
        });

        ['full-width', 'icon-alignment', 'grid-button-position'].forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
                this.queueRender('full', true);
                if (key === 'full-width') this._updateStruts();
            }, this);
        });

        ['show-music-pill', 'music-pill-position'].forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                if (this._musicPill) {
                    this._musicPill.destroy();
                    this._musicPill = null;
                }

                this.queueRender('full', true);
                this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._updateLayout();
                    if (this.dockManager) this.dockManager.updatePosition();
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        });

        this.settings.connectObject('changed::hide-mode', () => {
            this._updateStruts();
        }, this);

        this.settings.connectObject('changed::dock-position', () => {
            if (this._isOverviewActive) return;
            const newPos = Settings.dockPosition;
            this.dockPosition = newPos;
            setBoxVertical(this.boxActor, newPos === 'LEFT' || newPos === 'RIGHT');
            this.queueRender('full', true);

            this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._updateLayout();
                if (this.dockManager) this.dockManager.updatePosition();
                if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
                return GLib.SOURCE_REMOVE;
            });
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
        this._setupTrashMonitor();

        this._iconThemeSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        this._iconThemeSettings.connectObject('changed::icon-theme', () => {
            if (clearIconColorCache) clearIconColorCache();
            this.queueRender('full', true);
        }, this);

        this.registry.addTimeout(GLib.PRIORITY_LOW, 2500, () => {
            const controls = Main.overview._overview && Main.overview._overview._controls;
            if (controls && controls._appDisplay && controls._appDisplay._ensureIcon) {
                controls._appDisplay.create_all_apps();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupTrashMonitor() {
        const trashDir = Gio.File.new_for_uri('trash:///');
        this._trashMonitor = trashDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._trashMonitor.connectObject('changed', () => {
            if (this._trashRefreshId) return;
            this._trashRefreshId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                this._trashRefreshId = null;
                this.queueRender('incremental');
                return GLib.SOURCE_REMOVE;
            });
        }, this);
    }

    _setupChameleonWatcher() {
        this._bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        const onWallpaperChange = () => {
            this._chameleonColor = null;
            this._chameleonAccent = null;
            if (Settings.dockTheme === 'chameleon') {
                this._applyDynamicStyles();
                this.queueRender('full', true);
            }
        };
        this._bgSettings.connectObject('changed::picture-uri', onWallpaperChange, this);
        this._bgSettings.connectObject('changed::picture-uri-dark', onWallpaperChange, this);
    }

    _syncDashVisibility() {
        if (Main.overview && Main.overview.dash) {
            if (Settings.independentDock) {
                Main.overview.dash.show();
                Main.overview.dash.opacity = 255;
            } else if (!Main.overview.visible) {
                Main.overview.dash.hide();
            }
        }
    }

    _applyOverviewLeftPosition() {
        if (!isActorAlive(this.actor)) return;
        const monResult = this.monitorManager.getCurrentMonitor();
        if (!monResult || !monResult.monitor) return;
        const mon = monResult.monitor;

        const dockW = this.actor.width || 60;
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

    _updateStruts() {
        if (!this.actor || !isActorAlive(this.actor)) return;

        const shouldAffectStruts = (Settings.hideMode === 'none') && !this._isOverviewActive;

        if (shouldAffectStruts) {
            this.actor.translation_x = 0;
            this.actor.translation_y = 0;
        }

        Main.layoutManager.removeChrome(this.actor);
        this.actor._affectsStruts = shouldAffectStruts;

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: shouldAffectStruts,
            trackFullscreen: true,
        });

        if (this.dockManager && !this._isOverviewActive) {
            this.dockManager.updatePosition();
        }

        Main.layoutManager._queueUpdateRegions();
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
        const shouldAffectStruts = (Settings.hideMode === 'none');
        this.actor._affectsStruts = shouldAffectStruts;

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: shouldAffectStruts,
            trackFullscreen: true
        });

        this.actor.connectObject('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            this.queueRender('incremental', true);
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
        }, this);

        global.display.connectObject('workareas-changed', () => {
            if (this.dockManager && !this._isOverviewActive) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
        }, this);

        setupWindowEffects(this.settings, this);
        this.autoHideManager = new AutoHideManager(this, this.settings);
        this._syncDashVisibility();

        Main.overview.connectObject('showing', () => {
            if (isActorAlive(this.actor)) {
                this.actor.remove_all_transitions();
                this.actor.translation_x = 0;
                this.actor.translation_y = 0;
            }

            if (Settings.independentDock) {
                if (Main.overview.dash) {
                    Main.overview.dash.show();
                    Main.overview.dash.opacity = 255;
                }

                if ((Settings.independentDock && Settings.showIndependentInOverview)) {
                    this._isOverviewActive = true;
                    if (!this._originalPosForOverview) {
                        this._originalPosForOverview = Settings.dockPosition || this.dockPosition;
                    }

                    this.dockPosition = 'LEFT';
                    setBoxVertical(this.boxActor, true);

                    if (isActorAlive(this.actor)) {
                        this.actor.opacity = 0;
                        this.actor.show();
                    }

                    this._renderDock('full', true);
                    this._updateLayout();
                    this._applyOverviewLeftPosition();

                    if (isActorAlive(this.actor)) {
                        this.actor.ease({
                            opacity: 255,
                            duration: 200,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
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
            if ((Settings.independentDock && Settings.showIndependentInOverview)) {
                if (isActorAlive(this.actor)) {
                    this.actor.show();
                    this.actor.opacity = 255;
                    this._applyOverviewLeftPosition();
                }
            } else if (!Settings.independentDock) {
                applyOverviewDockMargin(this);
            }
        }, this);

        const controls = Main.overview._overview && Main.overview._overview._controls;
        if (controls && controls._stateAdjustment) {
            controls._stateAdjustment.connectObject('notify::value', () => {
                if (Main.overview.visible || Main.overview.visibleTarget) {
                    if ((Settings.independentDock && Settings.showIndependentInOverview) && this._isOverviewActive) {
                        this._applyOverviewLeftPosition();
                    } else if (!Settings.independentDock) {
                        applyOverviewDockMargin(this);
                    }
                }
            }, this);
        }

        Main.overview.connectObject('hiding', () => {
            clearOverviewDockMargin(this);

            if ((Settings.independentDock && Settings.showIndependentInOverview)) {
                if (isActorAlive(this.actor)) {
                    this.actor.remove_all_transitions();
                    this.actor.ease({
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
            } else if (Settings.independentDock) {
                if (isActorAlive(this.actor)) {
                    this.actor.opacity = 0;
                }
            }

            if (!Settings.independentDock && Main.overview.dash) {
                Main.overview.dash.opacity = 0;
            }
        }, this);

        Main.overview.connectObject('hidden', () => {
            clearOverviewDockMargin(this);
            this._syncDashVisibility();

            if ((Settings.independentDock && Settings.showIndependentInOverview) && this._originalPosForOverview) {
                this.dockPosition = this._originalPosForOverview;
                this._originalPosForOverview = null;
                this._isOverviewActive = false;

                setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
                this._renderDock('full', true);
            }

            if (isActorAlive(this.actor)) {
                this.actor.remove_all_transitions();
                this._updateLayout();
                if (this.dockManager) this.dockManager.updatePosition();

                this.actor.opacity = 255;
                this.actor.show();
            }

            if (this.autoHideManager) {
                this.autoHideManager.checkVisibility();
            }
        }, this);

        if (Main.overview.visible) {
            this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._updateLayout();
                if (!Settings.independentDock && !Main.overview.animationInProgress) {
                    applyOverviewDockMargin(this);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _scheduleCursorResetBurst() {
        if (this._cursorResetTimeouts) {
            this._cursorResetTimeouts.forEach(id => this.registry.remove(id));
        }
        this._cursorResetTimeouts = [];

        CURSOR_BURST_DELAYS.forEach(delayMs => {
            const timeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._cursorResetTimeouts = this._cursorResetTimeouts.filter(id => id !== timeoutId);
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
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);

        if (this.appManager && this.appManager.appSystem) this.appManager.appSystem.disconnectObject(this);
        if (this.settings) this.settings.disconnectObject(this);
        if (this.volumeMonitor) this.volumeMonitor.disconnectObject(this);
        if (this._bgSettings) this._bgSettings.disconnectObject(this);
        if (this._iconThemeSettings) this._iconThemeSettings.disconnectObject(this);
        if (this._trashMonitor) {
            this._trashMonitor.disconnectObject(this);
            this._trashMonitor.cancel();
        }

        if (this.actor) this.actor.disconnectObject(this);
        DockUI._instances.delete(this);

        if (this.queueRender && this.queueRender.cancel) this.queueRender.cancel();

        if (this._cursorResetTimeouts) {
            this._cursorResetTimeouts.forEach(id => this.registry.remove(id));
        }

        if (this.registry) this.registry.destroy();
        if (this.autoHideManager) {
            this.autoHideManager.destroy();
            this.autoHideManager = null;
        }
        if (this.dockManager) this.dockManager.destroy();
        if (this.appGridUI) this.appGridUI.destroy();
        if (this.notificationManager) this.notificationManager.destroy();

        cleanupTrashEffects();
        teardownWindowEffects();
        teardownMagnification(this.actor);

        if (this._musicPill) {
            this._musicPill.destroy();
            this._musicPill = null;
        }

        if (this.appManager) {
            this.appManager.destroy();
            this.appManager = null;
        }

        if (this.folderManager) {
            this.folderManager.destroy();
            this.folderManager = null;
        }

        if (this._actorRegistry) this._actorRegistry.clear();
        if (this._separatorRegistry) this._separatorRegistry.clear();
        if (this._preRenderPositions) this._preRenderPositions.clear();

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
        }

        clearOverviewDockMargin(this);
    }
}