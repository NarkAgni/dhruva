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


import GObject from 'gi://GObject';

import { BaseDeformEffect } from './BaseDeformEffect.js';


class CRTBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return super._getDuration();
    }

    _getTiles() {
        return [16, 16];
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const [meshX, meshY] = this._meshScale(w, h);
        const cx = w / 2;
        const cy = h / 2;
        const vx = (v.tx * w) - cx;
        const vy = (v.ty * h) - cy;

        let scaleX = 1.0;
        let scaleY = 1.0;
        let moveP = 0.0;

        if (p < 0.4) {
            const p1 = p / 0.4;
            scaleY = 1.0 - (p1 * p1);
            scaleX = 1.0 + (p1 * 0.05);
        } else {
            const p2 = (p - 0.4) / 0.6;
            scaleY = 0.0;
            scaleX = 1.05 * (1.0 - p2);
            moveP = p2 * p2;
        }

        const rx = vx * scaleX;
        const ry = vy * scaleY;
        const targetX = (this._tgt.x - this._win.x) * meshX;
        const targetY = (this._tgt.y - this._win.y) * meshY;
        const currentCenterX = cx + (targetX - cx) * moveP;
        const currentCenterY = cy + (targetY - cy) * moveP;

        v.x = currentCenterX + rx;
        v.y = currentCenterY + ry;
    }
}

export class CRTMinimize extends CRTBase {
    static {
        GObject.registerClass(this);
    }
}

export class CRTRestore extends CRTBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconPos, dockPos) {
        super._init(iconPos, dockPos, true);
    }
}