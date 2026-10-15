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

import { Settings } from '../SettingsManager.js';
import { isActorAlive, getBoxVertical, setBoxVertical } from '../Utils.js';


export class NativeActorState {
    constructor() {
        this._records = [];
        this._trackedKeys = new Map();
        this._places = [];
        this._signalTargets = new Set();
    }

    track(target, key, read, write) {
        let keys = this._trackedKeys.get(target);
        if (!keys) {
            keys = new Set();
            this._trackedKeys.set(target, keys);
        }
        if (keys.has(key)) return;

        keys.add(key);
        this._records.push({ target, value: read(), write });
    }

    set(target, props) {
        for (const [prop, value] of Object.entries(props)) {
            this.track(target, prop, () => target[prop], original => { target[prop] = original; });
            target[prop] = value;
        }
    }

    setStyle(actor, style) {
        this.set(actor, { style });
    }

    setSize(actor, width, height) {
        for (const dim of ['width', 'height']) {
            for (const prop of [`min_${dim}_set`, `natural_${dim}_set`, `min_${dim}`, `natural_${dim}`])
                this.track(actor, prop, () => actor[prop], original => { actor[prop] = original; });
        }
        actor.set_size(width, height);
    }

    setVertical(box, isVertical) {
        this.track(box, 'vertical', () => getBoxVertical(box), original => setBoxVertical(box, original));
        setBoxVertical(box, isVertical);
    }

    setArrowSide(boxPointer, side) {
        this.track(boxPointer, 'arrowSide', () => boxPointer._arrowSide, original => boxPointer.updateArrowSide(original));
        boxPointer.updateArrowSide(side);
    }

    rememberPlace(actor) {
        const parent = actor.get_parent();
        if (!parent || this._places.some(place => place.actor === actor)) return;
        this._places.push({ actor, parent, next: actor.get_next_sibling(), index: parent.get_children().indexOf(actor) });
    }

    connect(target, ...args) {
        target.connectObject(...args, this);
        this._signalTargets.add(target);
    }

    restore() {
        for (const target of this._signalTargets) target.disconnectObject(this);
        this._signalTargets.clear();

        for (const record of this._records.reverse()) {
            if (isActorAlive(record.target)) record.write(record.value);
        }
        this._records = [];
        this._trackedKeys.clear();

        for (const place of this._places.reverse()) this._returnHome(place);
        this._places = [];
    }

    _returnHome({ actor, parent, next, index }) {
        if (!isActorAlive(actor) || !isActorAlive(parent)) return;

        const current = actor.get_parent();
        if (current === parent) return;
        if (current) current.remove_child(actor);

        if (next && next.get_parent() === parent) parent.insert_child_below(actor, next);
        else parent.insert_child_at_index(actor, Math.min(index, parent.get_n_children()));
    }
}


export function panelItemMetrics() {
    const iconSize = Settings.iconSize;
    return {
        height: iconSize + 4,
        radius: Math.max(6, Math.min(10, Math.round(iconSize * 0.18))),
    };
}

export function findPanelButton(root) {
    if (root.has_style_class_name('panel-button')) return root;
    for (const child of root.get_children()) {
        if (child.has_style_class_name && child.has_style_class_name('panel-button')) return child;
    }
    return null;
}

export function stylePanelItem(state, root, isSquare = false, isVertical = false) {
    const button = findPanelButton(root);
    if (!button) return;

    const { height, radius } = panelItemMetrics();
    if (isVertical) {
        state.setSize(button, -1, -1);
        state.setStyle(button, `min-width: ${height}px; padding: 6px 4px; border-radius: ${radius}px;`);
    } else {
        state.setSize(button, isSquare ? height : -1, height);
        state.setStyle(button, `min-height: ${height}px; padding: ${isSquare ? '0' : '0 8px'}; border-radius: ${radius}px;`);
    }

    const content = button.get_first_child();
    if (content) state.set(content, { x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
}