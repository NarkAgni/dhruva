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


import St from 'gi://St';
import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import { PACKAGE_VERSION } from 'resource:///org/gnome/shell/misc/config.js';

import { BLUR_DECLARATIONS, BLUR_CODE } from './shaders.js';


const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split('.')[0], 10);
const USE_STATIC_SNIPPET = SHELL_MAJOR >= 51;

const FULL_FRAGMENT_SHADER = `
${BLUR_DECLARATIONS}

void main() {
${BLUR_CODE}
}
`;

let _staticSnippet = null;

function getStaticBlurSnippet() {
    if (!_staticSnippet) {
        _staticSnippet = Cogl.Snippet.new(
            Cogl.SnippetHook.FRAGMENT,
            BLUR_DECLARATIONS,
            null
        );
        _staticSnippet.set_replace(BLUR_CODE);
    }
    return _staticSnippet;
}

const BlurShaderBase = USE_STATIC_SNIPPET
    ? GObject.registerClass(
        class BlurShaderBase extends Clutter.ShaderEffect {
            vfunc_get_static_snippet() {
                return getStaticBlurSnippet();
            }
        })
    : Clutter.ShaderEffect;

export const BlurEffect = GObject.registerClass(
class BlurEffect extends BlurShaderBase {
    _init(params = {}) {
        super._init();

        if (!USE_STATIC_SNIPPET)
            this.set_shader_source(FULL_FRAGMENT_SHADER);

        const { direction = 0 } = params;
        this._direction = direction;
        this._chained_effect = direction === 0
            ? new BlurEffect({ direction: 1 })
            : null;

        this._cw = 400.0;
        this._ch = 80.0;
        this._mw = 400.0;
        this._mh = 80.0;

        this._radius = 20.0;
        this._blurIntensity = 24.0;
        this._vibrancy = 1.35;
        this._blurBrightness = 0.18;
        this._borderGlow = 0.55;
        this._highlightAngle = 45.0;
        this._tintR = 1.0;
        this._tintG = 1.0;
        this._tintB = 1.0;
        this._colorTintOpacity = 0.30;
        this._refraction = 0.0;

        this._pushAllUniforms();
    }

    _setFloatUniform(name, val) {
        const gval = new GObject.Value();
        gval.init(GObject.TYPE_FLOAT);
        gval.set_float(val);
        this.set_uniform_value(name, gval);
    }

    _setIntUniform(name, val) {
        const gval = new GObject.Value();
        gval.init(GObject.TYPE_INT);
        gval.set_int(val);
        this.set_uniform_value(name, gval);
    }

    _pushDimensionUniforms() {
        this._setFloatUniform('u_cw', this._cw);
        this._setFloatUniform('u_ch', this._ch);
        this._setFloatUniform('u_mw', this._mw);
        this._setFloatUniform('u_mh', this._mh);
    }

    _pushAllUniforms() {
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const sigma = Math.max(0.1, (Math.max(1.0, this._blurIntensity) * scaleFactor) / 2.0);

        this._setIntUniform('dir', this._direction);
        this._setFloatUniform('sigma', sigma);
        this._pushDimensionUniforms();
        this._setFloatUniform('u_r', Math.max(0.0, this._radius) * scaleFactor);
        this._setFloatUniform('u_vibrancy', Math.max(0.0, this._vibrancy));
        this._setFloatUniform('u_brightness', Math.min(Math.max(0.0, this._blurBrightness), 1.0));
        this._setFloatUniform('u_border_glow', Math.max(0.0, this._borderGlow));
        this._setFloatUniform('u_highlight_angle', this._highlightAngle);
        this._setFloatUniform('u_tint_r', this._tintR);
        this._setFloatUniform('u_tint_g', this._tintG);
        this._setFloatUniform('u_tint_b', this._tintB);
        this._setFloatUniform('u_color_tint_opacity', Math.min(Math.max(0.0, this._colorTintOpacity), 1.0));
        this._setFloatUniform('u_refraction', Math.max(0.0, this._refraction));

        this.queue_repaint();
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);

        if (this._direction !== 0 || !this._chained_effect) return;

        if (!actor) {
            const chainedActor = this._chained_effect.get_actor();
            if (chainedActor) {
                chainedActor.remove_effect(this._chained_effect);
            }
            return;
        }

        const chainedActor = this._chained_effect.get_actor();
        if (chainedActor !== actor) {
            if (chainedActor)
                chainedActor.remove_effect(this._chained_effect);
            actor.add_effect(this._chained_effect);
        }

        this._syncChained();
    }

    _syncChained() {
        this._chained_effect.setParams({
            radius: this._radius,
            blurIntensity: this._blurIntensity,
            vibrancy: this._vibrancy,
            blurBrightness: this._blurBrightness,
            borderGlow: this._borderGlow,
            highlightAngle: this._highlightAngle,
            tintColor: [this._tintR, this._tintG, this._tintB],
            colorTintOpacity: this._colorTintOpacity,
            refraction: this._refraction,
        });
        this._chained_effect.updateDimensions(this._cw, this._ch, this._mw, this._mh);
    }

    setParams(p = {}) {
        if (p.radius !== undefined) this._radius = Math.max(0.0, p.radius);
        if (p.blurIntensity !== undefined) this._blurIntensity = Math.max(1.0, p.blurIntensity);
        if (p.vibrancy !== undefined) this._vibrancy = Math.max(0.0, p.vibrancy);
        if (p.blurBrightness !== undefined) this._blurBrightness = Math.min(Math.max(0.0, p.blurBrightness), 1.0);
        if (p.borderGlow !== undefined) this._borderGlow = Math.max(0.0, p.borderGlow);
        if (p.highlightAngle !== undefined) this._highlightAngle = p.highlightAngle;
        if (p.tintColor !== undefined) [this._tintR, this._tintG, this._tintB] = p.tintColor;
        if (p.colorTintOpacity !== undefined) this._colorTintOpacity = Math.min(Math.max(0.0, p.colorTintOpacity), 1.0);
        if (p.refraction !== undefined) this._refraction = Math.max(0.0, p.refraction);

        this._pushAllUniforms();

        if (this._direction === 0)
            this._syncChained();
    }

    updateDimensions(cw, ch, mw, mh) {
        this._cw = cw;
        this._ch = ch;
        this._mw = mw;
        this._mh = mh;

        this._pushDimensionUniforms();
        this.queue_repaint();

        if (this._direction === 0)
            this._chained_effect.updateDimensions(cw, ch, mw, mh);
    }
});