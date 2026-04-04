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


import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import DockUI from './src/ui/DockUI.js';
import QuickLaunchManager from './src/core/QuickLaunchManager.js';


export default class DhruvaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._docks = [];

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._reloadDocks();
        });

        this._settingsChangedId = this._settings.connect('changed::show-on-all-monitors', () => {
            this._reloadDocks();
        });

        this._reloadDocks();

        this._clearGnomeSwitchToApplicationShortcuts();

        this._quickLaunchManager = new QuickLaunchManager(
            this._settings,
            () => this._getQuickLaunchDock()
        );
    }

    _clearGnomeSwitchToApplicationShortcuts() {
        let shellKeys;
        
        try { shellKeys = new Gio.Settings({ schema_id: 'org.gnome.shell.keybindings' }); } catch (_e) { }

        if (shellKeys) {
            for (let i = 1; i <= 9; i++) {
                const key = `switch-to-application-${i}`;
                try {
                    if (shellKeys.is_writable(key)) shellKeys.set_strv(key, []);
                } catch (_e) { }
            }
        }
    }

    _reloadDocks() {
        const preferredPillMonitor = this._detectPreferredPillMonitor();
        const focusedMonitor = this._getFocusedMonitorIndex();
        const preferredMonitor = preferredPillMonitor ?? focusedMonitor;
        const preservedExternalActors = this._detachExternalActorsForReload();

        this._destroyDocks();

        const showOnAll = this._settings.get_boolean('show-on-all-monitors');

        if (showOnAll) {
            const numMonitors = global.display.get_n_monitors();
            let monitorOrder = Array.from({ length: numMonitors }, (_v, i) => i);

            if (preferredMonitor !== null && preferredMonitor >= 0 && preferredMonitor < numMonitors) {
                monitorOrder = [
                    preferredMonitor,
                    ...monitorOrder.filter(i => i !== preferredMonitor),
                ];
            }

            for (const i of monitorOrder) {
                const dock = new DockUI(this._settings, () => this.openPreferences(), this.uuid, i);
                dock.show();
                this._docks.push(dock);
            }

            if (preferredMonitor !== null && preferredMonitor >= 0 && preferredMonitor < numMonitors) {
                if (this._rebalanceIdleId) {
                    GLib.source_remove(this._rebalanceIdleId);
                    this._rebalanceIdleId = null;
                }
                this._rebalanceIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._rebalanceIdleId = null;
                    this._rebalanceExternalActorsToMonitor(preferredMonitor);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else {
            const dock = new DockUI(this._settings, () => this.openPreferences(), this.uuid, null);
            dock.show();
            this._docks.push(dock);
        }

        const targetDock = this._resolveExternalActorTargetDock(preferredMonitor, showOnAll);
        this._attachExternalActorsToDock(preservedExternalActors, targetDock);
    }

    _getFocusedMonitorIndex() {
        try {
            const focused = global.display.get_focus_window();
            if (focused) return focused.get_monitor();
        } catch (_e) { }
        return Main.layoutManager.primaryIndex ?? 0;
    }

    _getQuickLaunchDock() {
        if (!this._docks || this._docks.length === 0) return null;

        const focusedMonitor = this._getFocusedMonitorIndex();
        if (focusedMonitor !== null && focusedMonitor >= 0) {
            const focusedDock = this._docks.find(dock => {
                try {
                    return dock.monitorManager.getCurrentMonitor().index === focusedMonitor;
                } catch (_e) {
                    return false;
                }
            });
            if (focusedDock) return focusedDock;
        }

        let pointerMonitor = null;
        try {
            if (typeof global.display.get_current_monitor === 'function')
                pointerMonitor = global.display.get_current_monitor();
        } catch (_e) { }

        if (pointerMonitor !== null && pointerMonitor >= 0) {
            const pointerDock = this._docks.find(dock => {
                try {
                    return dock.monitorManager.getCurrentMonitor().index === pointerMonitor;
                } catch (_e) {
                    return false;
                }
            });
            if (pointerDock) return pointerDock;
        }

        return this._docks[0];
    }

    _getExternalActorsFromDock(dock) {
        const actors = [];
        const seen = new Set();
        const collect = (container) => {
            if (!container || typeof container.get_children !== 'function') return;
            container.get_children().forEach(child => {
                if (!child || !child._isExternal || seen.has(child)) return;
                seen.add(child);
                actors.push(child);
            });
        };

        collect(dock?.boxActor);
        collect(dock?._safeHouse);
        return actors;
    }

    _detachExternalActorsForReload() {
        if (!this._docks || this._docks.length === 0) return [];

        const actors = [];
        const seen = new Set();

        this._docks.forEach(dock => {
            this._getExternalActorsFromDock(dock).forEach(actor => {
                if (!actor || seen.has(actor)) return;
                seen.add(actor);

                try {
                    if (actor.get_parent()) actor.get_parent().remove_child(actor);
                } catch (_e) { }

                actor._isExternal = true;
                actor._signalAttached = false;
                actor._lastKnownWidth = -1;
                actor._dhruvaPrevVisibleState = undefined;
                actors.push(actor);
            });
        });

        return actors;
    }

    _resolveExternalActorTargetDock(preferredMonitor, showOnAll) {
        if (!this._docks || this._docks.length === 0) return null;
        if (!showOnAll) return this._docks[0];

        if (preferredMonitor === null || preferredMonitor < 0) return this._docks[0];

        const preferredDock = this._docks.find(dock => {
            try {
                return dock.monitorManager.getCurrentMonitor().index === preferredMonitor;
            } catch (_e) {
                return false;
            }
        });

        return preferredDock || this._docks[0];
    }

    _attachExternalActorsToDock(actors, targetDock) {
        if (!actors || actors.length === 0 || !targetDock || !targetDock.boxActor) return;

        actors.forEach(actor => {
            try {
                if (actor.get_parent()) actor.get_parent().remove_child(actor);
            } catch (_e) { }

            actor._isExternal = true;
            actor._signalAttached = false;
            actor._lastKnownWidth = -1;
            actor._dhruvaPrevVisibleState = undefined;

            try {
                if (typeof actor.remove_all_transitions === 'function')
                    actor.remove_all_transitions();
                actor.opacity = 255;
                actor.scale_x = 1.0;
                actor.scale_y = 1.0;
                actor.translation_x = 0;
                actor.translation_y = 0;
            } catch (_e) { }

            try { targetDock.boxActor.add_child(actor); } catch (_e) { }
            if (typeof targetDock.onMusicPillInjected === 'function')
                targetDock.onMusicPillInjected(actor);
        });

        if (typeof targetDock.queueRender === 'function') targetDock.queueRender();
    }

    _detectPreferredPillMonitor() {
        if (!this._docks || this._docks.length === 0) return null;

        for (const dock of this._docks) {
            const externals = this._getExternalActorsFromDock(dock);
            for (const actor of externals) {
                try {
                    const monitor = Main.layoutManager.findMonitorForActor(actor);
                    if (monitor && typeof monitor.index === 'number') {
                        return monitor.index;
                    }
                } catch (_e) { }
            }
        }
        return null;
    }

    _rebalanceExternalActorsToMonitor(monitorIndex) {
        if (!this._docks || this._docks.length <= 1) return;

        const targetDock = this._docks.find(d => {
            try {
                return d.monitorManager.getCurrentMonitor().index === monitorIndex;
            } catch (_e) {
                return false;
            }
        });

        if (!targetDock || !targetDock.boxActor) return;

        this._docks.forEach(dock => {
            if (!dock || dock === targetDock) return;

            const externals = this._getExternalActorsFromDock(dock);
            externals.forEach(actor => {
                try {
                    if (actor.get_parent()) actor.get_parent().remove_child(actor);
                } catch (_e) { }

                actor._isExternal = true;
                try { targetDock.boxActor.add_child(actor); } catch (_e) { }
                if (typeof targetDock.onMusicPillInjected === 'function') {
                    targetDock.onMusicPillInjected(actor);
                }
            });

            if (typeof dock.queueRender === 'function') dock.queueRender();
        });

        if (typeof targetDock.queueRender === 'function') targetDock.queueRender();
    }

    _destroyDocks() {
        if (this._rebalanceIdleId) {
            GLib.source_remove(this._rebalanceIdleId);
            this._rebalanceIdleId = null;
        }

        if (this._docks && this._docks.length > 0) {
            this._docks.forEach(dock => {
                if (dock && typeof dock.destroy === 'function') {
                    dock.destroy();
                }
            });
            this._docks = [];
        }
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._quickLaunchManager) {
            this._quickLaunchManager.destroy();
            this._quickLaunchManager = null;
        }

        this._destroyDocks();
        this._settings = null;
    }
}
