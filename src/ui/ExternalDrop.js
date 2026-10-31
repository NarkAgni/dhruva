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


import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { isActorAlive } from '../core/Utils.js';
import { Settings } from '../core/SettingsManager.js';
import { isPanelOrFullWidth } from '../core/LayoutMode.js';
import { resetMagnification } from './magnifier/MagnifierReset.js';
import { getDockButtons, getFixedSlots } from './magnifier/MagnifierMath.js';
import { startDragLoop, stopDragLoop } from './magnifier/MagnifierDragLoop.js';


const SHRINK_DURATION_MS = 160;
const DOCK_EDGE_MARGIN = 10;
const DEFAULT_ICON_SPACING = 6;
const GAP_SLOTS = 1.0;
const GAP_SLIDE_MS = 180;

export function sourceDelegate(source) {
    return (source && source._delegate) || source || {};
}

export function isSlotButton(btn) {
    const styleClass = btn.style_class || '';
    return !btn._isStatic &&
        !btn._isGridBtn &&
        !btn._isMusicPill &&
        !styleClass.includes('dock-separator') &&
        !styleClass.includes('clock-module');
}

function buttonKey(btn) {
    const delegate = btn._delegate;
    if (!delegate) return null;
    if (delegate.isFolder && delegate.folderData) return `folder:${delegate.folderData.id}`;

    const app = delegate.app;
    return app && !app.is_module ? app.get_id() : null;
}

export function dockOrderKeys(boxActor) {
    return boxActor.get_children().map(buttonKey).filter(key => key !== null);
}

function mergeHiddenKeys(fullOrder, visibleKeys, movedKey) {
    const visible = new Set(visibleKeys);
    const hiddenAfter = new Map();
    let anchor = null;

    fullOrder.forEach(key => {
        if (visible.has(key)) {
            if (key !== movedKey) anchor = key;
            return;
        }
        if (!hiddenAfter.has(anchor)) hiddenAfter.set(anchor, []);
        hiddenAfter.get(anchor).push(key);
    });

    const merged = [];
    let pending = hiddenAfter.get(null) || [];
    visibleKeys.forEach(key => {
        if (key !== movedKey) {
            merged.push(...pending);
            pending = [];
        }
        merged.push(key);
        if (hiddenAfter.has(key)) pending = pending.concat(hiddenAfter.get(key));
    });
    merged.push(...pending);
    return merged;
}

export function saveDockLayout(dockUI, visibleKeys, entityId) {
    const manager = dockUI.appManager;
    const keys = mergeHiddenKeys(manager.getDockOrder(), visibleKeys, entityId);
    manager.saveDockOrder(keys);

    const current = Settings.independentDock
        ? (manager.pinnedApps || [])
        : manager.favManager.getFavorites().map(app => app.get_id());

    const appIds = keys.filter(key => !key.startsWith('folder:'));
    const order = appIds.filter(id => current.includes(id) || id === entityId);
    current.forEach(id => {
        if (!order.includes(id)) order.push(id);
    });

    if (Settings.independentDock) {
        manager.savePinnedApps(order);
    } else {
        const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
        shellSettings.set_strv('favorite-apps', order);
    }
}


class ExternalDrop {
    constructor(dockUI) {
        this._dockUI = dockUI;
        this._active = false;
        this._bgSpread = 0;
        this._trackedDragActors = new Set();
        this._monitor = { dragMotion: event => this._onDragMotion(event) };

        DND.addDragMonitor(this._monitor);
        this.attach();
    }

    attach() {
        const { boxActor, actor, bgActor } = this._dockUI;
        [boxActor, actor, bgActor].filter(target => isActorAlive(target)).forEach(target => {
            if (!target._delegate) target._delegate = {};
            target._delegate.handleDragOver = source => this._handleDragOver(source);
            target._delegate.acceptDrop = source => this._isDockIcon(source) || this._drop(source);
        });
    }

