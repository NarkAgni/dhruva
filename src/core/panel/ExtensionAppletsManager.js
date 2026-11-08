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
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import TrayMenu from './TrayMenu.js';
import AppletReorder from './AppletReorder.js';
import { TimeoutTracker } from '../TimeoutTracker.js';
import { HYBRID_PANEL_CONFIG } from '../PanelConfig.js';
import { isActorAlive, setBoxVertical } from '../Utils.js';
import { hookPopupGap, unhookPopupGap } from './PopupGap.js';
import { CHILD_ADDED_SIGNAL, CHILD_REMOVED_SIGNAL, getPanelBoxes, getPanelLeftBox } from '../Compat.js';
import { NativeActorState, panelItemMetrics, stylePanelItem } from './NativeActorState.js';


const CFG = HYBRID_PANEL_CONFIG;
const RESYNC_SETTLE_MS = 120;
const ORDER_KEY = 'panel-applet-order';

const TRAY_ARROW_ICONS = {
    BOTTOM: ['pan-up-symbolic', 'pan-down-symbolic'],
    TOP: ['pan-down-symbolic', 'pan-up-symbolic'],
    LEFT: ['pan-end-symbolic', 'pan-start-symbolic'],
    RIGHT: ['pan-start-symbolic', 'pan-end-symbolic'],
};

const ARROW_SIDES = {
    BOTTOM: St.Side.BOTTOM,
    TOP: St.Side.TOP,
    LEFT: St.Side.LEFT,
    RIGHT: St.Side.RIGHT,
};

export default class ExtensionAppletsManager {
    constructor(panelIntegrator, trayManager) {
        this.panelIntegrator = panelIntegrator;
        this.trayManager = trayManager;
        this.dockUI = panelIntegrator.dockUI;
        this.timers = new TimeoutTracker();

        this.box = null;
        this.leftBox = null;
        this._reorder = new AppletReorder(() => this._saveOrder(), this.dockUI);
        this._state = new NativeActorState();
        this._applets = [];
        this._trayMenu = null;
        this._isTrayOpen = false;
        this._resyncId = 0;
        this._snapshot = [];
        this._watchedIndicators = new Set();

        Main.extensionManager.connectObject('extension-state-changed', () => this._queueResync(), this);
    }

