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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const PUFF_COUNT = 9;
const PUFF_MIN_MS = 420;
const PUFF_EXTRA_MS = 160;
const PUFF_SPREAD = 0.9;
const PUFF_RISE = 0.35;
const ICON_POP_MS = 200;
const ICON_POP_SCALE = 1.25;

const _activeActors = new Set();


function track(actor) {
    Main.uiGroup.add_child(actor);
    _activeActors.add(actor);
}

function easeAndDispose(actor, params) {
    actor.ease({
        ...params,
        onStopped: () => {
            _activeActors.delete(actor);
            actor.destroy();
        },
    });
}

function spawnPuff(x, y, iconSize, index) {
    const size = Math.round(iconSize * (0.35 + Math.random() * 0.25));
    const shade = 215 + Math.round(Math.random() * 40);
    const puff = new St.Widget({
        style: `background-color: rgba(${shade}, ${shade}, ${shade}, 0.6); border-radius: ${size}px;`,
        width: size,
        height: size,
    });
    puff.set_pivot_point(0.5, 0.5);
    puff.set_position(x - size / 2, y - size / 2);
    puff.set_scale(0.4, 0.4);
    track(puff);

    const angle = (index / PUFF_COUNT) * Math.PI * 2 + Math.random() * 0.5;
    const distance = iconSize * PUFF_SPREAD * (0.6 + Math.random() * 0.4);
    const duration = PUFF_MIN_MS + Math.random() * PUFF_EXTRA_MS;

    easeAndDispose(puff, {
        translation_x: Math.cos(angle) * distance,
        translation_y: Math.sin(angle) * distance - iconSize * PUFF_RISE,
        scale_x: 1.6,
        scale_y: 1.6,
        opacity: 0,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
}

export function playTrashEffect(app, x, y, iconSize) {
    if (app) {
        const icon = app.create_icon_texture(iconSize);
        icon.set_size(iconSize, iconSize);
        icon.set_pivot_point(0.5, 0.5);
        icon.set_position(x - iconSize / 2, y - iconSize / 2);
        track(icon);

        easeAndDispose(icon, {
            scale_x: ICON_POP_SCALE,
            scale_y: ICON_POP_SCALE,
            opacity: 0,
            duration: ICON_POP_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    for (let i = 0; i < PUFF_COUNT; i++) spawnPuff(x, y, iconSize, i);
}

export function cleanupTrashEffects() {
    for (const actor of [..._activeActors]) actor.remove_all_transitions();
    _activeActors.clear();
}
