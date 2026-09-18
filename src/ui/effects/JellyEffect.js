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


class JellyBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return 700;
    }

    _getTiles() {
        return [24, 24];
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

        const wobbleEnvelope = Math.sin(p * Math.PI);
        const freq = Math.PI * 8;
        const squashX = Math.sin(p * freq) * 0.25 * wobbleEnvelope;
        const squashY = Math.cos(p * freq) * 0.25 * wobbleEnvelope;
        const scale = 1.0 - Math.pow(p, 2);

        const rx = vx * scale * (1.0 + squashX);
        const ry = vy * scale * (1.0 + squashY);

        const bend = Math.sin(p * Math.PI) * 0.15;
        let dx = 0;
        let dy = 0;

        if (this._dockPos === 'BOTTOM') {
            dy = -Math.sin(v.ty * Math.PI) * wH * bend;
        } else if (this._dockPos === 'TOP') {
            dy = Math.sin(v.ty * Math.PI) * wH * bend;
        } else if (this._dockPos === 'LEFT') {
            dx = Math.sin(v.tx * Math.PI) * wW * bend;
        } else if (this._dockPos === 'RIGHT') {
            dx = -Math.sin(v.tx * Math.PI) * wW * bend;
        }

        const moveP = p * p * (3 - 2 * p);
        const currentCenterX = cx + ((this._tgt.x - this._win.x) - cx) * moveP;
        const currentCenterY = cy + ((this._tgt.y - this._win.y) - cy) * moveP;

        v.x = currentCenterX + rx + dx;
        v.y = currentCenterY + ry + dy;
    }
}

export class JellyMinimize extends JellyBase {
    static {
        GObject.registerClass(this);
    }
}

export class JellyRestore extends JellyBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconPos, dockPos) {
        super._init(iconPos, dockPos, true);
    }
}