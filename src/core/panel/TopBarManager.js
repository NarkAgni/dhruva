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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { NativeActorState } from './NativeActorState.js';


const OFFSCREEN_Y = -9999;

export default class TopBarManager {
    constructor() {
        this._state = null;
    }

    hide() {
        if (this._state) return;
        this._state = new NativeActorState();

        this._state.set(Main.panel, {
            opacity: 0,
            reactive: false,
            translation_y: OFFSCREEN_Y,
        });

        const panelBox = Main.layoutManager.panelBox;
        this._state.set(panelBox, {
            opacity: 0,
            reactive: false,
            translation_y: OFFSCREEN_Y,
        });
        this._state.setSize(panelBox, -1, 0);

        Main.layoutManager._queueUpdateRegions();
    }

    restore() {
        if (!this._state) return;
        this._state.restore();
        this._state = null;
        Main.layoutManager._queueUpdateRegions();
    }

    destroy() {
        this.restore();
    }
}