    createBox(isVertical) {
        if (isActorAlive(this.box)) return this.box;

        this.box = new St.BoxLayout({ name: 'DhruvaStolenExtensionsBox', style: 'spacing: 4px;', reactive: true });
        this.box._isAppletZone = true;
        setBoxVertical(this.box, isVertical);
        this._anchorBox(isVertical);

        this.leftBox = new St.BoxLayout({
            style: 'spacing: 4px;',
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.leftBox._isAppletZone = true;
        setBoxVertical(this.leftBox, isVertical);

        let lastSize = -1;
        this.box.connectObject('notify::allocation', () => {
            const size = Math.round(this.panelIntegrator._isVertical() ? this.box.height : this.box.width);
            if (size >= 0 && Math.abs(size - lastSize) >= 2) {
                lastSize = size;
                this.dockUI.syncPanelSpace();
            }
        }, this);

        this._arrowIcon = new St.Icon({
            icon_size: CFG.TRAY_ARROW_SIZE,
            style: 'color: white;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            translation_y: -1,
        });

        this._arrowButton = new St.Button({
            child: this._arrowIcon,
            style_class: 'panel-button',
            can_focus: false,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._arrowButton.connectObject('clicked', () => this._toggleTray(), this);
        this._styleArrowButton();
        this._setTrayOpen(false);

        this._reorder.watch(this.box, child => child !== this._arrowButton);
        this._reorder.watch(this.leftBox, () => true);

        for (const panelBox of getPanelBoxes()) {
            panelBox.connectObject(
                CHILD_ADDED_SIGNAL, () => this._queueResync(),
                CHILD_REMOVED_SIGNAL, () => this._queueResync(),
                this);
        }

        this._populate();
        return this.box;
    }

    _watchIndicators() {
        for (const indicator of Object.values(Main.panel.statusArea)) {
            if (!isActorAlive(indicator) || this._watchedIndicators.has(indicator)) continue;
            this._watchedIndicators.add(indicator);
            indicator.connectObject(
                'notify::visible', () => this._queueResync(),
                'destroy', () => {
                    this._watchedIndicators.delete(indicator);
                    this._queueResync();
                },
                this);
            indicator.container.connectObject(
                'notify::width', () => this._queueResync(),
                'notify::height', () => this._queueResync(),
                this);
        }
    }

    _unwatchIndicators() {
        for (const indicator of this._watchedIndicators) {
            if (!isActorAlive(indicator)) continue;
            indicator.disconnectObject(this);
            if (isActorAlive(indicator.container)) indicator.container.disconnectObject(this);
        }
        this._watchedIndicators.clear();
    }

    _isSnapshotCurrent() {
        const current = this.trayManager.snapshot();
        return current.length === this._snapshot.length &&
            current.every((actor, index) => actor === this._snapshot[index]);
    }

    _anchorBox(isVertical) {
        this.box.x_expand = !isVertical;
        this.box.y_expand = isVertical;
        this.box.x_align = isVertical ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
        this.box.y_align = isVertical ? Clutter.ActorAlign.END : Clutter.ActorAlign.CENTER;
    }

    syncOrientation(isVertical) {
        if (!isActorAlive(this.box)) return;
        setBoxVertical(this.box, isVertical);
        setBoxVertical(this.leftBox, isVertical);
        this._anchorBox(isVertical);
        this._syncArrowIcon();
    }

    _styleArrowButton() {
        const { height, radius } = panelItemMetrics();
        this._arrowButton.set_style(`min-width: ${height}px; min-height: ${height}px; padding: 0; border-radius: ${radius}px;`);
    }

    _syncArrowIcon() {
        const [closedIcon, openIcon] = TRAY_ARROW_ICONS[this.dockUI.dockPosition];
        this._arrowIcon.icon_name = this._isTrayOpen ? openIcon : closedIcon;
    }

    _setTrayOpen(isOpen) {
        this._isTrayOpen = isOpen;
        this._arrowButton.checked = isOpen;
        this._syncArrowIcon();
    }

    _toggleTray() {
        if (this._trayMenu) {
            this._closeTray();
            return;
        }
        this._trayMenu = new TrayMenu(this.panelIntegrator, this.trayManager, this._arrowButton, () => {
            this._trayMenu = null;
            if (this._arrowButton) this._setTrayOpen(false);
        });
        this._trayMenu.show(this.dockUI.dockPosition);
        this._setTrayOpen(true);
    }

    _closeTray() {
        if (this._trayMenu) this._trayMenu.hide();
    }

    _collectApplets() {
        const order = this.dockUI.settings.get_strv(ORDER_KEY);
        const rank = name => {
            const index = order.indexOf(name);
            return index === -1 ? order.length : index;
        };
        return this.trayManager.getPanelIndicators()
            .filter(item => isActorAlive(item.actor))
            .sort((a, b) => rank(a.name) - rank(b.name));
    }

    _saveOrder() {
        const names = new Map(this._applets.map(item => [item.actor, item.name]));
        const order = [...this.leftBox.get_children(), ...this.box.get_children()]
            .map(actor => names.get(actor))
            .filter(Boolean);
        this.dockUI.settings.set_strv(ORDER_KEY, order);
    }

    _populate() {
        const dockPos = this.dockUI.dockPosition;
        const isVertical = this.panelIntegrator._isVertical();
        const isInline = this.trayManager.isInline();
        this._applets = this._collectApplets();

        for (const { actor, indicator, isIconLike } of this._applets) {
            const parent = actor.get_parent();
            const zone = parent === getPanelLeftBox() ? this.leftBox : this.box;
            if (parent) {
                this._state.rememberPlace(actor);
                parent.remove_child(actor);
            }

            this._state.set(actor, {
                visible: true,
                opacity: 255,
                reactive: true,
                track_hover: true,
                can_focus: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._compactTree(actor);
            stylePanelItem(this._state, actor, isIconLike, isVertical);

            if (indicator.menu) {
                this._state.connect(indicator.menu, 'open-state-changed', (_menu, isOpen) => {
                    if (!this.dockUI || !this.dockUI.autoHideManager) return;
                    if (isOpen) this.dockUI.autoHideManager.show();
                    else this.dockUI.autoHideManager.scheduleCheck(100);
                });
                if (indicator.menu._boxPointer) {
                    this._state.setArrowSide(indicator.menu._boxPointer, ARROW_SIDES[dockPos]);
                    hookPopupGap(this.dockUI, indicator.menu);
                }
            }

            zone.add_child(actor);
        }

        if (!isInline) {
            this.box.add_child(this._arrowButton);
        }
        this.box.visible = this.box.get_n_children() > 0;
        this.leftBox.visible = this.leftBox.get_n_children() > 0;
        this._snapshot = this.trayManager.snapshot();
        this._watchIndicators();
    }

    _compactTree(actor) {
        this._state.set(actor, { y_align: Clutter.ActorAlign.CENTER, y_expand: false });

        if ('icon_size' in actor) {
            const size = CFG.TRAY_ICON_SIZE;
            this._state.set(actor, { icon_size: size });
            this._state.setStyle(actor, `icon-size: ${size}px; width: ${size}px; height: ${size}px; margin: 0; padding: 0;`);
        } else if ('clutter_text' in actor) {
            this._state.setStyle(actor, `font-size: ${CFG.TRAY_LABEL_FONT_SIZE}px; font-weight: 600; margin-left: 3px; padding-top: 1px; line-height: 1;`);
        }
        for (const child of actor.get_children()) this._compactTree(child);
    }

    _releaseApplets() {
        for (const { indicator } of this._applets) {
            if (indicator.menu) unhookPopupGap(indicator.menu);
        }
        if (isActorAlive(this._arrowButton) && this._arrowButton.get_parent()) {
            this._arrowButton.get_parent().remove_child(this._arrowButton);
        }

        this._state.restore();
        this._applets = [];
    }

    refresh() {
        if (!isActorAlive(this.box)) return;
        this._closeTray();
        this._releaseApplets();
        this._populate();
        this.dockUI.syncPanelSpace();
    }

    _queueResync() {
        if (!isActorAlive(this.box)) return;
        if (this._resyncId) this.timers.remove(this._resyncId);
        this._resyncId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, RESYNC_SETTLE_MS, () => {
            this._resyncId = 0;
            this._watchIndicators();
            if (!this._isSnapshotCurrent()) {
                this._closeTray();
                this.panelIntegrator.refreshApplets();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    restore() {
        if (this._resyncId) {
            this.timers.remove(this._resyncId);
            this._resyncId = 0;
        }
        for (const panelBox of getPanelBoxes()) panelBox.disconnectObject(this);
        this._unwatchIndicators();
        this._closeTray();
        this._reorder.release();
        this._releaseApplets();

        if (isActorAlive(this.box)) {
            this.box.disconnectObject(this);
            this.box.destroy();
        }
        if (isActorAlive(this.leftBox)) this.leftBox.destroy();
        if (isActorAlive(this._arrowButton)) {
            this._arrowButton.disconnectObject(this);
            this._arrowButton.destroy();
        }
        this.box = null;
        this.leftBox = null;
        this._arrowButton = null;
        this._arrowIcon = null;
    }

    destroy() {
        this.restore();
        Main.extensionManager.disconnectObject(this);
        if (this.timers) {
            this.timers.destroy();
            this.timers = null;
        }
    }
}