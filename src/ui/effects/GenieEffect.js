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


const BEND_END = 0.4;
const SLIDE_START = 0.18;
const TARGET_WIDTH_RATIO = 0.7;
const MIN_TARGET_WIDTH = 12;
const ALONG_TILES = 64;
const ACROSS_TILES = 4;

const clamp01 = t => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = t => t * t * (3 - 2 * t);
const easeInOutSine = t => 0.5 - Math.cos(Math.PI * t) / 2;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class MagicLampBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _isVertical() {
        return this._dockPos === 'BOTTOM' || this._dockPos === 'TOP';
    }

    _getTiles() {
        return this._isVertical() ? [ACROSS_TILES, ALONG_TILES] : [ALONG_TILES, ACROSS_TILES];
    }

    _buildTarget() {
        const { x: wx, y: wy, w, h } = this._win;
        const iconCenterX = this._icon.x + this._icon.w / 2 - wx;
        const iconCenterY = this._icon.y + this._icon.h / 2 - wy;
        const iconSpan = this._isVertical() ? this._icon.w : this._icon.h;

        this._halfTarget = Math.max(MIN_TARGET_WIDTH, iconSpan * TARGET_WIDTH_RATIO) / 2;

        switch (this._dockPos) {
            case 'TOP':
                this._reach = h - iconCenterY;
                this._center = iconCenterX;
                break;
            case 'LEFT':
                this._reach = w - iconCenterX;
                this._center = iconCenterY;
                break;
            case 'RIGHT':
                this._reach = iconCenterX;
                this._center = iconCenterY;
                break;
            default:
                this._reach = iconCenterY;
                this._center = iconCenterX;
                break;
        }
        this._reach = Math.max(1, this._reach);
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const t = clamp01(this.progress);
        const bend = easeInOutSine(clamp01(t / BEND_END));
        const slide = easeInOutCubic(clamp01((t - SLIDE_START) / (1 - SLIDE_START)));

        const isVertical = this._isVertical();
        const towardDock = this._dockPos === 'BOTTOM' || this._dockPos === 'RIGHT';
        const alongNorm = isVertical ? v.ty : v.tx;
        const across = isVertical ? v.tx : v.ty;
        const length = isVertical ? h : w;
        const span = isVertical ? w : h;

        // Window coordinates are logical; the deform mesh is not.
        const [meshX, meshY] = this._meshScale(w, h);
        const alongScale = isVertical ? meshY : meshX;
        const acrossScale = isVertical ? meshX : meshY;
        const reach = this._reach * alongScale;
        const center = this._center * acrossScale;
        const halfTarget = this._halfTarget * acrossScale;

        const fromFarEdge = (towardDock ? alongNorm : 1 - alongNorm) * length;
        const along = Math.min(reach, fromFarEdge + slide * reach);

        const pinch = bend * smoothstep(clamp01(along / reach));
        const low = lerp(0, center - halfTarget, pinch);
        const high = lerp(span, center + halfTarget, pinch);
        const acrossPos = low + across * (high - low);
        const alongPos = towardDock ? along : length - along;

        if (isVertical) {
            v.x = acrossPos;
            v.y = alongPos;
        } else {
            v.x = alongPos;
            v.y = acrossPos;
        }
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