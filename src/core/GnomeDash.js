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

import { NativeActorState } from './panel/NativeActorState.js';


const TRACKED_PROPS = [
    'opacity', 'reactive', 'visible',
    'min_width_set', 'natural_width_set', 'min_height_set', 'natural_height_set',
    'min_width', 'natural_width', 'min_height', 'natural_height',
];

export default class GnomeDash {
    constructor() {
        this._state = null;
    }

    get isTakenOver() {
        return this._state !== null;
    }

    takeover() {
        if (this._state) return;
        const dash = Main.overview.dash;
        this._state = new NativeActorState();

        for (const prop of TRACKED_PROPS)
            this._state.track(dash, prop, () => dash[prop], original => { dash[prop] = original; });

        const originalAdjust = dash._adjustIconSize;
        this._state.track(dash, '_adjustIconSize', () => null, () => delete dash._adjustIconSize);
        dash._adjustIconSize = function () {
            const firstItem = this._box.get_first_child();
            const firstIcon = firstItem ? (firstItem.child || firstItem) : null;
            if (firstIcon && !firstIcon.icon) return;
            originalAdjust.call(this);
        };

        dash.opacity = 0;
        dash.reactive = false;
    }

    release() {
        if (!this._state) return;
        this._state.restore();
        this._state = null;
    }
}
