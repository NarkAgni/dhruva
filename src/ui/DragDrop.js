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


import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { playTrashEffect } from './effects/TrashEffect.js';
import { resetMagnification, getDockButtons, getFixedSlots, startDragLoop, stopDragLoop, applyRealtimeFrame } from './Magnifier.js';


let lastSwapTime = 0;

export function applyIconFilter(btn) {
    const appBox = btn.get_child();
    if (!appBox) return;
    const icon = appBox.get_first_child();
    if (icon && icon.set_content_scaling_filters)
        icon.set_content_scaling_filters(1, 1);
}

function _setDragCursor() {
    try {
        if (typeof Meta.CursorShape !== 'undefined') {
            global.display.set_cursor(Meta.CursorShape.DND_IN_DRAG);
        } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DND_IN_DRAG !== undefined) {
            global.display.set_cursor(Meta.Cursor.DND_IN_DRAG);
        }
    } catch (e) { }
}

function _setDefaultCursor() {
    try {
        if (typeof Meta.CursorShape !== 'undefined') {
            global.display.set_cursor(Meta.CursorShape.DEFAULT);
        } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DEFAULT !== undefined) {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        }
    } catch (e) { }
}

export function setupDragAndDrop(btn, app, dockUI) {
    if (dockUI.settings.get_boolean('lock-icons')) return;
    if (app.is_module) return;

    if (!dockUI.boxActor._delegate) {
        dockUI.boxActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };
        dockUI.actor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };
    }
    if (dockUI.bgActor && !dockUI.bgActor._delegate) {
        dockUI.bgActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };
    }

    btn.connect('button-press-event', () => {
        btn._wasDragged = false;
        return Clutter.EVENT_PROPAGATE;
    });

    btn._delegate = {
        app,
        button: btn,
        getDragActor: () => {
            const iconSize = dockUI.settings.get_int('icon-size');
            const icon = app.create_icon_texture(iconSize + 16);
            icon.opacity = 255;
            return icon;
        },
        getDragActorSource: () => btn,
        handleDragDrop: () => true,
        acceptDrop: () => true,

        handleDragOver: (source) => {
            const mainActor = dockUI.actor;
            if (!source?.button || !source?.app) return DND.DragMotionResult.CONTINUE;

            const draggedBtn = source.button;
            const allBtns = getDockButtons(mainActor);
            const draggedIndex = allBtns.indexOf(draggedBtn);
            if (draggedIndex === -1) return DND.DragMotionResult.CONTINUE;

            const now = Date.now();
            if (now - lastSwapTime < 100) return DND.DragMotionResult.MOVE_DROP;

            const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
            const [px, py] = global.get_pointer();
            const [dx, dy] = mainActor.get_transformed_position();
            const localCursor = isVertical ? py - dy : px - dx;

            const slots = getFixedSlots(mainActor, isVertical, allBtns);
            if (!slots?.length) return DND.DragMotionResult.CONTINUE;

            let closestIndex = draggedIndex, minDiff = Infinity;
            for (let i = 0; i < allBtns.length; i++) {
                if (!allBtns[i]._delegate?.app || allBtns[i]._delegate.app.is_module) continue;

                const diff = Math.abs(slots[i] - localCursor);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIndex = i;
                }
            }

            if (closestIndex === draggedIndex) return DND.DragMotionResult.MOVE_DROP;

            const targetBtn = allBtns[closestIndex];
            const realBoxChildren = dockUI.boxActor.get_children();
            const realTargetIndex = realBoxChildren.indexOf(targetBtn);

            if (realTargetIndex !== -1) {
                dockUI.boxActor.set_child_at_index(draggedBtn, realTargetIndex);
            }
            lastSwapTime = now;

            const avgSlotWidth = slots.length > 1
                ? (slots[slots.length - 1] - slots[0]) / (slots.length - 1)
                : dockUI.settings.get_int('icon-size') + 8;

            const displaced = [];
            if (closestIndex > draggedIndex) {
                for (let k = draggedIndex + 1; k <= closestIndex; k++) displaced.push({ b: allBtns[k], offset: avgSlotWidth });
            } else {
                for (let k = closestIndex; k < draggedIndex; k++) displaced.push({ b: allBtns[k], offset: -avgSlotWidth });
            }

            displaced.forEach(({ b: dispBtn, offset }) => {
                dispBtn.remove_all_transitions();
                dispBtn._flipOffset = (dispBtn._flipOffset || 0) + offset;
                dispBtn._flipStartTime = now;
            });

            return DND.DragMotionResult.MOVE_DROP;
        }
    };

    const draggable = DND.makeDraggable(btn, { restoreOnSuccess: false });

    draggable.connect('drag-cancelled', () => {
        if (draggable._dragActor) draggable._dragActor.opacity = 0;
        const [px, py] = global.get_pointer();
        const [bx, by] = dockUI.boxActor.get_transformed_position();
        const [bw, bh] = dockUI.boxActor.get_transformed_size();
        const isOutside = px < bx - 50 || px > bx + bw + 50 || py < by - 50 || py > by + bh + 50;

        if (!isOutside && btn && typeof btn.is_destroyed === 'function' && !btn.is_destroyed()) {
            btn.opacity = 255;
        }
    });

    draggable.connect('drag-begin', () => {
        btn._wasDragged = true;
        btn.opacity = 0;
        const mainActor = dockUI.actor;
        mainActor._isDragging = true;
        _setDragCursor();

        const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
        const allBtns = getDockButtons(mainActor);

        mainActor._fixedSlots = null;
        getFixedSlots(mainActor, isVertical, allBtns);

        allBtns.forEach(b => {
            b.remove_all_transitions();
            b._flipOffset = 0;
            b._flipStartTime = null;
        });
        startDragLoop(mainActor, isVertical, dockUI.settings);
    });

    draggable.connect('drag-end', () => {
        const mainActor = dockUI.actor;
        mainActor._isDragging = false;
        mainActor._lastIconClickTime = Date.now();

        _setDefaultCursor();
        stopDragLoop(mainActor);

        if (draggable._dragActor && !draggable._dragActor.is_destroyed()) {
            draggable._dragActor.opacity = 0;
            draggable._dragActor.destroy();
        }

        const [px, py] = global.get_pointer();
        const [bx, by] = dockUI.boxActor.get_transformed_position();
        const [bw, bh] = dockUI.boxActor.get_transformed_size();
        const isOutside = px < bx - 50 || px > bx + bw + 50 || py < by - 50 || py > by + bh + 50;

        let appId = typeof app.get_id === 'function' ? app.get_id() : null;

        if (isOutside && appId) {
            try { dockUI.appManager.removeApp(app); } catch (_e) { }

            btn.opacity = 0;
            if (app.get_state() !== Shell.AppState.RUNNING) {
                playTrashEffect(app, px, py, dockUI.settings.get_int('icon-size'));
            }

            mainActor._lastIconClickTime = 0;
            dockUI._renderDock();
            resetMagnification(mainActor);
            mainActor._fixedSlots = null;
            return;
        }

        btn.opacity = 255;
        btn._wasDragged = false;
        const currentBtns = getDockButtons(mainActor);

        const favManager = dockUI.appManager.favManager;
        const currentFavIds = favManager.getFavoriteMap ? Object.keys(favManager.getFavoriteMap()) : favManager.getFavorites().map(a => a.get_id());
        const newOrder = [];
        currentBtns.forEach(b => {
            if (b._delegate?.app && !b._delegate.app.is_module && typeof b._delegate.app.get_id === 'function') {
                const id = b._delegate.app.get_id();
                if (currentFavIds.includes(id) && !newOrder.includes(id)) newOrder.push(id);
            }
        });
        if (typeof favManager.moveFavoriteToPos === 'function') {
            newOrder.forEach((id, pos) => {
                try { favManager.moveFavoriteToPos(id, pos); } catch (_e) { }
            });
        }

        const [dx, dy] = mainActor.get_transformed_position();
        const [dw, dh] = mainActor.get_transformed_size();
        const isInsideMain = px >= dx - 20 && px <= dx + dw + 20 && py >= dy - 20 && py <= dy + dh + 20;

        if (!isInsideMain) {
            currentBtns.forEach(b => {
                b._flipOffset = 0;
                b._flipStartTime = null;
            });
            resetMagnification(mainActor);
        } else {
            currentBtns.forEach(b => { b._flipOffset = 0; b._flipStartTime = null; });
            const isVert = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
            applyRealtimeFrame(mainActor, px, py, isVert, dockUI.settings, Date.now());
        }

        mainActor._fixedSlots = null;
    });
}