    destroy() {
        DND.removeDragMonitor(this._monitor);
        this._end();

        this._trackedDragActors.forEach(dragActor => {
            if (isActorAlive(dragActor)) {
                dragActor.disconnectObject(this);
            }
        });
        this._trackedDragActors.clear();

        this._dockUI = null;
    }

    isExternal(source) {
        return this._externalApp(source) !== null;
    }

    _isDockIcon(source) {
        const button = sourceDelegate(source).button;
        if (!button) return false;
        return !isActorAlive(button) || this._dockUI.boxActor.contains(button);
    }

    _externalApp(source) {
        if (this._isDockIcon(source)) return null;

        const holder = sourceDelegate(source);
        if (holder.app && holder.app.get_id) return holder.app;
        return holder.id ? Shell.AppSystem.get_default().lookup_app(holder.id) : null;
    }

    _isVertical() {
        const position = this._dockUI.dockPosition;
        return position === 'LEFT' || position === 'RIGHT';
    }

    _handleDragOver(source) {
        if (this._isDockIcon(source)) return DND.DragMotionResult.MOVE_DROP;
        return this.isExternal(source) ? DND.DragMotionResult.COPY_DROP : DND.DragMotionResult.NO_DROP;
    }

    _onDragMotion({ source, dragActor }) {
        const app = this._externalApp(source);
        if (app === null || Settings.lockIcons) return DND.DragMotionResult.CONTINUE;

        this._shrink(dragActor);

        const [x, y] = global.get_pointer();
        if (this._overDock(x, y) && !this._dockUI.appManager.hasApp(app)) this._hover(x, y);
        else this._end();

        return DND.DragMotionResult.CONTINUE;
    }

