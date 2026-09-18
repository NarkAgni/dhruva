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


export class TimeoutTracker {
    constructor() {
        this._sources = new Set();
        this._destroyed = false;
    }

    addTimeout(priority, interval, callback) {
        if (this._destroyed) return 0;
        let id = 0;
        id = GLib.timeout_add(priority, interval, () => {
            if (this._destroyed) {
                this._sources.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            const result = callback();
            if (result === GLib.SOURCE_REMOVE || result === false) {
                this._sources.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._sources.add(id);
        return id;
    }

    addIdle(priority, callback) {
        if (this._destroyed) return 0;
        let id = 0;
        id = GLib.idle_add(priority, () => {
            if (this._destroyed) {
                this._sources.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            const result = callback();
            if (result === GLib.SOURCE_REMOVE || result === false) {
                this._sources.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._sources.add(id);
        return id;
    }

    remove(id) {
        if (!id) return;
        if (this._sources.has(id)) {
            GLib.source_remove(id);
            this._sources.delete(id);
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._sources.forEach(id => {
            if (id) {
                GLib.source_remove(id);
            }
        });
        this._sources.clear();
    }
}