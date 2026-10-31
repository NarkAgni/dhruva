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


import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { isActorAlive } from '../../core/Utils.js';


const SLIDE_MS = 200;


function isCtrlHeld() {
    const [, , mods] = global.get_pointer();
    return (mods & Clutter.ModifierType.CONTROL_MASK) !== 0;
}


export class GridReorder {
    constructor({ order, cell, commit, canGroup = () => false, group = () => { }, motion = () => { }, end = () => { } }) {
        this._order = order;
        this._cell = cell;
        this._commitOrder = commit;
        this._canGroup = canGroup;
        this._group = group;
        this._onDragMotion = motion;
        this._onDragEnd = end;
        this._draggables = [];
        this._monitor = null;
        this._dropTarget = null;
        this._reset();
    }

    get areaDelegate() {
        return {
            handleDragOver: source => (this._owns(source) ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.NO_DROP),
            acceptDrop: source => this._commit(source),
        };
    }

    makeDraggable(cell, key, dragActor, dragSource) {
        cell._delegate = {
            reorder: this,
            reorderKey: key,
            getDragActor: dragActor,
            getDragActorSource: () => dragSource,
            handleDragOver: source => (this._owns(source) ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.NO_DROP),
            acceptDrop: source => this._acceptDrop(source, key),
        };

        const draggable = DND.makeDraggable(cell);
        draggable.connectObject(
            'drag-begin', () => this._begin(key),
            'drag-end', () => this._end(),
            this
        );
        this._draggables.push(draggable);
    }

    _reset() {
        this._dragKey = null;
        this._slots = [];
        this._startIndex = -1;
        this._currentIndex = -1;
    }

    _owns(source) {
        return source.reorder === this && source.reorderKey === this._dragKey;
    }

    _begin(key) {
        this._dragKey = key;
        const order = this._order();
        this._slots = order.map(slotKey => {
            const cell = this._cell(slotKey);
            const [x, y] = cell.get_transformed_position();
            const [width, height] = cell.get_transformed_size();
            return { key: slotKey, x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
        });
        this._startIndex = order.indexOf(key);
        this._currentIndex = this._startIndex;
        this._cell(key).opacity = 0;

        this._monitor = {
            dragMotion: event => {
                this._onMotion(event.x, event.y);
                this._onDragMotion(event.x, event.y);
                return DND.DragMotionResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._monitor);
    }

    shiftSlots(dx, dy) {
        for (const slot of this._slots) {
            slot.x += dx;
            slot.cx += dx;
            slot.y += dy;
            slot.cy += dy;
        }
    }

    _slotAt(x, y) {
        return this._slots.findIndex(slot => x >= slot.x && x <= slot.x + slot.width && y >= slot.y && y <= slot.y + slot.height);
    }

    _closestSlot(x, y) {
        let closest = this._currentIndex;
        let best = Infinity;
        this._slots.forEach((slot, index) => {
            const distance = (x - slot.cx) ** 2 + (y - slot.cy) ** 2;
            if (distance < best) {
                best = distance;
                closest = index;
            }
        });
        return closest;
    }

    _setDropTarget(cell) {
        if (this._dropTarget === cell) return;
        if (isActorAlive(this._dropTarget)) this._dropTarget.remove_style_pseudo_class('drop');
        this._dropTarget = cell;
        if (cell) cell.add_style_pseudo_class('drop');
    }

    _onMotion(x, y) {
        const hit = this._slotAt(x, y);
        const targetKey = hit === -1 || hit === this._startIndex ? null : this._slots[hit].key;

        if (targetKey && isCtrlHeld() && this._canGroup(this._dragKey, targetKey)) {
            this._setDropTarget(this._cell(targetKey));
            this._shiftTo(this._startIndex);
            return;
        }

        this._setDropTarget(null);
        this._shiftTo(this._closestSlot(x, y));
    }

    _shiftTo(index) {
        if (index === this._currentIndex) return;
        this._currentIndex = index;

        const start = this._startIndex;
        this._slots.forEach((slot, i) => {
            if (i === start) return;
            let target = i;
            if (start < index && i > start && i <= index) target = i - 1;
            else if (start > index && i >= index && i < start) target = i + 1;

            const cell = this._cell(slot.key);
            const destination = this._slots[target];
            cell.remove_transition('translation-x');
            cell.remove_transition('translation-y');
            cell.ease({
                translation_x: destination.x - slot.x,
                translation_y: destination.y - slot.y,
                duration: SLIDE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        });
    }

    _end() {
        if (this._monitor) {
            DND.removeDragMonitor(this._monitor);
            this._monitor = null;
        }
        this._setDropTarget(null);
        for (const slot of this._slots) {
            const cell = this._cell(slot.key);
            if (!isActorAlive(cell)) continue;
            cell.opacity = 255;
            cell.ease({ translation_x: 0, translation_y: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }
        this._reset();
        this._onDragEnd();
    }

    _acceptDrop(source, key) {
        if (!this._owns(source)) return false;
        if (key !== this._dragKey && isCtrlHeld() && this._canGroup(this._dragKey, key)) {
            this._group(this._dragKey, key);
            return true;
        }
        return this._commit(source);
    }

    _commit(source) {
        if (!this._owns(source)) return false;
        if (this._currentIndex === this._startIndex) return true;

        const order = [...this._order()];
        order.splice(this._startIndex, 1);
        order.splice(this._currentIndex, 0, this._dragKey);
        this._commitOrder(order);
        return true;
    }

    destroy() {
        if (this._monitor) DND.removeDragMonitor(this._monitor);
        this._monitor = null;
        for (const draggable of this._draggables) draggable.disconnectObject(this);
        this._draggables = [];
    }
}