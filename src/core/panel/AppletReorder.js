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

import { moveWithSlide } from '../../ui/DragDrop.js';
import { isActorAlive, getBoxVertical } from '../Utils.js';


const LIFT_SCALE = 1.1;
const LIFT_OPACITY = 220;
const LIFT_MS = 120;
const SETTLE_MS = 180;

function isUnder(actor, x, y) {
    const [ax, ay] = actor.get_transformed_position();
    const [aw, ah] = actor.get_transformed_size();
    return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
}

function layoutCenter(box, actor, isVertical) {
    const [bx, by] = box.get_transformed_position();
    return isVertical ? by + actor.y + actor.height / 2 : bx + actor.x + actor.width / 2;
}

export default class AppletReorder {
    constructor(onReorder, dockUI = null) {
        this._onReorder = onReorder;
        this._dockUI = dockUI;
        this._boxes = new Set();
        this._drag = null;
    }

    watch(box, isMovable) {
        this._boxes.add(box);
        box.connectObject('captured-event', (_actor, event) => this._onPress(box, event, isMovable), this);
    }

    _onPress(box, event, isMovable) {
        if (this._drag || event.type() !== Clutter.EventType.BUTTON_PRESS || event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;
        if ((event.get_state() & Clutter.ModifierType.CONTROL_MASK) === 0) return Clutter.EVENT_PROPAGATE;

        const items = box.get_children().filter(child => isMovable(child) && child.visible);
        if (items.length < 2) return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const item = items.find(child => isUnder(child, x, y));
        if (!item) return Clutter.EVENT_PROPAGATE;

        const isVertical = getBoxVertical(box);
        this._drag = {
            box, item, isMovable, isVertical,
            prop: isVertical ? 'translation_y' : 'translation_x',
            grab: (isVertical ? y : x) - layoutCenter(box, item, isVertical),
        };

        if (this._dockUI && this._dockUI.autoHideManager) {
            this._dockUI.autoHideManager.show();
        }

        item.remove_all_transitions();
        item.set_pivot_point(0.5, 0.5);
        item.ease({
            scale_x: LIFT_SCALE,
            scale_y: LIFT_SCALE,
            opacity: LIFT_OPACITY,
            duration: LIFT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        global.stage.connectObject('captured-event', (_stage, stageEvent) => this._onDragEvent(stageEvent), this);
        return Clutter.EVENT_STOP;
    }

    _onDragEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            this._follow(event.get_coords());
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._finish(true);
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_STOP;
        return Clutter.EVENT_PROPAGATE;
    }

    _follow([x, y]) {
        const { box, item, isMovable, isVertical, prop, grab } = this._drag;
        if (!isActorAlive(box) || !isActorAlive(item)) {
            this._finish(false);
            return;
        }

        const pointer = (isVertical ? y : x) - grab;
        const others = box.get_children().filter(child => child !== item && isMovable(child) && child.visible);
        const slot = others.filter(child => layoutCenter(box, child, isVertical) < pointer).length;
        if (box.get_children().indexOf(item) !== slot) moveWithSlide(box, item, slot, isVertical);

        item[prop] = pointer - layoutCenter(box, item, isVertical);
    }

    _finish(isDropped) {
        global.stage.disconnectObject(this);
        const { item, prop } = this._drag;
        this._drag = null;

        if (isActorAlive(item)) {
            item.ease({
                [prop]: 0,
                scale_x: 1,
                scale_y: 1,
                opacity: 255,
                duration: SETTLE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
        if (isDropped) this._onReorder();
        if (this._dockUI && this._dockUI.autoHideManager) {
            this._dockUI.autoHideManager.scheduleCheck(150);
        }
    }

    release() {
        if (this._drag) this._finish(false);
        for (const box of this._boxes) {
            if (isActorAlive(box)) box.disconnectObject(this);
        }
        this._boxes.clear();
    }
}