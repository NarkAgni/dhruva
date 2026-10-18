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
import cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TimeoutTracker } from '../TimeoutTracker.js';
import { BlurPanel } from '../../ui/blur/BlurPanel.js';
import { HYBRID_PANEL_CONFIG } from '../PanelConfig.js';
import { NativeActorState } from './NativeActorState.js';
import { isActorAlive, setBoxVertical } from '../Utils.js';
import { paintMenuBubble } from '../../ui/shared/MenuShape.js';
import { resolvePopupBubbleColors } from '../../ui/dock/DockThemeResolver.js';


const BUBBLE_RADIUS = 16;
const BUBBLE_ARROW_HEIGHT = 12;
const BUBBLE_ARROW_WIDTH = 22;
const BLUR_BASE_PAD = 2;
const PANEL_PAD_X = 12;
const PANEL_PAD_Y = 10;
const GRID_COLUMNS = 4;
const SCREEN_MARGIN = 10;

const ARROW_SIDES = { BOTTOM: St.Side.BOTTOM, TOP: St.Side.TOP, LEFT: St.Side.LEFT, RIGHT: St.Side.RIGHT };

function makeTreeInert(state, actor) {
    state.set(actor, { reactive: false, can_focus: false });
    for (const child of actor.get_children()) makeTreeInert(state, child);
}

