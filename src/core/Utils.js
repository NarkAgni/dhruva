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


import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { TimeoutTracker } from './TimeoutTracker.js';


const _disposedActors = new WeakSet();

export function markActorDisposed(actor) {
    if (actor) _disposedActors.add(actor);
}

export function isActorAlive(actor) {
    if (!actor || _disposedActors.has(actor)) return false;

    try {
        const str = GObject.Object.prototype.toString.call(actor);
        if (!str || str.includes('DISPOSED') || str.includes('finalized')) {
            _disposedActors.add(actor);
            return false;
        }

        const stage = Clutter.Actor.prototype.get_stage.call(actor);
        if (!stage) {
            return false;
        }

        return true;
    } catch (_e) {
        _disposedActors.add(actor);
        return false;
    }
}

export function captureActorRect(actor, fallbackWin = null) {
    if (isActorAlive(actor)) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            return { x, y, w, h };
        }
    }

    if (fallbackWin) {
        const frameRect = fallbackWin.get_frame_rect();
        if (frameRect) {
            return {
                x: frameRect.x + frameRect.width / 2 - 0.5,
                y: frameRect.y + frameRect.height / 2 - 0.5,
                w: 1,
                h: 1
            };
        }
    }

    return { x: 0, y: 0, w: 1, h: 1 };
}

export function debounce(func, wait) {
    const timers = new TimeoutTracker();
    let timeoutId = null;

    const wrapper = function (...args) {
        if (timeoutId) timers.remove(timeoutId);

        timeoutId = timers.addTimeout(GLib.PRIORITY_DEFAULT, wait, () => {
            timeoutId = null;
            func.apply(this, args);
            return GLib.SOURCE_REMOVE;
        });
    };

    wrapper.cancel = () => {
        timers.destroy();
        timeoutId = null;
    };

    return wrapper;
}

export function hexToRgba(colorStr, alpha) {
    let r = 20;
    let g = 20;
    let b = 20;

    if (colorStr.startsWith('#')) {
        let hex = colorStr.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');

        r = parseInt(hex.substring(0, 2), 16) || 20;
        g = parseInt(hex.substring(2, 4), 16) || 20;
        b = parseInt(hex.substring(4, 6), 16) || 20;
    } else if (colorStr.startsWith('rgb')) {
        const parts = colorStr.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            r = parseInt(parts[0]);
            g = parseInt(parts[1]);
            b = parseInt(parts[2]);
        }
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function setBoxVertical(box, isVertical) {
    if (!box) return;
    if (box.set_orientation) {
        box.set_orientation(isVertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL);
    } else if (box.set_vertical) {
        box.set_vertical(isVertical);
    }
}

export function getBoxVertical(box) {
    if (!box) return false;
    if (box.get_orientation) {
        return box.get_orientation() === Clutter.Orientation.VERTICAL;
    }
    if (box.get_vertical) {
        return box.get_vertical();
    }
    return false;
}