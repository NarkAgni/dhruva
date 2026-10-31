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
import Meta from 'gi://Meta';
import cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { BlurPanel } from '../blur/BlurPanel.js';
import { getIndicatorProps } from './DockRenderer.js';
import { Settings } from '../../core/SettingsManager.js';
import { paintMenuBubble } from '../shared/MenuShape.js';
import { createIndicatorBox } from './DockButtonBase.js';
import { createPlateIcon, createCrispBundledIcon, getZoomRenderSize } from './DockItemBuilder.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { HYBRID_PANEL_CONFIG } from '../../core/PanelConfig.js';
import { resolvePopupBubbleColors } from './DockThemeResolver.js';
import { isActorAlive, setBoxVertical } from '../../core/Utils.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';


export const OVERFLOW_BUTTON_KEY = 'dhruva-overflow-button';

const CFG = HYBRID_PANEL_CONFIG;
const BLUR_BASE_PAD = 2;
const DOTS_ICON_FILE = 'overflow-dots-symbolic.svg';
const DOTS_FALLBACK_ICON = 'view-more-horizontal-symbolic';
const DOTS_COLOR = 'rgba(255, 255, 255, 0.92)';
const ITEM_SPACING = 6;
const PANEL_PADDING = 12;
const SCREEN_EDGE_MARGIN = 10;
const MAGNIFIER_PAUSE_KEY = 'overflow-menu';



function isVerticalPosition(dockPos) {
    return dockPos === 'LEFT' || dockPos === 'RIGHT';
}

function awayFromDock(dockPos) {
    switch (dockPos) {
        case 'TOP': return [0, 1];
        case 'LEFT': return [1, 0];
        case 'RIGHT': return [-1, 0];
        default: return [0, -1];
    }
}

export class DockOverflowMenu {
    constructor(dockUI) {
        this._dockUI = dockUI;
        this._items = [];
        this._isOpen = false;
        this._blur = null;
        this._raiseLaterId = 0;
        this._arrowCenter = 0;
        this._anchorWatchTracker = {};
        this._layoutKey = this._currentLayoutKey();

        this.button = this._buildButton();
        this._buildPopup();
    }

    get isOpen() {
        return this._isOpen;
    }

    queueRepaint() {
        if (this._bubble) this._bubble.queue_repaint();
    }

    get keys() {
        return this._items.map(item => item.key).join('|');
    }

    isStale() {
        return this._layoutKey !== this._currentLayoutKey();
    }

    _currentLayoutKey() {
        return `${Settings.iconSize}|${this._dockUI.dockPosition}|${Settings.hoverZoom}|${Settings.hoverZoomFactor}`;
    }