function compactTree(state, actor) {
    state.set(actor, { x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
    if ('icon_size' in actor) {
        const size = HYBRID_PANEL_CONFIG.TRAY_ICON_SIZE;
        state.set(actor, { icon_size: size });
        state.setStyle(actor, `icon-size: ${size}px; width: ${size}px; height: ${size}px;`);
    } else if ('clutter_text' in actor) {
        state.setStyle(actor, `font-size: ${HYBRID_PANEL_CONFIG.TRAY_LABEL_FONT_SIZE}px;`);
    }
    for (const child of actor.get_children()) compactTree(state, child);
}

export default class TrayMenu {
    constructor(panelIntegrator, trayManager, sourceBtn, onClose) {
        this.panelIntegrator = panelIntegrator;
        this.trayManager = trayManager;
        this.dockUI = panelIntegrator.dockUI;
        this.sourceBtn = sourceBtn;
        this.onClose = onClose;
        this.timers = new TimeoutTracker();

        this._shown = false;
        this._isHiding = false;
        this._isManaging = false;
        this._dragStartIndex = -1;
        this._dragCurrentIndex = -1;
        this._changeIdleId = 0;
        this._settleId = 0;
        this._dragEndTimeoutId = 0;
        this._trayBlur = null;
        this._movedState = new NativeActorState();
    }

    show(dockPosition) {
        if (this._shown) {
            this.hide();
            return;
        }
        this._shown = true;
        this._dockPos = dockPosition;
        this.dockUI._activeTrayMenu = this;
        if (this.dockUI.autoHideManager) {
            this.dockUI.autoHideManager.show();
        }

        this.overlay = new St.Widget({
            style_class: 'context-menu-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true
        });

        this.overlay.connectObject('button-release-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) this.hide();
            return Clutter.EVENT_STOP;
        }, this);

        this.menuContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });

        this.bgDrawingArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
        });
        this.menuContainer.add_child(this.bgDrawingArea);

        this.panel = new St.BoxLayout({
            reactive: true,
            style_class: 'dhruva-tray-panel',
        });
        setBoxVertical(this.panel, true);
        this.panel.connectObject('button-release-event', () => Clutter.EVENT_STOP, this);
        this.menuContainer.add_child(this.panel);
        this.overlay.add_child(this.menuContainer);

        this._buildContent();
        this._applyBubbleStyle();

        Main.layoutManager.addChrome(this.overlay, { affectsStruts: false });
        this.overlay.set_position(0, 0);
        this.overlay.set_size(global.stage.width, global.stage.height);

        this._updatePosition();

        if (this._trayBlur) {
            this._trayBlur.syncGeometry();
            this._trayBlur.syncSettings();
            this._trayBlur.queueCapture(true);
        }
    }

    refresh() {
        if (!this._shown || this._isHiding) return;
        this._buildContent();
        this._updatePosition();
    }

    _applyBubbleStyle() {
        const settings = this.dockUI.settings;

        if (settings.get_boolean('blur-enabled') && !this._trayBlur) {
            this._trayBlur = new BlurPanel(this.menuContainer, settings, BUBBLE_RADIUS - BLUR_BASE_PAD, this.menuContainer, this._blurInsets(), true);
            this._trayBlur.contentActor = this.panel;
        }

        this.bgDrawingArea.connectObject('repaint', area => {
            const colors = resolvePopupBubbleColors(this.dockUI);
            const [fullW, fullH] = area.get_surface_size();
            const isVertical = this._dockPos === 'LEFT' || this._dockPos === 'RIGHT';
            const fallbackCenter = isVertical ? fullH / 2 : fullW / 2;
            paintMenuBubble(area, cairo, this._dockPos, colors, {
                radius: BUBBLE_RADIUS,
                arrowHeight: BUBBLE_ARROW_HEIGHT,
                arrowWidth: BUBBLE_ARROW_WIDTH,
                arrowCenter: area._arrowCenter || fallbackCenter,
            });
        }, this);
    }

    _blurInsets() {
        return { top: BLUR_BASE_PAD, bottom: BLUR_BASE_PAD, left: BLUR_BASE_PAD, right: BLUR_BASE_PAD };
    }

    _detachMovedActors() {
        for (const item of this.trayManager.getTrayIndicators()) {
            if (item.indicator && item.indicator.menu) {
                delete item.indicator.menu._dhruvaTrayAutohideHooked;
            }
        }
        this._movedState.restore();
    }

    _buildContent() {
        this._detachMovedActors();
        this.panel.destroy_all_children();
        this.panel.set_style(`padding: ${this._panelPadding()};`);

        this.panel.add_child(this._buildHeader());
        if (this._isManaging) this._buildManager();
        else this._buildGrid();
    }

    _panelPadding() {
        const pad = { top: PANEL_PAD_Y, right: PANEL_PAD_X, bottom: PANEL_PAD_Y, left: PANEL_PAD_X };
        const side = { BOTTOM: 'bottom', TOP: 'top', LEFT: 'left', RIGHT: 'right' }[this._dockPos];
        pad[side] += BUBBLE_ARROW_HEIGHT;
        return `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
    }

    _buildHeader() {
        const header = new St.BoxLayout({ style_class: 'dhruva-tray-header', x_expand: true });
        setBoxVertical(header, false);

        header.add_child(new St.Label({
            text: this._isManaging ? _('Manage tray') : _('Tray'),
            style_class: 'dhruva-tray-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        if (this._isManaging) {
            header.add_child(this._makeTextButton(_('Done'), () => this._setManaging(false), true));
        } else {
            header.add_child(this._makeIconButton('document-edit-symbolic', _('Manage tray'), () => this._setManaging(true)));
        }
        return header;
    }

    _setManaging(isManaging) {
        this._isManaging = isManaging;
        this.refresh();
    }

    _makeIconButton(iconName, accessibleName, onClick) {
        const button = new St.Button({
            child: new St.Icon({ icon_name: iconName, icon_size: 14 }),
            style_class: 'dhruva-tray-button',
            accessible_name: accessibleName,
            can_focus: false,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connectObject('clicked', onClick, this);
        return button;
    }

    _makeTextButton(text, onClick, isPrimary = false) {
        const button = new St.Button({
            label: text,
            style_class: isPrimary ? 'dhruva-tray-button dhruva-tray-text-button primary' : 'dhruva-tray-button dhruva-tray-text-button',
            can_focus: false,
            track_hover: true,
        });
        button.connectObject('clicked', onClick, this);
        return button;
    }

    _adoptIndicator(item, slot) {
        const actor = item.actor;
        const parent = actor.get_parent();
        if (parent) {
            this._movedState.rememberPlace(actor);
            parent.remove_child(actor);
        }
        compactTree(this._movedState, actor);
        makeTreeInert(this._movedState, actor);
        this._movedState.set(actor, { visible: true, opacity: 255 });
        const menu = item.indicator.menu;
        if (menu && menu._boxPointer) this._movedState.setArrowSide(menu._boxPointer, ARROW_SIDES[this._dockPos]);
        slot.add_child(actor);
    }

    _makeIconSlot() {
        const size = HYBRID_PANEL_CONFIG.TRAY_BUTTON_SIZE;
        return new St.Widget({ layout_manager: new Clutter.BinLayout(), width: size, height: size });
    }

    _emptyLabel(text) {
        return new St.Label({
            text,
            style_class: 'dhruva-tray-empty',
            x_align: Clutter.ActorAlign.CENTER,
        });
    }

    _buildGrid() {
        const trayItems = this.trayManager.getTrayIndicators();
        if (trayItems.length === 0) {
            this.panel.add_child(this._emptyLabel(_('No icons in the tray')));
            return;
        }

        this.gridContainer = new St.BoxLayout({ style_class: 'dhruva-tray-grid', x_align: Clutter.ActorAlign.CENTER });
        setBoxVertical(this.gridContainer, true);
        this.panel.add_child(this.gridContainer);

        this.gridContainer._delegate = {
            handleDragOver: (source) => (source.isTrayItem ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE),
            acceptDrop: (source) => {
                if (!source.isTrayItem) return false;
                const fromIndex = this._dragStartIndex;
                const toIndex = this._dragCurrentIndex;
                if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                    this.trayManager.reorderTrayIndicators(fromIndex, toIndex);
                }
                this.refresh();
                return true;
            }
        };

        let currentRow = null;
        const allPills = [];

        for (const entry of trayItems) {
            if (allPills.length % GRID_COLUMNS === 0) {
                currentRow = new St.BoxLayout({ style_class: 'dhruva-tray-grid-row', x_align: Clutter.ActorAlign.CENTER });
                setBoxVertical(currentRow, false);
                currentRow._delegate = this.gridContainer._delegate;
                this.gridContainer.add_child(currentRow);
            }

            const iconContainer = this._makeIconSlot();
            this._adoptIndicator(entry, iconContainer);

            const pill = new St.Button({
                child: iconContainer,
                can_focus: false,
                track_hover: true,
                accessible_name: entry.displayName,
                style_class: 'dhruva-tray-pill',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER
            });

            pill._entryName = entry.name;
            pill._isDraggingActive = false;
            pill._wasDragged = false;
            pill._pressTime = 0;


            pill.connectObject(
                'button-press-event', (_actor, event) => {
                    pill._pressTime = GLib.get_monotonic_time();
                    pill._pressEvent = event;
                    return Clutter.EVENT_PROPAGATE;
                },
                'clicked', () => {
                    if (pill._isDraggingActive || pill._wasDragged) {
                        pill._wasDragged = false;
                        return;
                    }
                    if (pill._pressTime > 0 && (GLib.get_monotonic_time() - pill._pressTime) > 350000) return;

                    const pressEvent = pill._pressEvent;
                    pill._pressEvent = null;
                    if (!pressEvent) return;

                    const indicator = entry.indicator;
                    const menu = indicator.menu;
                    if (menu && !menu._dhruvaTrayAutohideHooked) {
                        menu._dhruvaTrayAutohideHooked = true;
                        this._movedState.connect(menu, 'open-state-changed', (_m, isOpen) => {
                            if (!this.dockUI || !this.dockUI.autoHideManager) return;
                            if (isOpen) this.dockUI.autoHideManager.show();
                            else this.dockUI.autoHideManager.scheduleCheck(100);
                        });
                    }
                    const wasOpen = menu ? menu.isOpen : false;
                    indicator.event(pressEvent, false);
                    indicator.event(Clutter.get_current_event(), false);
                    if (menu && menu.isOpen === wasOpen) menu.toggle();
                },
                this
            );

            pill._delegate = {
                entryName: entry.name,
                isTrayItem: true,
                actor: pill,
                getDragActor: () => new Clutter.Clone({ source: iconContainer, reactive: false }),
                getDragActorSource: () => pill,
                handleDragOver: (source) => {
                    if (!source.isTrayItem) return DND.DragMotionResult.CONTINUE;
                    if (source.entryName === pill._entryName) return DND.DragMotionResult.NO_DROP;

                    const toIndex = allPills.indexOf(pill);
                    if (toIndex !== -1 && this._dragStartIndex !== -1 && toIndex !== this._dragCurrentIndex) {
                        this._dragCurrentIndex = toIndex;
                        const start = this._dragStartIndex;
                        const end = toIndex;

                        for (let i = 0; i < allPills.length; i++) {
                            const b = allPills[i];
                            if (i === start) continue;
                            let visualIndex = i;
                            if (start < end && i > start && i <= end) visualIndex = i - 1;
                            else if (start > end && i >= end && i < start) visualIndex = i + 1;

                            const targetPill = allPills[visualIndex];
                            if (targetPill && targetPill._startX !== undefined && b._startX !== undefined) {
                                const tx = targetPill._startX - b._startX;
                                const ty = targetPill._startY - b._startY;
                                b.remove_transition('translation-x');
                                b.remove_transition('translation-y');
                                b.ease({ translation_x: tx, translation_y: ty, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                            }
                        }
                    }
                    return DND.DragMotionResult.MOVE_DROP;
                },
                acceptDrop: (source) => {
                    if (!source.isTrayItem || source.entryName === pill._entryName) return false;
                    const fromIndex = this._dragStartIndex;
                    const toIndex = allPills.indexOf(pill);
                    if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                        this.trayManager.reorderTrayIndicators(fromIndex, toIndex);
                    }
                    this.refresh();
                    return true;
                }
            };

            const draggable = DND.makeDraggable(pill, { restoreOnSuccess: true });
            draggable.connectObject(
                'drag-begin', () => {
                    pill._wasDragged = true;
                    pill._isDraggingActive = true;
                    pill.opacity = 0;
                    if (this.dockUI && this.dockUI.autoHideManager) {
                        this.dockUI.autoHideManager._isTrayDragging = true;
                        this.dockUI.autoHideManager.show();
                    }
                    this._dragStartIndex = allPills.indexOf(pill);
                    this._dragCurrentIndex = this._dragStartIndex;

                    for (let p = 0; p < allPills.length; p++) {
                        const b = allPills[p];
                        const [absX, absY] = b.get_transformed_position();
                        b._startX = absX;
                        b._startY = absY;
                        b.remove_all_transitions();
                    }
                },
                'drag-cancelled', () => {
                    pill.opacity = 255;
                    pill._isDraggingActive = false;
                    if (this.dockUI && this.dockUI.autoHideManager) {
                        this.dockUI.autoHideManager._isTrayDragging = false;
                    }
                    for (let p = 0; p < allPills.length; p++) {
                        const b = allPills[p];
                        b.remove_transition('translation-x');
                        b.remove_transition('translation-y');
                        b.ease({ translation_x: 0, translation_y: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                    }
                },
                'drag-end', () => {
                    pill.opacity = 255;
                    if (this.dockUI && this.dockUI.autoHideManager) {
                        this.dockUI.autoHideManager._isTrayDragging = false;
                    }
                    if (this._dragEndTimeoutId) {
                        this.timers.remove(this._dragEndTimeoutId);
                        this._dragEndTimeoutId = 0;
                    }
                    this._dragEndTimeoutId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 80, () => {
                        this._dragEndTimeoutId = 0;
                        pill._isDraggingActive = false;
                        return GLib.SOURCE_REMOVE;
                    });
                },
                this
            );

            allPills.push(pill);
            currentRow.add_child(pill);
        }
    }

    _buildManager() {
        const trayItems = this.trayManager.getTrayIndicators();
        const pinnedItems = this.trayManager.getPinnedIndicators();

        this.panel.add_child(this._buildSection(_('In tray'), trayItems, _('No icons in the tray'), item => {
            const slot = this._makeIconSlot();
            this._adoptIndicator(item, slot);
            return this._buildManageRow(slot, 'view-pin-symbolic', _('Show on panel'),
                () => this.trayManager.moveToPanel(item.name));
        }));

        this.panel.add_child(this._buildSection(_('Pinned to panel'), pinnedItems, _('No pinned icons'), item => {
            return this._buildManageRow(this._makePreview(item.actor), 'go-down-symbolic', _('Move to tray'),
                () => this.trayManager.moveToTray(item.name));
        }));

        const footer = new St.BoxLayout({ style_class: 'dhruva-tray-footer', x_expand: true });
        setBoxVertical(footer, false);
        footer.add_child(new St.Label({
            text: _('Only small icons can live in the tray'),
            style_class: 'dhruva-tray-note',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        footer.add_child(this._makeTextButton(_('Reset'), () => this._applyChange(() => this.trayManager.resetToDefaults())));
        this.panel.add_child(footer);
    }

    _buildSection(title, items, emptyText, buildRow) {
        const section = new St.BoxLayout({ style_class: 'dhruva-tray-section' });
        setBoxVertical(section, true);

        section.add_child(new St.Label({
            text: title.toUpperCase(),
            style_class: 'dhruva-tray-section-title',
        }));

        if (items.length === 0) section.add_child(this._emptyLabel(emptyText));
        for (const item of items) section.add_child(buildRow(item));
        return section;
    }

    _buildManageRow(iconActor, actionIcon, actionName, onAction) {
        const row = new St.BoxLayout({ style_class: 'dhruva-tray-row', reactive: true, track_hover: true, x_expand: true });
        setBoxVertical(row, false);

        row.add_child(iconActor);
        row.add_child(new St.Widget({ x_expand: true }));
        row.add_child(this._makeIconButton(actionIcon, actionName, () => this._applyChange(onAction)));
        return row;
    }

    _makePreview(actor) {
        const slotHeight = HYBRID_PANEL_CONFIG.TRAY_BUTTON_SIZE;
        const [width, height] = actor.get_size();
        const scale = height > 0 ? Math.min(1, slotHeight / height) : 1;

        const slot = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style: `min-width: ${slotHeight}px;`,
            height: slotHeight,
        });
        slot.add_child(new Clutter.Clone({
            source: actor,
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        return slot;
    }

    _applyChange(change) {
        this._detachMovedActors();
        change();

        if (this._changeIdleId) {
            this.timers.remove(this._changeIdleId);
            this._changeIdleId = 0;
        }
        if (this._settleId) {
            this.timers.remove(this._settleId);
            this._settleId = 0;
        }
        this._changeIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._changeIdleId = 0;
            this.refresh();
            if (this._settleId) {
                this.timers.remove(this._settleId);
                this._settleId = 0;
            }
            this._settleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._settleId = 0;
                if (this._shown) this._updatePosition();
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _updatePosition() {
        if (!this.menuContainer || !isActorAlive(this.sourceBtn)) return;

        const [, popupW] = this.menuContainer.get_preferred_width(-1);
        const [, popupH] = this.menuContainer.get_preferred_height(popupW);
        const [btnX, btnY] = this.sourceBtn.get_transformed_position();
        const [btnW, btnH] = this.sourceBtn.get_transformed_size();
        const [dockX, dockY] = this.dockUI.bgActor.get_transformed_position();
        const [dockW, dockH] = this.dockUI.bgActor.get_transformed_size();
        const gap = HYBRID_PANEL_CONFIG.POPUP_DOCK_GAP;
        const isVertical = this._dockPos === 'LEFT' || this._dockPos === 'RIGHT';

        let x = btnX + (btnW - popupW) / 2;
        let y = btnY + (btnH - popupH) / 2;
        switch (this._dockPos) {
            case 'TOP': y = dockY + dockH + gap; break;
            case 'LEFT': x = dockX + dockW + gap; break;
            case 'RIGHT': x = dockX - popupW - gap; break;
            default: y = dockY - popupH - gap; break;
        }

        const currentMon = this.dockUI.monitorManager.getCurrentMonitor();
        const mon = currentMon && currentMon.monitor
            ? currentMon.monitor
            : { x: 0, y: 0, width: global.stage.width, height: global.stage.height };
        x = Math.round(Math.max(mon.x + SCREEN_MARGIN, Math.min(x, mon.x + mon.width - popupW - SCREEN_MARGIN)));
        y = Math.round(Math.max(mon.y + SCREEN_MARGIN, Math.min(y, mon.y + mon.height - popupH - SCREEN_MARGIN)));

        this.bgDrawingArea._arrowCenter = isVertical ? (btnY + btnH / 2) - y : (btnX + btnW / 2) - x;
        this.bgDrawingArea.queue_repaint();
        this.menuContainer.set_position(x, y);
        this._syncBlur({ x, y, width: popupW, height: popupH });
    }

    _syncBlur(rect) {
        if (!this._trayBlur) return;
        this._trayBlur.customInsets = this._blurInsets();
        this._trayBlur.setArrow({
            side: this._dockPos,
            center: this.bgDrawingArea._arrowCenter,
            width: BUBBLE_ARROW_WIDTH,
            height: BUBBLE_ARROW_HEIGHT,
        });
        this._trayBlur.setTargetRect(rect);
    }

    hide() {
        if (!this._isHiding) {
            this._isHiding = true;
            this._shown = false;
            this._isManaging = false;
            this._cleanup();
        }
    }

    _cleanup() {
        this._detachMovedActors();
        if (this._dragEndTimeoutId && this.timers) {
            this.timers.remove(this._dragEndTimeoutId);
            this._dragEndTimeoutId = 0;
        }
        if (this._changeIdleId && this.timers) {
            this.timers.remove(this._changeIdleId);
            this._changeIdleId = 0;
        }
        if (this._settleId && this.timers) {
            this.timers.remove(this._settleId);
            this._settleId = 0;
        }
        this.timers.destroy();

        if (this._trayBlur) {
            this._trayBlur.destroy();
            this._trayBlur = null;
        }

        if (this.bgDrawingArea) this.bgDrawingArea.disconnectObject(this);
        if (this.panel) this.panel.disconnectObject(this);
        if (this.overlay && this.overlay.get_parent()) {
            Main.layoutManager.removeChrome(this.overlay);
        }
        if (this.overlay) {
            this.overlay.disconnectObject(this);
            this.overlay.destroy();
            this.overlay = null;
        }

        this.menuContainer = null;
        this._isHiding = false;

        if (this.dockUI) {
            if (this.dockUI._activeTrayMenu === this) {
                this.dockUI._activeTrayMenu = null;
            }
            if (this.dockUI.autoHideManager) {
                this.dockUI.autoHideManager._isTrayDragging = false;
                this.dockUI.autoHideManager.scheduleCheck(100);
            }
        }

        this.onClose();
    }
}