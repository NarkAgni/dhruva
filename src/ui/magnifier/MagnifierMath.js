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


import { isActorAlive } from '../../core/Utils.js';
import { Settings } from '../../core/SettingsManager.js';


export function easeOutCirc(t) {
    return Math.sqrt(1 - Math.pow(t - 1, 2));
}

export function getDockButtons(dockActor) {
    if (!isActorAlive(dockActor)) return [];

    const box = dockActor.boxActor || dockActor;
    if (!isActorAlive(box)) return [];

    const buttons = [];

    if (dockActor.gridBtn && isActorAlive(dockActor.gridBtn) && dockActor.gridBtn.get_parent() === dockActor) {
        buttons.push(dockActor.gridBtn);
    }

    box.get_children().forEach(c => {
        if (!isActorAlive(c) || !c.visible) return;
        const sClass = c.get_style_class_name ? c.get_style_class_name() : (c.style_class || '');
        if (
            sClass.includes('dock-app-button') ||
            sClass.includes('dock-module') ||
            sClass.includes('trash-module') ||
            sClass.includes('clock-module') ||
            sClass.includes('dock-separator') ||
            c._isFolder || c._isGridBtn || c._isMusicPill || c._delegate
        ) {
            buttons.push(c);
        }
    });

    if (dockActor.extractedClock && isActorAlive(dockActor.extractedClock) && dockActor.extractedClock.get_parent() === dockActor) {
        buttons.push(dockActor.extractedClock);
    }
    if (dockActor.extractedDesktop && isActorAlive(dockActor.extractedDesktop) && dockActor.extractedDesktop.get_parent() === dockActor) {
        buttons.push(dockActor.extractedDesktop);
    }

    return buttons;
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

export function isPointerWithinDockBounds(dockActor, px, py, isVertical, settings) {
    const [dx, dy] = dockActor.get_transformed_position();
    const [dw, dh] = dockActor.get_transformed_size();

    let boundsLeft = dx;
    let boundsRight = dx + dw;
    let boundsTop = dy;
    let boundsBottom = dy + dh;

    if (dockActor.bgActor) {
        const [bx, by] = dockActor.bgActor.get_transformed_position();
        const [bw, bh] = dockActor.bgActor.get_transformed_size();
        boundsLeft = Math.min(boundsLeft, bx);
        boundsRight = Math.max(boundsRight, bx + bw);
        boundsTop = Math.min(boundsTop, by);
        boundsBottom = Math.max(boundsBottom, by + bh);
    }

    const pos = settings ? (Settings.dockPosition || 'BOTTOM') : 'BOTTOM';

    const padLateral = 18;
    const padScreenEdge = 25;
    const padWindowEdge = 6;

    let padLeft = padLateral;
    let padRight = padLateral;
    let padTop = padLateral;
    let padBottom = padLateral;

    if (pos === 'BOTTOM') {
        padTop = padWindowEdge;
        padBottom = padScreenEdge;
    } else if (pos === 'TOP') {
        padTop = padScreenEdge;
        padBottom = padWindowEdge;
    } else if (pos === 'LEFT') {
        padLeft = padScreenEdge;
        padRight = padWindowEdge;
    } else if (pos === 'RIGHT') {
        padLeft = padWindowEdge;
        padRight = padScreenEdge;
    }

    return px >= (boundsLeft - padLeft) &&
           px <= (boundsRight + padRight) &&
           py >= (boundsTop - padTop) &&
           py <= (boundsBottom + padBottom);
}