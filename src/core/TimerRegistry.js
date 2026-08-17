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


export class TimerRegistry {
    constructor() {
        this._timers = new Set();
        this._signals = new Map();
    }

    addTimeout(priority, interval, callback) {
        let timerId = null;
        timerId = GLib.timeout_add(priority, interval, () => {
            const res = callback();
            if (res === GLib.SOURCE_REMOVE && timerId !== null) {
                this._timers.delete(timerId);
            }
            return res;
        });
        this._timers.add(timerId);
        return timerId;
    }

    addIdle(priority, callback) {
        let timerId = null;
        timerId = GLib.idle_add(priority, () => {
            const res = callback();
            if (res === GLib.SOURCE_REMOVE && timerId !== null) {
                this._timers.delete(timerId);
            }
            return res;
        });
        this._timers.add(timerId);
        return timerId;
    }

    remove(timerId) {
        if (!timerId) return;
        if (this._timers && this._timers.has(timerId)) {
            GLib.source_remove(timerId);
            this._timers.delete(timerId);
        }
    }

    connectSignal(target, signalName, callback) {
        if (!target || typeof target.connect !== 'function') return null;
        try {
            const signalId = target.connect(signalName, callback);
            if (!this._signals.has(target)) {
                this._signals.set(target, []);
            }
            this._signals.get(target).push(signalId);
            return signalId;
        } catch (_e) {
            return null;
        }
    }

    disconnectTarget(target) {
        if (!target || !this._signals || !this._signals.has(target)) return;
        const list = this._signals.get(target);
        list.forEach(id => {
            try { target.disconnect(id); } catch (_e) {}
        });
        this._signals.delete(target);
    }

    destroy() {
        if (this._timers) {
            for (const timerId of this._timers) {
                try { GLib.source_remove(timerId); } catch (_e) {}
            }
            this._timers.clear();
        }

        if (this._signals) {
            for (const [target, signalIds] of this._signals.entries()) {
                signalIds.forEach(id => {
                    try { target.disconnect(id); } catch (_e) {}
                });
            }
            this._signals.clear();
        }
    }
}