    setItems(items) {
        this._items = items;
        if (!this._isOpen) return;

        if (this._items.length === 0) {
            this.close();
            return;
        }
        this._populateGrid();
        this._reposition();
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    open() {
        if (this._isOpen || this._items.length === 0) return;
        this._isOpen = true;
        if (this._dockUI.autoHideManager) {
            this._dockUI.autoHideManager.show();
        }

        const dockPos = this._dockUI.dockPosition;
        this._populateGrid();
        this._applyTheme();

        this._overlay.set_position(0, 0);
        this._overlay.set_size(global.stage.width, global.stage.height);
        if (!this._overlay.get_parent()) Main.layoutManager.addChrome(this._overlay, { affectsStruts: false });
        this._overlay.show();

        this._reposition();
        this._watchAnchor();
        setMagnifierPauseState(this._dockUI.actor, MAGNIFIER_PAUSE_KEY, true);
        this.button.checked = true;
        global.stage.set_key_focus(this._overlay);

        const [ax, ay] = awayFromDock(dockPos);
        this._container.remove_all_transitions();
        this._container.opacity = 0;
        this._container.translation_x = -ax * CFG.OVERFLOW_SLIDE_PX;
        this._container.translation_y = -ay * CFG.OVERFLOW_SLIDE_PX;
        this._container.ease({
            opacity: 255,
            translation_x: 0,
            translation_y: 0,
            duration: CFG.OVERFLOW_OPEN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    close() {
        if (this._isOpen) {
            this._isOpen = false;

            this._unwatchAnchor();
            setMagnifierPauseState(this._dockUI.actor, MAGNIFIER_PAUSE_KEY, false);
            this.button.checked = false;
            if (global.stage.get_key_focus() === this._overlay) global.stage.set_key_focus(null);

            if (this._dockUI.autoHideManager) {
                this._dockUI.autoHideManager.scheduleCheck(100);
            }

            const [ax, ay] = awayFromDock(this._dockUI.dockPosition);
            this._container.remove_all_transitions();
            this._container.ease({
                opacity: 0,
                translation_x: -ax * CFG.OVERFLOW_SLIDE_PX * 0.6,
                translation_y: -ay * CFG.OVERFLOW_SLIDE_PX * 0.6,
                duration: CFG.OVERFLOW_CLOSE_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this._isOpen) this._detachPopup();
                },
            });
        }
    }

    destroy() {
        if (this.button) this.button.destroy();
    }

    _teardown() {
        if (this.button) {
            this.button = null;

            if (this._raiseLaterId) {
                global.compositor.get_laters().remove(this._raiseLaterId);
                this._raiseLaterId = 0;
            }

            if (this._isOpen) {
                this._isOpen = false;
                this._unwatchAnchor();
                setMagnifierPauseState(this._dockUI.actor, MAGNIFIER_PAUSE_KEY, false);
                if (this._dockUI.autoHideManager) {
                    this._dockUI.autoHideManager.scheduleCheck(100);
                }
            }
            this._container.remove_all_transitions();
            this._detachPopup();
            if (this._bubble) this._bubble.disconnectObject(this);
            if (this._container) this._container.disconnectObject(this);
            if (this._overlay) {
                this._overlay.disconnectObject(this);
                this._overlay.destroy();
            }
            if (this._dockUI.overflowMenu === this) this._dockUI.overflowMenu = null;
        }
    }

    _buildButton() {
        const iconSize = Settings.iconSize;
        const renderSize = getZoomRenderSize(iconSize);

        const plate = createPlateIcon(iconSize, renderSize);
        const dots = createCrispBundledIcon(DOTS_ICON_FILE, DOTS_FALLBACK_ICON, iconSize, renderSize, DOTS_COLOR);
        if (isVerticalPosition(this._dockUI.dockPosition)) dots.rotation_angle_z = 90;

        const dotsBin = new St.Bin({
            child: dots,
            width: iconSize,
            height: iconSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const appBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: iconSize,
            height: iconSize,
            clip_to_allocation: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        appBox.add_child(plate);
        appBox.add_child(dotsBin);

        const button = new St.Button({
            name: 'DhruvaOverflowBtn',
            style_class: 'dock-app-button dhruva-overflow-button',
            style: 'background-color: transparent; border: none; box-shadow: none; padding: 0;',
            child: appBox,
            reactive: true,
            can_focus: false,
            track_hover: true,
            width: iconSize,
            height: iconSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        button._isOverflowBtn = true;
        button._isStatic = true;
        button._entityId = OVERFLOW_BUTTON_KEY;
        button._activateCallback = (buttonNum) => {
            if (buttonNum === 1) this.toggle();
        };

        button.connectObject(
            'clicked', () => {
                if (!Settings.hoverZoom) this.toggle();
            },
            'destroy', () => this._teardown(),
            this
        );

        return button;
    }

    _buildPopup() {
        this._overlay = new St.Widget({
            style_class: 'context-menu-overlay',
            reactive: true,
            can_focus: true,
            visible: false,
        });
        this._overlay.connectObject(
            'button-release-event', (_actor, event) => {
                if (event.get_button() === Clutter.BUTTON_PRIMARY) this.close();
                return Clutter.EVENT_STOP;
            },
            'key-press-event', (_actor, event) => {
                if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
                this.close();
                return Clutter.EVENT_STOP;
            },
            this
        );

        this._container = new St.Widget({
            name: 'DhruvaOverflowContainer',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        this._container.connectObject('button-release-event', () => Clutter.EVENT_STOP, this);

        this._bubble = new St.DrawingArea({ x_expand: true, y_expand: true });
        this._bubble.connectObject('repaint', area => {
            this._colors = resolvePopupBubbleColors(this._dockUI);
            paintMenuBubble(area, cairo, this._dockUI.dockPosition, this._colors, {
                radius: CFG.OVERFLOW_CORNER_RADIUS,
                arrowHeight: CFG.OVERFLOW_ARROW_HEIGHT,
                arrowWidth: CFG.OVERFLOW_ARROW_WIDTH,
                arrowCenter: this._arrowCenter,
            });
        }, this);

        this._grid = new St.BoxLayout({ style: `spacing: ${ITEM_SPACING}px;` });
        setBoxVertical(this._grid, true);

        this._container.add_child(this._bubble);
        this._container.add_child(this._grid);
        this._overlay.add_child(this._container);
    }

    _detachPopup() {
        if (this._blur) {
            this._blur.destroy();
            this._blur = null;
        }
        this._overlay.hide();
        if (this._overlay.get_parent()) Main.layoutManager.removeChrome(this._overlay);
        this._grid.destroy_all_children();
    }

    _gridPadding() {
        const pad = PANEL_PADDING;
        const arrow = pad + CFG.OVERFLOW_ARROW_HEIGHT;
        switch (this._dockUI.dockPosition) {
            case 'TOP': return `${arrow}px ${pad}px ${pad}px ${pad}px`;
            case 'LEFT': return `${pad}px ${pad}px ${pad}px ${arrow}px`;
            case 'RIGHT': return `${pad}px ${arrow}px ${pad}px ${pad}px`;
            default: return `${pad}px ${pad}px ${arrow}px ${pad}px`;
        }
    }

    _blurInsets() {
        return { top: BLUR_BASE_PAD, bottom: BLUR_BASE_PAD, left: BLUR_BASE_PAD, right: BLUR_BASE_PAD };
    }

    _applyTheme() {
        this._colors = resolvePopupBubbleColors(this._dockUI);
        if (this._blur) {
            this._blur.destroy();
            this._blur = null;
        }
        this._grid.set_style(`spacing: ${ITEM_SPACING}px; padding: ${this._gridPadding()};`);

        if (this._dockUI.settings.get_boolean('blur-enabled')) {
            this._blur = new BlurPanel(
                this._container,
                this._dockUI.settings,
                CFG.OVERFLOW_CORNER_RADIUS - BLUR_BASE_PAD,
                this._container,
                this._blurInsets(),
                true
            );
            this._blur.contentActor = this._grid;
        }
        this._bubble.queue_repaint();
    }

    _populateGrid() {
        this._grid.destroy_all_children();

        let row = null;
        this._items.forEach((item, index) => {
            if (index % CFG.OVERFLOW_COLUMNS === 0) {
                row = new St.BoxLayout({ style: `spacing: ${ITEM_SPACING}px;` });
                setBoxVertical(row, false);
                this._grid.add_child(row);
            }
            row.add_child(this._buildItem(item));
        });
    }

    _buildItem(item) {
        const app = item.entity;
        const iconSize = Settings.iconSize;
        const slotSize = iconSize + CFG.OVERFLOW_ITEM_PADDING;

        const iconStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: iconSize,
            height: iconSize,
        });
        iconStack.add_child(app.create_icon_texture(iconSize));

        if (item.isRunning && Settings.showRunningIndicators) {
            const style = Settings.indicatorStyle;
            const count = (style === 'line' || style === 'windows') ? 1 : Math.max(1, item.windowCount);
            const indicator = createIndicatorBox(
                this._dockUI.dockPosition,
                false,
                getIndicatorProps(this._dockUI, app),
                count,
                iconSize,
                item.isFocused
            );
            indicator.y_align = Clutter.ActorAlign.END;
            iconStack.add_child(indicator);
        }

        const itemBtn = new St.Button({
            child: iconStack,
            style_class: 'dhruva-overflow-item',
            width: slotSize,
            height: slotSize,
            reactive: true,
            can_focus: false,
            track_hover: true,
        });
        itemBtn._inPopup = true;
        itemBtn.connectObject(
            'clicked', () => {
                app.activate();
                this.close();
            },
            'button-press-event', (_actor, event) => {
                if (event.get_button() !== Clutter.BUTTON_SECONDARY) return Clutter.EVENT_PROPAGATE;
                this._openContextMenu(app, itemBtn);
                return Clutter.EVENT_STOP;
            },
            this
        );

        return itemBtn;
    }

    _openContextMenu(app, anchor) {
        const contextMenu = new AppContextMenu(this._dockUI, app, anchor);
        const menuActor = contextMenu.actor;

        menuActor.connectObject(
            'parent-set', () => {
                if (menuActor.get_parent()) this._raiseAfterSetup(menuActor);
            },
            'destroy', () => {
                if (this._isOpen) global.stage.set_key_focus(this._overlay);
            },
            this._overlay
        );
        contextMenu.show(this._dockUI.dockPosition);
    }

    _raiseAfterSetup(actor) {
        const laters = global.compositor.get_laters();
        if (this._raiseLaterId) {
            laters.remove(this._raiseLaterId);
            this._raiseLaterId = 0;
        }
        this._raiseLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._raiseLaterId = 0;
            const parent = actor.get_parent();
            if (!parent || !this._overlay) return GLib.SOURCE_REMOVE;

            if (this._overlay.get_parent() === parent) parent.set_child_above_sibling(actor, this._overlay);
            else parent.set_child_above_sibling(actor, null);
            return GLib.SOURCE_REMOVE;
        });
    }

    _watchAnchor() {
        const reposition = () => this._reposition();
        if (this.button && isActorAlive(this.button)) {
            this.button.connectObject(
                'notify::allocation', reposition,
                'notify::translation-x', reposition,
                'notify::translation-y', reposition,
                'notify::scale-x', reposition,
                'notify::scale-y', reposition,
                this._anchorWatchTracker
            );
        }
        if (isActorAlive(this._dockUI.actor)) {
            this._dockUI.actor.connectObject(
                'notify::translation-x', reposition,
                'notify::translation-y', reposition,
                'notify::allocation', reposition,
                this._anchorWatchTracker
            );
        }
    }

    _unwatchAnchor() {
        if (this.button && isActorAlive(this.button)) {
            this.button.disconnectObject(this._anchorWatchTracker);
        }
        if (isActorAlive(this._dockUI.actor)) {
            this._dockUI.actor.disconnectObject(this._anchorWatchTracker);
        }
    }

    _reposition() {
        if (!this._isOpen) return;

        const dockPos = this._dockUI.dockPosition;
        const [, popupW] = this._container.get_preferred_width(-1);
        const [, popupH] = this._container.get_preferred_height(-1);
        const [btnX, btnY] = this.button.get_transformed_position();
        const [btnW, btnH] = this.button.get_transformed_size();
        const [dockX, dockY] = this._dockUI.bgActor.get_transformed_position();
        const [dockW, dockH] = this._dockUI.bgActor.get_transformed_size();
        const gap = CFG.POPUP_DOCK_GAP;

        let x = btnX + (btnW - popupW) / 2;
        let y = btnY + (btnH - popupH) / 2;

        switch (dockPos) {
            case 'TOP':
                y = dockY + dockH + gap;
                this._container.set_pivot_point(0.5, 0.0);
                break;
            case 'LEFT':
                x = dockX + dockW + gap;
                this._container.set_pivot_point(0.0, 0.5);
                break;
            case 'RIGHT':
                x = dockX - popupW - gap;
                this._container.set_pivot_point(1.0, 0.5);
                break;
            default:
                y = dockY - popupH - gap;
                this._container.set_pivot_point(0.5, 1.0);
                break;
        }

        const currentMon = this._dockUI.monitorManager.getCurrentMonitor();
        const mon = currentMon && currentMon.monitor
            ? currentMon.monitor
            : { x: 0, y: 0, width: global.stage.width, height: global.stage.height };
        x = Math.max(mon.x + SCREEN_EDGE_MARGIN, Math.min(x, mon.x + mon.width - popupW - SCREEN_EDGE_MARGIN));
        y = Math.max(mon.y + SCREEN_EDGE_MARGIN, Math.min(y, mon.y + mon.height - popupH - SCREEN_EDGE_MARGIN));

        this._arrowCenter = isVerticalPosition(dockPos)
            ? (btnY + btnH / 2) - y
            : (btnX + btnW / 2) - x;

        this._container.set_position(Math.round(x), Math.round(y));
        this._bubble.queue_repaint();

        if (this._blur) {
            this._blur.setCustomInsets(this._blurInsets());
            this._blur.setArrow({
                side: this._dockUI.dockPosition,
                center: this._arrowCenter,
                width: CFG.OVERFLOW_ARROW_WIDTH,
                height: CFG.OVERFLOW_ARROW_HEIGHT,
            });
            this._blur.syncGeometry();
        }
    }
}