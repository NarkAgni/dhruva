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


const WAVE_INTENSITY = 0.25;

class SnakeBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return 520;
    }

    _getTiles() {
        return [30, 30];
    }

    _buildTarget() {
        const cx = this._icon.x + this._icon.w / 2;
        const cy = this._icon.y + this._icon.h / 2;
        const insetX = this._icon.w * 0.4;
        const insetY = this._icon.h * 0.4;

        if (this._dockPos === 'BOTTOM') {
            this._tgt = { x: cx, y: this._icon.y + insetY };
        } else if (this._dockPos === 'TOP') {
            this._tgt = { x: cx, y: this._icon.y + this._icon.h - insetY };
        } else if (this._dockPos === 'LEFT') {
            this._tgt = { x: this._icon.x + this._icon.w - insetX, y: cy };
        } else {
            this._tgt = { x: this._icon.x + insetX, y: cy };
        }
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w;
        const wH = this._win.h;
        const curX = v.tx * wW;
        const curY = v.ty * wH;
        const tgtX = this._tgt.x - this._win.x;
        const tgtY = this._tgt.y - this._win.y;

        let distFromDock;
        if (this._dockPos === 'BOTTOM') {
            distFromDock = 1 - v.ty;
        } else if (this._dockPos === 'TOP') {
            distFromDock = v.ty;
        } else if (this._dockPos === 'LEFT') {
            distFromDock = v.tx;
        } else {
            distFromDock = 1 - v.tx;
        }

        const sweep = 0.55;
        const localP = Math.max(0, Math.min(1, (p - distFromDock * sweep) / (1 - sweep)));
        const eased = localP * localP * (3 - 2 * localP);

        let newX = curX + (tgtX - curX) * eased;
        let newY = curY + (tgtY - curY) * eased;

        const waveAmp = (this._dockPos === 'BOTTOM' || this._dockPos === 'TOP')
            ? wW * WAVE_INTENSITY
            : wH * WAVE_INTENSITY;

        if (this._dockPos === 'BOTTOM' || this._dockPos === 'TOP') {
            const axisT = (this._dockPos === 'BOTTOM') ? (1 - v.ty) : v.ty;
            const phase = axisT * Math.PI * 4;
            newX += Math.sin(phase) * waveAmp * p * (1 - eased);
        } else {
            const axisT = (this._dockPos === 'RIGHT') ? (1 - v.tx) : v.tx;
            const phase = axisT * Math.PI * 4;
            newY += Math.sin(phase) * waveAmp * p * (1 - eased);
        }

        v.x = newX;
        v.y = newY;
    }
}

export class SnakeMinimize extends SnakeBase {
    static {
        GObject.registerClass(this);
    }
}

export class SnakeRestore extends SnakeBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconScreenPos, dockPos) {
        super._init(iconScreenPos, dockPos, true);
    }
}