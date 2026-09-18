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


class VortexBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return 600;
    }

    _getTiles() {
        return [30, 30];
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w;
        const wH = this._win.h;
        const cx = wW / 2;
        const cy = wH / 2;
        const vx = (v.tx * wW) - cx;
        const vy = (v.ty * wH) - cy;

        const r = Math.sqrt(vx * vx + vy * vy);
        const maxR = Math.sqrt(cx * cx + cy * cy);
        const nr = r / maxR;

        const twistBase = p * Math.PI * 6;
        const angle = twistBase * (1.2 - nr * 0.6);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const scale = Math.pow(1 - p, 1.5);

        const rx = (vx * cosA - vy * sinA) * scale;
        const ry = (vx * sinA + vy * cosA) * scale;

        const moveP = p * p;
        const currentCenterX = cx + ((this._tgt.x - this._win.x) - cx) * moveP;
        const currentCenterY = cy + ((this._tgt.y - this._win.y) - cy) * moveP;

        v.x = currentCenterX + rx;
        v.y = currentCenterY + ry;
    }
}

export class VortexMinimize extends VortexBase {
    static {
        GObject.registerClass(this);
    }
}

export class VortexRestore extends VortexBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconPos, dockPos) {
        super._init(iconPos, dockPos, true);
    }
}