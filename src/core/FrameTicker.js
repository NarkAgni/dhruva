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


export class FrameTicker {
    constructor(actor, callback) {
        this._callback = callback;
        this._timeline = new Clutter.Timeline({ actor, duration: 1000, repeat_count: -1 });
        this._timeline.connectObject('new-frame', () => {
            if (!this._callback()) this.stop();
        }, this);
    }

    setCallback(callback) {
        this._callback = callback;
    }

    start() {
        if (this._timeline && !this._timeline.is_playing()) this._timeline.start();
    }

    stop() {
        if (this._timeline && this._timeline.is_playing()) this._timeline.stop();
    }

    destroy() {
        if (this._timeline) {
            this._timeline.stop();
            this._timeline.disconnectObject(this);
            this._timeline = null;
        }
        this._callback = null;
    }
}