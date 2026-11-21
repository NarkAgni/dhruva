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

/**
 * Settle logic for the dock background after a magnifier reset.
 *
 * Kept free of GObject-Introspection imports so it stays unit-testable
 * with plain GJS. The caller supplies the animation mode and duration.
 */

export const SETTLE_FLAG = '_isMagResetting';
export const SETTLE_TARGET_KEY = '_magSettleTarget';

function targetsEqual(a, b) {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Restart (or start) the settle ease that returns the background to its
 * base geometry after the magnifier reset. Called from updateLayout, which
 * fires on every applet allocation while the settle animation is running.
 *
 * Returns true when a new ease was started, false when an identical settle
 * is already in flight and starting another one would only reset the
 * animation progress (the visible "jump then recalculate" defect).
 */
export function settleBackgroundAfterReset(bg, x, y, width, height, hooks = {}) {
    const target = { x, y, width, height };
    const inFlight = bg[SETTLE_FLAG] === true;
    const previous = bg[SETTLE_TARGET_KEY];

    if (inFlight && previous && targetsEqual(previous, target))
        return false;

    bg[SETTLE_TARGET_KEY] = target;
    bg.ease({
        x,
        y,
        width,
        height,
        duration: hooks.duration,
        mode: hooks.mode,
        onUpdate: hooks.onUpdate,
        onStopped: () => {
            if (hooks.isActorAlive ? hooks.isActorAlive(bg) : true) {
                bg[SETTLE_FLAG] = false;
                bg[SETTLE_TARGET_KEY] = null;
            }
            if (hooks.onUpdate) hooks.onUpdate();
        },
    });
    bg[SETTLE_FLAG] = true;
    return true;
}
