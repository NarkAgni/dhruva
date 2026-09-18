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


class OrigamiBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return 600;
    }

    _getTiles() {
        return [32, 32];
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w;
        const wH = this._win.h;
        let tx = v.tx;
        let ty = v.ty;

        const f1 = Math.min(1, Math.max(0, p / 0.333));
        if (f1 > 0) {
            const a1 = f1 * Math.PI;
            if (tx > 0.5) {
                tx = 0.5 + (tx - 0.5) * Math.cos(a1);
                ty -= Math.sin(a1) * (v.tx - 0.5) * 0.4;
            }
        }

        const f2 = Math.min(1, Math.max(0, (p - 0.333) / 0.333));
        if (f2 > 0) {
            const a2 = f2 * Math.PI;
            if (ty > 0.5) {
                const oldTy = ty;
                ty = 0.5 + (ty - 0.5) * Math.cos(a2);
                tx += Math.sin(a2) * (oldTy - 0.5) * 0.4;
            }
        }

        const f3 = Math.min(1, Math.max(0, (p - 0.666) / 0.334));
        if (f3 > 0) {
            const a3 = f3 * Math.PI;
            if (tx < 0.25) {
                const oldTx = tx;
                tx = 0.25 + (tx - 0.25) * Math.cos(a3);
                ty -= Math.sin(a3) * (0.25 - oldTx) * 0.4;
            }
        }

        const curX = tx * wW;
        const curY = ty * wH;

        const paperCx = (0.5 - 0.125 * p) * wW;
        const paperCy = (0.5 - 0.25 * p) * wH;

        const moveP = Math.pow(p, 3);
        const globalScale = 1.0 - moveP;

        let finalX = paperCx + (curX - paperCx) * globalScale;
        let finalY = paperCy + (curY - paperCy) * globalScale;

        const tgtX = this._tgt.x - this._win.x;
        const tgtY = this._tgt.y - this._win.y;

        finalX += (tgtX - finalX) * moveP;
        finalY += (tgtY - finalY) * moveP;

        v.x = finalX;
        v.y = finalY;
    }
}

export class OrigamiMinimize extends OrigamiBase {
    static {
        GObject.registerClass(this);
    }
}

export class OrigamiRestore extends OrigamiBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconPos, dockPos) {
        super._init(iconPos, dockPos, true);
    }
}