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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import ClockBox from './panel/ClockBox.js';
import TrayManager from './panel/TrayManager.js';
import TopBarManager from './panel/TopBarManager.js';
import DateMenuManager from './panel/DateMenuManager.js';
import { isActorAlive, setBoxVertical } from './Utils.js';
import QuickSettingsManager from './panel/QuickSettingsManager.js';
import ExtensionAppletsManager from './panel/ExtensionAppletsManager.js';
import NotificationBannerManager from './panel/NotificationBannerManager.js';
import { NativeActorState, panelItemMetrics } from './panel/NativeActorState.js';


const PANEL_RESIZE_THRESHOLD_PX = 2;

export default class PanelIntegrator {
    constructor(dockUI, isPanelHost = true) {
        this.dockUI = dockUI;
        this.isPanelHost = isPanelHost;

        this.leftContainer = new St.BoxLayout({
            name: 'DhruvaHybridLeftPanel',
            reactive: true,
            track_hover: false,
            style_class: 'dhruva-hybrid-panel-box',
            clip_to_allocation: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
        });
        this.leftContainer._isStatic = true;
        this.leftContainer._isPanelBox = true;

        this.container = new St.BoxLayout({
            name: 'DhruvaHybridRightPanel',
            reactive: true,
            track_hover: false,
            style_class: 'dhruva-hybrid-panel-box',
            clip_to_allocation: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.container._isStatic = true;
        this.container._isPanelBox = true;

        this._isIntegrated = false;
        this._alignState = new NativeActorState();
        this._secondaryClockBtn = null;
        this._secondaryClockSettings = null;

        if (this.isPanelHost) {
            this.topBar = new TopBarManager();
            this.dateMenu = new DateMenuManager(this.dockUI);
            this.quickSettings = new QuickSettingsManager(this.dockUI);
            this.trayManager = new TrayManager(this.dockUI.settings, () => this.refreshApplets());
            this.extensionApplets = new ExtensionAppletsManager(this, this.trayManager);
            this.notifications = new NotificationBannerManager(this.dockUI);
        }

        this._syncOrientation();
    }

    _isVertical() {
        return this.dockUI.dockPosition === 'LEFT' || this.dockUI.dockPosition === 'RIGHT';
    }

    hasOpenPopupOrDrag() {
        if (!this._isIntegrated) return false;

        if (Main.panel && Main.panel.menuManager && Main.panel.menuManager.activeMenu) {
            return true;
        }

        if (Main.panel && Main.panel.statusArea) {
            for (const indicator of Object.values(Main.panel.statusArea)) {
                if (indicator && indicator.menu && indicator.menu.isOpen) {
                    return true;
                }
            }
        }

        if (this.isPanelHost && this.extensionApplets) {
            if (this.extensionApplets._isTrayOpen || this.extensionApplets._trayMenu) {
                return true;
            }
            if (this.extensionApplets._reorder && this.extensionApplets._reorder._drag) {
                return true;
            }
        }

        return false;
    }

    _syncOrientation() {
        const isVertical = this._isVertical();
        setBoxVertical(this.leftContainer, isVertical);
        setBoxVertical(this.container, isVertical);
        if (this.extensionApplets) {
            this.extensionApplets.syncOrientation(isVertical);
        }
    }

    _buildWorkspacePills() {
        if (this._overviewBtn && isActorAlive(this._overviewBtn)) {
            this._updateWorkspacePills();
            return this._overviewBtn;
        }

        this._workspaceIndicator = new St.BoxLayout({
            style_class: 'dhruva-workspace-indicator',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });
        setBoxVertical(this._workspaceIndicator, this._isVertical());

        const { height, radius } = panelItemMetrics();
        const btn = new St.Button({
            child: this._workspaceIndicator,
            style_class: 'panel-button',
            can_focus: false,
            track_hover: true,
            style: `min-height: ${height}px; padding: 0 10px; border-radius: ${radius}px;`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        btn.connectObject('clicked', () => Main.overview.toggle(), this);

        this._overviewBtn = btn;
        this._updateWorkspacePills();
        return btn;
    }

    _buildSecondaryClock() {
        const { height, radius } = panelItemMetrics();
        this._secondaryClockSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        const isVertical = this._isVertical();
        this._secondaryClock = new ClockBox(this._secondaryClockSettings, this.dockUI.settings, isVertical);
        const update = () => this._secondaryClock.update();

        const dateMenu = Main.panel.statusArea.dateMenu;
        if (dateMenu) dateMenu._clock.connectObject('notify::clock', update, this);
        this._secondaryClockSettings.connectObject(
            'changed::clock-show-seconds', update,
            'changed::clock-show-date', update,
            'changed::clock-format', update,
            this
        );
        this.dockUI.settings.connectObject('changed::panel-date-format', update, this);
        update();

        const btn = new St.Button({
            child: this._secondaryClock.actor,
            style_class: 'panel-button',
            reactive: true,
            can_focus: false,
            track_hover: true,
            style: isVertical
                ? `min-width: ${height}px; padding: 6px 4px; border-radius: ${radius}px;`
                : `min-height: ${height}px; padding: 0 8px; border-radius: ${radius}px;`,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.connectObject('clicked', () => {
            const dm = Main.panel.statusArea.dateMenu;
            if (dm) dm.menu.toggle();
        }, this);

        this._secondaryClockBtn = btn;
        return btn;
    }

    _teardownSecondaryClock() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (dateMenu) dateMenu._clock.disconnectObject(this);
        if (this._secondaryClockSettings) {
            this._secondaryClockSettings.disconnectObject(this);
            this._secondaryClockSettings = null;
            this.dockUI.settings.disconnectObject(this);
        }
        if (this._secondaryClock) {
            this._secondaryClock.destroy();
            this._secondaryClock = null;
        }
        if (isActorAlive(this._secondaryClockBtn)) {
            this._secondaryClockBtn.disconnectObject(this);
            this._secondaryClockBtn.destroy();
        }
        this._secondaryClockBtn = null;
    }

    _updateWorkspacePills() {
        if (!this._workspaceIndicator || !isActorAlive(this._workspaceIndicator)) return;

        this._workspaceIndicator.destroy_all_children();
        const activeIndex = global.workspace_manager.get_active_workspace_index();
        const total = global.workspace_manager.get_n_workspaces();

        const isVertical = this._isVertical();
        setBoxVertical(this._workspaceIndicator, isVertical);

        for (let i = 0; i < total; i++) {
            let classes = 'dhruva-workspace-dot';
            if (isVertical) classes += ' vertical';
            if (i === activeIndex) classes += ' active';

            this._workspaceIndicator.add_child(new St.Widget({
                style_class: classes,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }

    _connectWorkspaceSignals() {
        const update = () => this._updateWorkspacePills();
        global.workspace_manager.connectObject(
            'active-workspace-changed', update,
            'notify::n-workspaces', update,
            this
        );
    }

    _disconnectWorkspaceSignals() {
        global.workspace_manager.disconnectObject(this);
    }

    alignItems() {
        if (!this.container || !isActorAlive(this.container)) return;
        const isVertical = this._isVertical();

        const center = (actor, depth = 0) => {
            if (!isActorAlive(actor)) return;

            const crossAxis = isVertical
                ? { x_align: Clutter.ActorAlign.CENTER, x_expand: false }
                : { y_align: Clutter.ActorAlign.CENTER, y_expand: false };
            this._alignState.set(actor, { ...crossAxis, translation_x: 0, translation_y: 0 });

            if (depth < 2 && actor.get_child) {
                center(actor.get_child(), depth + 1);
            }
            if (actor._isAppletZone) {
                actor.get_children().forEach(c => center(c, 1));
            }
        };

        this.container.get_children().forEach(c => center(c));
        if (this.leftContainer && isActorAlive(this.leftContainer)) {
            this.leftContainer.get_children().forEach(c => center(c));
        }
    }

    integrate() {
        if (this._isIntegrated || !Main.panel) return;
        this._syncOrientation();

        this.leftContainer.destroy_all_children();
        this.leftContainer.add_child(this._buildWorkspacePills());
        this._connectWorkspaceSignals();

        this.container.destroy_all_children();

        if (this.isPanelHost) {
            const dockPos = this.dockUI.dockPosition || 'BOTTOM';
            let targetSide = St.Side.BOTTOM;
            if (dockPos === 'TOP') targetSide = St.Side.TOP;
            else if (dockPos === 'LEFT') targetSide = St.Side.LEFT;
            else if (dockPos === 'RIGHT') targetSide = St.Side.RIGHT;

            const isVertical = this._isVertical();

            const trayBox = this.extensionApplets.createBox(isVertical);
            if (trayBox) {
                const trayParent = trayBox.get_parent();
                if (trayParent !== this.container) {
                    if (trayParent) trayParent.remove_child(trayBox);
                    this.container.add_child(trayBox);
                }
                this.leftContainer.add_child(this.extensionApplets.leftBox);
            }

            const qsActor = this.quickSettings.steal(targetSide, isVertical);
            if (qsActor) this.container.add_child(qsActor);

            const dateActor = this.dateMenu.steal(targetSide, isVertical);
            if (dateActor) this.container.add_child(dateActor);
            this.notifications.enable(dateActor || this.container);

            this.topBar.hide();
        } else {
            this.container.add_child(this._buildSecondaryClock());
        }

        this.leftContainer.opacity = 0;
        this.leftContainer.show();
        this.leftContainer.visible = true;

        this.container.opacity = 0;
        this.container.show();
        this.container.visible = true;

        this._watchBoxSize(this.container);
        this._watchBoxSize(this.leftContainer);

        this._isIntegrated = true;
        this.alignItems();
        this.dockUI._updateLayout();

        this.leftContainer.opacity = 255;
        this.container.opacity = 255;
    }

    refreshApplets() {
        if (!this._isIntegrated || !this.isPanelHost) return;
        this._alignState.restore();
        this.extensionApplets.refresh();
        this.alignItems();
        this.dockUI._updateLayout();
    }

    _watchBoxSize(box) {
        let lastSize = -1;
        box.connectObject('notify::allocation', () => {
            const size = Math.round(this._isVertical() ? box.height : box.width);
            if (size <= 0 || Math.abs(size - lastSize) < PANEL_RESIZE_THRESHOLD_PX) return;
            lastSize = size;
            this.dockUI.syncPanelSpace();
        }, this);
    }

    restore() {
        if (this._isIntegrated) {
            this._disconnectWorkspaceSignals();
            this.container.disconnectObject(this);
            this.leftContainer.disconnectObject(this);
            if (isActorAlive(this._overviewBtn)) {
                this._overviewBtn.disconnectObject(this);
            }

            this._alignState.restore();
            if (this.notifications) this.notifications.restore();
            if (this.dateMenu) this.dateMenu.restore();
            if (this.quickSettings) this.quickSettings.restore();
            if (this.extensionApplets) this.extensionApplets.restore();
            if (this.topBar) this.topBar.restore();
            this._teardownSecondaryClock();

            this.leftContainer.destroy_all_children();
            this.container.destroy_all_children();
            this._overviewBtn = null;
            this._workspaceIndicator = null;

            this._isIntegrated = false;
        }
    }

    destroy() {
        this.restore();

        if (this.notifications) {
            this.notifications.destroy();
            this.notifications = null;
        }
        if (this.dateMenu) {
            this.dateMenu.destroy();
            this.dateMenu = null;
        }
        if (this.quickSettings) {
            this.quickSettings.destroy();
            this.quickSettings = null;
        }
        if (this.extensionApplets) {
            this.extensionApplets.destroy();
            this.extensionApplets = null;
        }
        if (this.trayManager) {
            if (this.trayManager.destroy) this.trayManager.destroy();
            this.trayManager = null;
        }
        if (this.topBar) {
            this.topBar.destroy();
            this.topBar = null;
        }

        if (isActorAlive(this.leftContainer)) this.leftContainer.destroy();
        if (isActorAlive(this.container)) this.container.destroy();
        this.leftContainer = null;
        this.container = null;

        this.dockUI = null;
    }
}