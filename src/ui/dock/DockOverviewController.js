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


import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Settings } from '../../core/SettingsManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { setBoxVertical, isActorAlive } from '../../core/Utils.js';
import { applyOverviewDockMargin, clearOverviewDockMargin } from './OverviewMargin.js';


const OVERVIEW_FADE_OUT_MS = 120;
const OVERVIEW_FADE_IN_MS = 180;
const STRUT_SETTLE_MS = 60;
const FALLBACK_DOCK_HEIGHT = 400;

function getStateAdjustment() {
    const controls = Main.overview._overview && Main.overview._overview._controls;
    return controls ? controls._stateAdjustment : null;
}

function isOverviewOpen() {
    return Main.overview.visible || Main.overview.visibleTarget;
}

export default class DockOverviewController {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.timers = new TimeoutTracker();
        this.isActive = false;
        this.originalPosition = null;
        this._strutHolder = null;
        this._strutRestoreId = 0;
        this._visibleIdleId = 0;
    }

    get isRelocated() {
        return Boolean(this.originalPosition);
    }

    hidesGnomeDash() {
        return !Settings.independentDock || Settings.hybridPanelMode;
    }

    _showsInOverview() {
        return Settings.independentDock && Settings.showIndependentInOverview && !Settings.hybridPanelMode;
    }

    syncDashVisibility() {
        const dash = Main.overview.dash;
        if (!dash) return;

        if (this.hidesGnomeDash()) {
            dash.opacity = 0;
            dash.reactive = false;
        } else {
            dash.show();
            dash.opacity = 255;
            dash.reactive = true;
        }
    }

    bind() {
        this.syncDashVisibility();

        Main.overview.connectObject(
            'showing', () => this._onShowing(),
            'shown', () => this._onShown(),
            'hiding', () => this._onHiding(),
            'hidden', () => this._onHidden(),
            this
        );

        const adjustment = getStateAdjustment();
        if (adjustment) adjustment.connectObject('notify::value', () => this._onStateChanged(), this);

        if (!Main.overview.visible) return;

        this.timers.remove(this._visibleIdleId);
        this._visibleIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._visibleIdleId = 0;
            this.dockUI._updateLayout();
            if (this.hidesGnomeDash() && !Main.overview.animationInProgress) {
                applyOverviewDockMargin(this.dockUI);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    syncPlacement() {
        if (this.isActive && this.dockUI.dockPosition === 'LEFT') this.applyLeftPosition();
        else if (isOverviewOpen()) applyOverviewDockMargin(this.dockUI);
    }

    applyLeftPosition() {
        const actor = this.dockUI.actor;
        if (!isActorAlive(actor)) return;

        const monResult = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monResult || !monResult.monitor) return;
        const mon = monResult.monitor;

        const dockH = actor.height || FALLBACK_DOCK_HEIGHT;
        const targetX = mon.x + Settings.dockMargin;
        const targetY = mon.y + Math.max(0, Math.floor((mon.height - dockH) / 2));

        actor.translation_x = 0;
        actor.translation_y = 0;
        actor.set_position(targetX, targetY);

        const parent = actor.get_parent();
        if (parent) parent.set_child_above_sibling(actor, null);
    }

    _onShowing() {
        const dockUI = this.dockUI;
        const actor = dockUI.actor;

        if (isActorAlive(actor)) {
            actor.remove_all_transitions();
            actor.translation_x = 0;
            actor.translation_y = 0;
        }

        if (this.hidesGnomeDash()) {
            if (Main.overview.dash) Main.overview.dash.opacity = 0;
            if (isActorAlive(actor)) {
                actor.show();
                actor.opacity = 255;
            }
            if (dockUI.autoHideManager) dockUI.autoHideManager.show();
            dockUI._updateLayout();
            applyOverviewDockMargin(dockUI);
            return;
        }

        if (Main.overview.dash) {
            Main.overview.dash.show();
            Main.overview.dash.opacity = 255;
        }

        if (!this._showsInOverview()) {
            if (isActorAlive(actor)) {
                actor.opacity = 0;
                actor.hide();
            }
            return;
        }

        if (!this.originalPosition) this.originalPosition = Settings.dockPosition || dockUI.dockPosition;

        if (this.isActive) {
            actor.ease({ opacity: 255, duration: OVERVIEW_FADE_IN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } else {
            this._holdStruts();
            this._fadeOut();
        }
    }

    _onShown() {
        if (this.originalPosition && !this.isActive) {
            if (isActorAlive(this.dockUI.actor)) this._enterPosition();
        } else if (this.hidesGnomeDash()) {
            applyOverviewDockMargin(this.dockUI);
        }
    }

    _onStateChanged() {
        if (!isOverviewOpen()) return;

        if (this._showsInOverview() && this.isActive) this.applyLeftPosition();
        else if (this.hidesGnomeDash()) applyOverviewDockMargin(this.dockUI);
    }

    _onHiding() {
        const actor = this.dockUI.actor;
        if (this.originalPosition) {
            if (isActorAlive(actor)) this._fadeOut();
        } else if (!this.hidesGnomeDash() && isActorAlive(actor)) {
            actor.opacity = 0;
        }
    }

    _onHidden() {
        const dockUI = this.dockUI;
        const actor = dockUI.actor;

        if (this.hidesGnomeDash()) clearOverviewDockMargin();
        this.syncDashVisibility();

        if (isActorAlive(actor)) {
            actor.remove_all_transitions();
            this._leavePosition();
            actor.show();
        }

        if (dockUI.autoHideManager) dockUI.autoHideManager.checkVisibility();
        this._queueStrutRestore();
    }

    _enterPosition() {
        const dockUI = this.dockUI;
        const actor = dockUI.actor;

        this.isActive = true;
        dockUI.updateStruts();
        dockUI.dockPosition = 'LEFT';
        setBoxVertical(dockUI.boxActor, true);

        actor.remove_all_transitions();
        actor.opacity = 0;
        actor.show();

        dockUI._renderDock('full', true);
        dockUI._updateLayout();
        this.applyLeftPosition();

        actor.ease({
            opacity: 255,
            duration: OVERVIEW_FADE_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _fadeOut() {
        const actor = this.dockUI.actor;
        actor.remove_all_transitions();
        actor.ease({
            opacity: 0,
            duration: OVERVIEW_FADE_OUT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _leavePosition() {
        const dockUI = this.dockUI;
        const wasMoved = this.isRelocated;

        if (wasMoved) {
            dockUI.dockPosition = this.originalPosition;
            this.originalPosition = null;
            this.isActive = false;
            setBoxVertical(dockUI.boxActor, dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT');
            dockUI._renderDock('full', true);
        }

        dockUI._updateLayout();
        if (dockUI.dockManager) dockUI.dockManager.updatePosition();
        if (wasMoved && dockUI.autoHideManager) dockUI.autoHideManager.forceHideImmediately();
    }

    _holdStruts() {
        this.timers.remove(this._strutRestoreId);
        this._strutRestoreId = 0;

        const actor = this.dockUI.actor;
        if (!actor._affectsStruts || this._strutHolder) return;

        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        this._strutHolder = new Clutter.Actor({ reactive: false, x, y, width, height });
        Main.layoutManager.addChrome(this._strutHolder, { affectsStruts: true });
    }

    _queueStrutRestore() {
        if (!this._strutHolder || this._strutRestoreId) return;

        this._strutRestoreId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, Settings.autohideAnimationSpeed + STRUT_SETTLE_MS, () => {
            this._strutRestoreId = 0;
            this.dockUI.updateStruts();
            this._releaseStrutHolder();
            return GLib.SOURCE_REMOVE;
        });
    }

    _releaseStrutHolder() {
        if (!this._strutHolder) return;
        Main.layoutManager.removeChrome(this._strutHolder);
        this._strutHolder.destroy();
        this._strutHolder = null;
    }

    destroy() {
        Main.overview.disconnectObject(this);
        const adjustment = getStateAdjustment();
        if (adjustment) adjustment.disconnectObject(this);

        this.timers.destroy();
        this._releaseStrutHolder();
        clearOverviewDockMargin();
        this.dockUI = null;
    }
}