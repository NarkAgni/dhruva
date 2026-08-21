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


function isActorAlive(actor) {
    if (!actor) return false;
    return actor.visible !== undefined;
}

export function getDockButtons(dockActor) {
    if (!isActorAlive(dockActor)) return [];

    const box = dockActor.boxActor || dockActor;
    if (!isActorAlive(box)) return [];

    return box.get_children().filter(c => {
        if (!isActorAlive(c)) return false;
        if (c.get_parent && c.get_parent() === null) return false;

        if (c._isExternal || c._isModule) return true;
        const sClass = c.get_style_class_name ? c.get_style_class_name() : (c.style_class || '');
        return sClass.includes('dock-app-button') || 
               sClass.includes('dock-module') || 
               sClass.includes('trash-module') || 
               sClass.includes('clock-module') || 
               sClass.includes('dock-separator');
    });
}

export function getFixedSlots(dockActor, isVertical, btns) {
    const cached = dockActor ? dockActor._fixedSlots : null;
    const boxX = dockActor.boxActor ? dockActor.boxActor.x : 0;
    const boxY = dockActor.boxActor ? dockActor.boxActor.y : 0;

    if (cached && cached.count === btns.length) {
        let sameButtons = true;
        for (let i = 0; i < btns.length; i++) {
            if (cached.buttons[i] !== btns[i]) {
                sameButtons = false;
                break;
            }

            const b = btns[i];
            const livePos = isVertical ? (b.y + boxY) + b.height / 2 : (b.x + boxX) + b.width / 2;
            if (Math.abs(livePos - cached.centersByBtn[i]) > 2) {
                sameButtons = false;
                break;
            }
        }
        if (sameButtons) return cached;
    }

    const centersByBtn = btns.map(b => {
        const localX = b.x + boxX;
        const localY = b.y + boxY;
        return isVertical ? localY + b.height / 2 : localX + b.width / 2;
    });

    const ordered = centersByBtn
        .map((center, btnIndex) => ({ center, btnIndex }))
        .sort((a, b) => (a.center - b.center) || (a.btnIndex - b.btnIndex));

    const orderToBtn = ordered.map(item => item.btnIndex);
    const orderedSlots = ordered.map(item => item.center);
    const btnToOrder = new Array(btns.length);

    for (let orderIndex = 0; orderIndex < orderToBtn.length; orderIndex++) {
        btnToOrder[orderToBtn[orderIndex]] = orderIndex;
    }

    const model = {
        count: btns.length,
        buttons: btns.slice(),
        centersByBtn,
        orderedSlots,
        orderToBtn,
        btnToOrder,
    };

    if (dockActor) {
        dockActor._fixedSlots = model;
    }
    return model;
}

export function easeOutCirc(t) {
    return Math.sqrt(1 - Math.pow(t - 1, 2));
}

export class MagnifierMath {
    static applyMagnification(children, pointerX, pointerY, isVertical, maxZoomFactor, _nowMs) {
        if (!children || children.length === 0) return;

        const btns = children.filter(c => {
            if (!isActorAlive(c)) return false;
            const sClass = c.get_style_class_name ? c.get_style_class_name() : (c.style_class || '');
            return !sClass.includes('dock-separator');
        });

        if (btns.length === 0) return;

        btns.forEach(btn => {
            const [x, y] = btn.get_transformed_position();
            const w = btn.width || 48;
            const h = btn.height || 48;

            const center = isVertical ? (y + h / 2) : (x + w / 2);
            const cursor = isVertical ? pointerY : pointerX;

            const dist = Math.abs(cursor - center);
            const maxDistance = (isVertical ? h : w) * 2.5;

            let scale = 1.0;
            if (dist < maxDistance) {
                const norm = 1.0 - (dist / maxDistance);
                const factor = easeOutCirc(norm);
                scale = 1.0 + (maxZoomFactor - 1.0) * factor;
            }

            btn.scale_x = scale;
            btn.scale_y = scale;
        });
    }
}