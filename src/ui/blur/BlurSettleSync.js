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
 * Coalesces "re-sync after layout" requests into one deferred run.
 *
 * Transform signals (notify::x, notify::allocation, ...) can fire while
 * the dock is being rebuilt and before the next relayout, so geometry read
 * there may still reflect the previous allocation. Queueing a single run
 * for after the frame lets the blur pick up the final geometry.
 *
 * Kept free of GObject-Introspection imports so it stays unit-testable;
 * the caller supplies the scheduler (e.g. a Meta later) and its canceller.
 */
export class SettleSync {
    constructor(schedule, cancel, run) {
        this._schedule = schedule;
        this._cancel = cancel;
        this._run = run;
        this._id = 0;
    }

    get isPending() {
        return this._id !== 0;
    }

    queue() {
        if (this._id) return;
        this._id = this._schedule(() => {
            this._id = 0;
            this._run();
        });
    }

    cancel() {
        if (!this._id) return;
        this._cancel(this._id);
        this._id = 0;
    }
}