    _shrink(dragActor) {
        if (!isActorAlive(dragActor)) return;
        const size = Math.max(dragActor.width, dragActor.height);
        if (dragActor._dockShrunk || size === 0) return;
        dragActor._dockShrunk = true;

        dragActor.connectObject('destroy', () => {
            this._trackedDragActors.delete(dragActor);
            this._end();
        }, this);
        this._trackedDragActors.add(dragActor);

        const [x, y] = global.get_pointer();
        const scale = Math.min(1, Settings.iconSize / size);
        dragActor.set_pivot_point(0.5, 0.5);
        dragActor.ease({
            scale_x: scale,
            scale_y: scale,
            translation_x: x - (dragActor.x + dragActor.width / 2),
            translation_y: y - (dragActor.y + dragActor.height / 2),
            duration: SHRINK_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _overDock(x, y) {
        if (!this._dockUI || !isActorAlive(this._dockUI.actor)) return false;
        const [left, top] = this._dockUI.actor.get_transformed_position();
        const [width, height] = this._dockUI.actor.get_transformed_size();
        return x >= left - DOCK_EDGE_MARGIN && x <= left + width + DOCK_EDGE_MARGIN &&
            y >= top - DOCK_EDGE_MARGIN && y <= top + height + DOCK_EDGE_MARGIN;
    }

    _begin(isVertical) {
        const actor = this._dockUI.actor;
        this._active = true;
        actor._isExternalDragging = true;
        actor._isDragging = true;
        actor._fixedSlots = null;
        if (Settings.hoverZoom) startDragLoop(actor, isVertical, this._dockUI.settings);
    }

    _hover(x, y) {
        const isVertical = this._isVertical();
        if (!this._active) this._begin(isVertical);

        const spot = this._locate(x, y, isVertical);
        if (spot) this._applyGap(spot);
    }

    _locate(x, y, isVertical) {
        const actor = this._dockUI.actor;
        const buttons = getDockButtons(actor);
        const model = getFixedSlots(actor, isVertical, buttons);
        if (!model) return null;

        const { centersByBtn, btnToOrder } = model;
        const slots = buttons.map((_, i) => i)
            .filter(i => isSlotButton(buttons[i]))
            .sort((a, b) => btnToOrder[a] - btnToOrder[b]);

        const [left, top] = actor.get_transformed_position();
        const cursor = isVertical ? (y - top) / actor.scale_y : (x - left) / actor.scale_x;
        const index = slots.findIndex(i => cursor < centersByBtn[i]);

        return { buttons, model, slots, target: index === -1 ? slots.length : index };
    }

    _applyGap({ buttons, model, slots, target }) {
        if (slots.length === 0) return;

        const centers = model.centersByBtn;
        const pitch = slots.length > 1
            ? (centers[slots[slots.length - 1]] - centers[slots[0]]) / (slots.length - 1)
            : Settings.iconSize + (Settings.iconSpacing || DEFAULT_ICON_SPACING);
        const half = (pitch * GAP_SLOTS) / 2;

        const lastSlot = slots[slots.length - 1];
        const anchor = target < slots.length ? model.btnToOrder[slots[target]] : model.btnToOrder[lastSlot] + 1;

        this._dockUI.actor._gapSpreadTarget = half;
        buttons.forEach((btn, i) => {
            btn._gapTarget = model.btnToOrder[i] >= anchor ? half : -half;
        });

        if (!Settings.hoverZoom) this._slideGap(buttons, half);
    }

    _slideGap(buttons, half) {
        const isVertical = this._isVertical();
        const prop = isVertical ? 'translation_y' : 'translation_x';

        buttons.forEach(btn => {
            if (btn._gapSlideTarget === btn._gapTarget) return;
            btn._gapSlideTarget = btn._gapTarget;
            btn.ease({ [prop]: btn._gapTarget, duration: GAP_SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        });

        const bg = this._dockUI.bgActor;
        if (isPanelOrFullWidth() || !isActorAlive(bg) || this._bgSpread === half) return;
        this._bgSpread = half;

        const blur = this._dockUI._dockBlur;
        bg.ease({
            x: isVertical ? bg._baseX : bg._baseX - half,
            y: isVertical ? bg._baseY - half : bg._baseY,
            width: isVertical ? bg._baseW : bg._baseW + half * 2,
            height: isVertical ? bg._baseH + half * 2 : bg._baseH,
            duration: GAP_SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onUpdate: () => {
                if (blur) blur.syncGeometry();
            },
        });
    }

    _end() {
        if (this._active) {
            this._active = false;
            this._bgSpread = 0;

            const actor = this._dockUI ? this._dockUI.actor : null;
            if (isActorAlive(actor)) {
                actor._isExternalDragging = false;
                actor._isDragging = false;
                actor._gapSpreadTarget = 0;
                actor._gapSpread = 0;
                getDockButtons(actor).forEach(btn => {
                    btn._gapTarget = 0;
                    btn._gapOffset = 0;
                    btn._gapSlideTarget = 0;
                });

                stopDragLoop(actor);
                resetMagnification(actor, 180, false);
            }
        }
    }

    _drop(source) {
        const app = this._externalApp(source);
        const { appManager } = this._dockUI;
        if (app === null || Settings.lockIcons || appManager.hasApp(app)) {
            this._end();
            return false;
        }

        const [x, y] = global.get_pointer();
        const spot = this._locate(x, y, this._isVertical());
        this._end();
        if (!spot) return false;

        const keys = [];
        let insertAt = 0;
        spot.slots.forEach((buttonIndex, slotIndex) => {
            const key = buttonKey(spot.buttons[buttonIndex]);
            if (key === null) return;
            if (slotIndex < spot.target) insertAt += 1;
            keys.push(key);
        });

        const appId = app.get_id();
        keys.splice(insertAt, 0, appId);

        appManager.addApp(app);
        saveDockLayout(this._dockUI, keys, appId);
        this._dockUI.queueRender('incremental', true);
        return true;
    }
}

export function ensureExternalDrop(dockUI) {
    if (dockUI._externalDrop) dockUI._externalDrop.attach();
    else dockUI._externalDrop = new ExternalDrop(dockUI);
    return dockUI._externalDrop;
}

export function destroyExternalDrop(dockUI) {
    if (dockUI && dockUI._externalDrop) {
        dockUI._externalDrop.destroy();
        dockUI._externalDrop = null;
    }
}