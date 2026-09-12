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


class MagicLampBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return 480;
    }

    _getTiles() {
        return [42, 42];
    }

    _buildTarget() {
        const tailPx = 8;
        const cx = this._icon.x + this._icon.w / 2;
        const cy = this._icon.y + this._icon.h / 2;
        const insetX = this._icon.w * 0.4;
        const insetY = this._icon.h * 0.4;

        if (this._dockPos === 'BOTTOM') {
            this._icon.x = cx - tailPx / 2;
            this._icon.y = this._icon.y + insetY;
            this._icon.w = tailPx;
            this._icon.h = 0;
        } else if (this._dockPos === 'TOP') {
            this._icon.x = cx - tailPx / 2;
            this._icon.y = this._icon.y + this._icon.h - insetY;
            this._icon.w = tailPx;
            this._icon.h = 0;
        } else if (this._dockPos === 'LEFT') {
            this._icon.x = this._icon.x + this._icon.w - insetX;
            this._icon.y = cy - tailPx / 2;
            this._icon.w = 0;
            this._icon.h = tailPx;
        } else {
            this._icon.x = this._icon.x + insetX;
            this._icon.y = cy - tailPx / 2;
            this._icon.w = 0;
            this._icon.h = tailPx;
        }
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w;
        const wH = this._win.h;
        const icX = this._icon.x + this._icon.w / 2 - this._win.x;
        const icY = this._icon.y + this._icon.h / 2 - this._win.y;
        const curX = v.tx * wW;
        const curY = v.ty * wH;

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

        const sweep = 0.7;
        const localP = Math.max(0, Math.min(1, (p - distFromDock * sweep) / (1 - sweep)));
        const eased = localP * localP * (3 - 2 * localP);

        let newX = curX + (icX - curX) * eased;
        let newY = curY + (icY - curY) * eased;

        const ripple = Math.sin(eased * Math.PI) * (1 - eased) * 0.20;

        if (this._dockPos === 'BOTTOM' || this._dockPos === 'TOP') {
            newX += (curX - icX) * ripple;
        } else {
            newY += (curY - icY) * ripple;
        }

        v.x = newX;
        v.y = newY;
    }
}

export class MagicLampMinimize extends MagicLampBase {
    static {
        GObject.registerClass(this);
    }
}

export class MagicLampRestore extends MagicLampBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconPos, dockPos) {
        super._init(iconPos, dockPos, true);
    }
}