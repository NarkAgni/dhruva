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


function bezierCubicCalc(p1, p2, p3, p4, t) {
    const u = 1.0 - t;
    const w1 = u * u * u;
    const w2 = 3.0 * u * u * t;
    const w3 = 3.0 * u * t * t;
    const w4 = t * t * t;
    return w1 * p1 + w2 * p2 + w3 * p3 + w4 * p4;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

class MagicLampBase extends BaseDeformEffect {
    static {
        GObject.registerClass(this);
    }

    _getDuration() {
        return 420;
    }

    _getTiles() {
        return [48, 48];
    }

    _buildTarget() {
        this._tailW = Math.max(14, this._icon.w * 0.35);
        this._tailH = Math.max(14, this._icon.h * 0.35);

        this._targetCenterX = this._icon.x + this._icon.w * 0.5;
        this._targetCenterY = this._icon.y + this._icon.h * 0.5;

        if (this._dockPos === 'BOTTOM') {
            this._targetEdge = this._icon.y + this._icon.h;
        } else if (this._dockPos === 'TOP') {
            this._targetEdge = this._icon.y;
        } else if (this._dockPos === 'LEFT') {
            this._targetEdge = this._icon.x;
        } else {
            this._targetEdge = this._icon.x + this._icon.w;
        }
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const aAnimT = Math.max(0.0, Math.min(1.0, this.progress));
        const wW = this._win.w;
        const wH = this._win.h;

        const icCenterX = this._targetCenterX - this._win.x;
        const icCenterY = this._targetCenterY - this._win.y;

        const isHorizontal = (this._dockPos === 'LEFT' || this._dockPos === 'RIGHT');

        let p00X, p00Y, p10X, p10Y, p01X, p01Y, p11X, p11Y;
        let startRatio = 0.0;
        let endRatio = 1.0;

        if (!isHorizontal) {
            const isBottom = (this._dockPos === 'BOTTOM');
            
            const tgtHalfW = this._tailW * 0.5;
            const tgtX0 = icCenterX - tgtHalfW;
            const tgtX1 = icCenterX + tgtHalfW;
            const tgtY = this._targetEdge - this._win.y;

            const ratio = (aAnimT < 0.3) ? (aAnimT / 0.3) : 1.0;
            if (aAnimT > 0.25) {
                startRatio = (aAnimT - 0.25) / (1.0 - 0.25);
            }
            endRatio = 1.0;

            if (isBottom) {
                p00X = 0;   p00Y = 0;
                p10X = wW;  p10Y = 0;
                p01X = lerp(0, tgtX0, ratio);   p01Y = lerp(wH, tgtY, ratio);
                p11X = lerp(wW, tgtX1, ratio);  p11Y = lerp(wH, tgtY, ratio);
            } else {
                p00X = 0;   p00Y = wH;
                p10X = wW;  p10Y = wH;
                p01X = lerp(0, tgtX0, ratio);   p01Y = lerp(0, tgtY, ratio);
                p11X = lerp(wW, tgtX1, ratio);  p11Y = lerp(0, tgtY, ratio);
            }

            const rowFactor = isBottom ? v.ty : (1.0 - v.ty);
            const patchParam = startRatio + (endRatio - startRatio) * rowFactor;

            const lxC1 = p00X;
            const lxC2 = p01X;
            const rxC1 = p10X;
            const rxC2 = p11X;

            const lpt = bezierCubicCalc(p00X, lxC1, lxC2, p01X, patchParam);
            const rpt = bezierCubicCalc(p10X, rxC1, rxC2, p11X, patchParam);

            const u = v.tx;
            v.x = lpt + (rpt - lpt) * u;

            const topY = bezierCubicCalc(p00Y, p00Y, p10Y, p10Y, u);
            const botY = bezierCubicCalc(p01Y, p01Y, p11Y, p11Y, u);
            v.y = topY + (botY - topY) * patchParam;

        } else {
            const isRight = (this._dockPos === 'RIGHT');
            
            const tgtHalfH = this._tailH * 0.5;
            const tgtY0 = icCenterY - tgtHalfH;
            const tgtY1 = icCenterY + tgtHalfH;
            const tgtX = this._targetEdge - this._win.x;

            const ratio = (aAnimT < 0.3) ? (aAnimT / 0.3) : 1.0;
            if (aAnimT > 0.25) {
                startRatio = (aAnimT - 0.25) / (1.0 - 0.25);
            }
            endRatio = 1.0;

            if (isRight) {
                p00X = 0;   p00Y = 0;
                p01X = 0;   p01Y = wH;
                p10X = lerp(wW, tgtX, ratio);  p10Y = lerp(0, tgtY0, ratio);
                p11X = lerp(wW, tgtX, ratio);  p11Y = lerp(wH, tgtY1, ratio);
            } else {
                p00X = wW;  p00Y = 0;
                p01X = wW;  p01Y = wH;
                p10X = lerp(0, tgtX, ratio);   p10Y = lerp(0, tgtY0, ratio);
                p11X = lerp(0, tgtX, ratio);   p11Y = lerp(wH, tgtY1, ratio);
            }

            const colFactor = isRight ? v.tx : (1.0 - v.tx);
            const patchParam = startRatio + (endRatio - startRatio) * colFactor;

            const tpt = bezierCubicCalc(p00Y, p00Y, p10Y, p10Y, patchParam);
            const bpt = bezierCubicCalc(p01Y, p01Y, p11Y, p11Y, patchParam);

            const vertU = v.ty;
            v.y = tpt + (bpt - tpt) * vertU;

            const leftX = bezierCubicCalc(p00X, p00X, p01X, p01X, vertU);
            const rightX = bezierCubicCalc(p10X, p10X, p11X, p11X, vertU);
            v.x = leftX + (rightX - leftX) * patchParam;
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