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
import ScrollManager from '../../core/ScrollManager.js';
import FolderManager from '../../core/FolderManager.js';
import MonitorManager from '../../core/MonitorManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { debounce, setBoxVertical } from '../../core/Utils.js';
import { cleanupTrashEffects } from '../effects/TrashEffect.js';
import { teardownMagnification } from '../magnifier/Magnifier.js';
import NotificationManager from '../../core/NotificationManager.js';
import AutoHideManager from '../../core/autohide/AutoHideManager.js';
import { applyOverviewDockMargin, clearOverviewDockMargin } from './OverviewMargin.js';
import { setupWindowEffects, teardownWindowEffects, animateLaunch } from '../effects/WindowEffects.js';
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
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.dockPosition = this.settings.get_string('dock-position') || 'BOTTOM';

        this.registry = new TimeoutTracker();
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
        this._captureActorRect = (actor, fb) => captureActorRect(actor, fb);
        this.isActorAlive = isActorAlive;

        this.queueRender = debounce((force) => {
            if (this._renderDock) {
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

        setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
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
                if (this.actor && this.actor.is_mapped()) {
                    this._updateLayout();

                    const isIndep = this.settings.get_boolean('independent-dock');
                    if (Main.overview.dash && !isIndep) {
                        const pos = this.dockPosition;
                        if (pos === 'BOTTOM' || pos === 'TOP') {
                            const margin = this.settings.get_int('dock-margin') || 0;
                            const extra = 95;
                            Main.overview.dash.set_height(this.actor.height + margin + extra);
                            Main.overview.dash.set_width(-1);
                        } else {
                            Main.overview.dash.set_height(-1);
                            Main.overview.dash.set_width(-1);
                        }
                    } else if (Main.overview.dash && isIndep) {
                        Main.overview.dash.set_height(-1);
                        Main.overview.dash.set_width(-1);
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        this.appManager.appSystem.connectObject('installed-changed', () => this.queueRender(), this);
        this.appManager.appSystem.connectObject('app-state-changed', () => this.queueRender(), this);

        global.window_manager.connectObject('destroy', () => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender();
        }, this);

        global.window_manager.connectObject('map', (_wm, actor) => {
            if (this.actor) {
                this.actor._lastIconClickTime = 0;
                this.actor._fixedSlots = null;
                this.actor._tooltipHoveredIndex = -1;
                this.actor._magTooltipAppId = null;
            }
            this.queueRender();

            if (this.settings.get_boolean('isolate-monitors')) {
                if (this._isolateMonitorRenderDelayId) {
                    this.registry.remove(this._isolateMonitorRenderDelayId);
                }
                this._isolateMonitorRenderDelayId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._isolateMonitorRenderDelayId = null;
                    this.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
            }

            if (!this._pendingLaunches || this._pendingLaunches.length === 0) return;
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
                if (this.settings.get_boolean('isolate-monitors')) {
                    const targetMonitor = this.monitorManager.getCurrentMonitor().index;
                    if (win.get_monitor() !== targetMonitor) win.move_to_monitor(targetMonitor);
                }

                const iconRect = pending.iconRect || this._captureActorRect(pending.btn, win);
                try {
                    animateLaunch(win, pending.btn, this.dockPosition, iconRect);
                } catch (e) {
                    if (this.isActorAlive(actor)) actor.opacity = 255;
                }
            }
        }, this);

        global.display.connectObject('notify::focus-window', () => {
            const recentClick = this.actor._lastIconClickTime && (Date.now() - this.actor._lastIconClickTime < 1000);
            if (!this.actor._launchingApp && !recentClick) this.queueRender();
        }, this);

        global.display.connectObject('window-entered-monitor', () => {
            if (this.settings.get_boolean('isolate-monitors')) this.queueRender();
        }, this);

        global.display.connectObject('window-left-monitor', () => {
            if (this.settings.get_boolean('isolate-monitors')) this.queueRender();
        }, this);

        global.workspace_manager.connectObject('active-workspace-changed', () => {
            if (this.settings.get_boolean('isolate-workspaces')) {
                this.actor._lastIconClickTime = 0;
                this.queueRender();
            }
        }, this);

        WATCHED_SETTINGS.forEach(key => {
            this.settings.connectObject(`changed::${key}`, () => {
                this.queueRender();
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
                this._renderDock();
                if (key === 'full-width') this._updateStruts();
            }, this);
        });

        this.settings.connectObject('changed::hide-mode', () => {
            this._updateStruts();
        }, this);

        this.settings.connectObject('changed::dock-position', () => {
            const newPos = this.settings.get_string('dock-position');
            const isNewVertical = newPos === 'LEFT' || newPos === 'RIGHT';

            this.dockPosition = newPos;
            setBoxVertical(this.boxActor, isNewVertical);
            this.queueRender();

            this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._updateLayout();
                if (this.dockManager) this.dockManager.updatePosition();
                if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        this.settings.connectObject('changed::dock-margin', () => {
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            this._updateStruts();
        }, this);

        this.settings.connectObject('changed::preferred-monitor', () => {
            this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
            this._updateStruts();
            this.queueRender();
        }, this);

        this.volumeMonitor = Gio.VolumeMonitor.get();
        this.volumeMonitor.connectObject('mount-added', () => this.queueRender(), this);
        this.volumeMonitor.connectObject('mount-removed', () => this.queueRender(), this);

        this._setupChameleonWatcher();
        this._setupTrashMonitor();
    }

    _setupTrashMonitor() {
        const trashDir = Gio.File.new_for_uri('trash:///');
        this._trashMonitor = trashDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._trashMonitor.connectObject('changed', () => {
            if (this._trashRefreshId) return;
            this._trashRefreshId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                this._trashRefreshId = null;
                this.queueRender();
                return GLib.SOURCE_REMOVE;
            });
        }, this);
    }

    _setupChameleonWatcher() {
        this._bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
        const onWallpaperChange = () => {
            this._chameleonColor = null;
            this._chameleonAccent = null;
            if (this.settings.get_string('dock-theme') === 'chameleon') {
                this._applyDynamicStyles();
                this.queueRender();
            }
        };
        this._bgSettings.connectObject('changed::picture-uri', onWallpaperChange, this);
        this._bgSettings.connectObject('changed::picture-uri-dark', onWallpaperChange, this);
    }

    _updateStruts() {
        if (!this.actor) return;
        const hideMode = this.settings.get_string('hide-mode');
        const shouldAffectStruts = (hideMode === 'none');

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

        if (this.dockManager) {
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
        const hideMode = this.settings.get_string('hide-mode');
        const shouldAffectStruts = (hideMode === 'none');
        this.actor._affectsStruts = shouldAffectStruts;

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: shouldAffectStruts,
            trackFullscreen: true
        });

        this.actor.connectObject('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            this._renderDock();
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
        }, this);

        global.display.connectObject('workareas-changed', () => {
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager.updateTriggerGeometry();
        }, this);

        setupWindowEffects(this.settings, this);
        this.autoHideManager = new AutoHideManager(this, this.settings);

        if (this.settings.get_boolean('independent-dock')) {
            if (Main.overview.dash) Main.overview.dash.show();
        } else {
            if (Main.overview.dash) Main.overview.dash.hide();
        }

        Main.overview.connectObject('showing', () => {
            const isIndependent = this.settings.get_boolean('independent-dock');
            const showInOverview = this.settings.get_boolean('show-independent-in-overview');

            if (isIndependent) {
                if (showInOverview) {
                    if (this.dockPosition !== 'LEFT') {
                        this._originalPosForOverview = this.dockPosition;
                        this.dockPosition = 'LEFT';
                        setBoxVertical(this.boxActor, true);

                        this._isOverviewActive = true;
                        this._renderDock(true);

                        this._updateLayout();
                        if (this.dockManager) this.dockManager.updatePosition();
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

                if (Main.overview.dash) {
                    Main.overview.dash.show();
                    Main.overview.dash.set_pivot_point(0.5, 0.5);
                    Main.overview.dash.ease({
                        scale_x: 0.85,
                        scale_y: 0.85,
                        duration: 250,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
            } else {
                if (this.isActorAlive(this.actor)) {
                    this.actor.show();
                    this.actor.opacity = 255;
                }
                if (this.autoHideManager) this.autoHideManager.show();
            }

            if (!isIndependent || showInOverview) {
                this._updateLayout();
            }
        }, this);

        Main.overview.connectObject('hiding', () => {
            const isIndependent = this.settings.get_boolean('independent-dock');
            const showInOverview = this.settings.get_boolean('show-independent-in-overview');

            if (isIndependent && showInOverview && this._originalPosForOverview) {
                this.dockPosition = this._originalPosForOverview;
                setBoxVertical(this.boxActor, this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');

                this._isOverviewActive = false;
                this._renderDock(true);

                this._updateLayout();
                if (this.dockManager) this.dockManager.updatePosition();
                this._originalPosForOverview = null;
            }

            if (isIndependent && Main.overview.dash) {
                Main.overview.dash.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            }

            if (this.autoHideManager) {
                this.autoHideManager.checkVisibility();
            }
        }, this);

        Main.overview.connectObject('hidden', async () => {
            clearOverviewDockMargin(this);

            const isIndependent = this.settings.get_boolean('independent-dock');
            const showInOverview = this.settings.get_boolean('show-independent-in-overview');

            if (isIndependent && showInOverview) {
                const tmpPath = GLib.get_tmp_dir() + '/dhruva_dock_pos.txt';
                const file = Gio.File.new_for_path(tmpPath);

                if (file.query_exists(null)) {
                    try {
                        const result = await new Promise((resolve, reject) => {
                            file.load_contents_async(null, (f, res) => {
                                try { resolve(f.load_contents_finish(res)); }
                                catch (e) { reject(e); }
                            });
                        });

                        const contents = result[1];
                        if (contents) {
                            const posStr = new TextDecoder('utf-8').decode(contents).trim();
                            this.settings.set_string('dock-position', posStr);
                        }

                        file.delete_async(GLib.PRIORITY_DEFAULT, null, () => { });
                    } catch (e) {
                        console.error("[Dhruva] Async Read Error:", e);
                    }
                }

                this._updateStruts();

                if (this.isActorAlive(this.actor)) {
                    this.actor.remove_all_transitions();
                    this.actor.show();
                    this.actor.ease({
                        opacity: 255,
                        duration: 250,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD
                    });
                }
            }
        }, this);

        if (Main.overview.visible) {
            this.registry.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._updateLayout();
                if (!this.settings.get_boolean('independent-dock') && !Main.overview.animationInProgress) {
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

        [50, 150, 300, 600, 1000, 1500, 2000].forEach(delayMs => {
            const timeoutId = this.registry.addTimeout(GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._cursorResetTimeouts = this._cursorResetTimeouts.filter(id => id !== timeoutId);

                const tracker = Shell.WindowTracker.get_default();

                if (tracker.get_startup_sequences) {
                    const sequences = tracker.get_startup_sequences();
                    if (sequences && sequences.length > 0) {
                        for (let i = 0; i < sequences.length; i++) {
                            if (sequences[i].complete) {
                                sequences[i].complete();
                            }
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
            this._renderDock();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        if (this.appManager && this.appManager.appSystem) this.appManager.appSystem.disconnectObject(this);
        if (this.settings) this.settings.disconnectObject(this);
        if (this.volumeMonitor) this.volumeMonitor.disconnectObject(this);
        if (this._bgSettings) this._bgSettings.disconnectObject(this);
        if (this._trashMonitor) {
            this._trashMonitor.disconnectObject(this);
            this._trashMonitor.cancel();
        }

        if (this.actor) {
            this.actor.disconnectObject(this);
        }

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

        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
        }

        clearOverviewDockMargin(this);
    }
}