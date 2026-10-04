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


export const BLUR_DECLARATIONS = `
    uniform sampler2D cogl_sampler;
    uniform float sigma;
    uniform int dir;
    uniform float u_cw;
    uniform float u_ch;
    uniform float u_mw;
    uniform float u_mh;
    uniform float u_r;
    uniform float u_brightness;
    uniform float u_vibrancy;
    uniform float u_border_glow;
    uniform float u_highlight_angle;
    uniform float u_tint_r;
    uniform float u_tint_g;
    uniform float u_tint_b;
    uniform float u_color_tint_opacity;

    float sdRoundedBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + vec2(r);
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
    }

    vec2 getBoxNormal(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        if (q.x > 0.0 || q.y > 0.0) {
            return sign(p) * normalize(max(q, vec2(0.0)));
        } else {
            float gx = step(q.y, q.x);
            return sign(p) * vec2(gx, 1.0 - gx);
        }
    }

    vec4 getTextureClamped(vec2 uv, float w, float h) {
        vec2 clampedUV = clamp(uv, vec2(2.0 / w, 2.0 / h), vec2(1.0 - 2.0 / w, 1.0 - 2.0 / h));
        return texture2D(cogl_sampler, clampedUV);
    }
`;

export const BLUR_CODE = `
    vec2 uv = cogl_tex_coord_in[0].st;

    float w = max(1.0, u_cw);
    float h = max(1.0, u_ch);

    vec2 direction = vec2(float(dir), 1.0 - float(dir));
    float pixel_step = (dir == 0) ? (1.0 / h) : (1.0 / w);

    vec3 gauss_coeff;
    gauss_coeff.x = 1.0 / (sqrt(2.0 * 3.14159265) * sigma);
    gauss_coeff.y = exp(-0.5 / (sigma * sigma));
    gauss_coeff.z = gauss_coeff.y * gauss_coeff.y;

    float total_weight = gauss_coeff.x;
    vec4 blurred = getTextureClamped(uv, w, h) * gauss_coeff.x;
    gauss_coeff.xy *= gauss_coeff.yz;

    int n_steps = int(ceil(1.5 * sigma)) * 2;
    for (int i = 1; i <= n_steps; i += 2) {
        float coeff_subtotal = gauss_coeff.x;
        gauss_coeff.xy *= gauss_coeff.yz;
        coeff_subtotal += gauss_coeff.x;

        float gauss_ratio = gauss_coeff.x / coeff_subtotal;
        float foffset = float(i) + gauss_ratio;
        vec2 offset = direction * foffset * pixel_step;

        blurred += getTextureClamped(uv + offset, w, h) * coeff_subtotal;
        blurred += getTextureClamped(uv - offset, w, h) * coeff_subtotal;

        total_weight += 2.0 * coeff_subtotal;
        gauss_coeff.xy *= gauss_coeff.yz;
    }
    blurred /= total_weight;

    if (dir != 0) {
        cogl_color_out = blurred;
        return;
    }

    vec2 p = (uv - 0.5) * vec2(w, h);
    vec2 halfBox = vec2(u_mw, u_mh) * 0.5;
    float sd = sdRoundedBox(p, halfBox, u_r);
    float mask = 1.0 - smoothstep(-0.5, 0.5, sd);

    if (mask <= 0.0) {
        cogl_color_out = vec4(0.0);
        return;
    }

    vec3 base = blurred.rgb;
    float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
    base = mix(vec3(lum), base, u_vibrancy);
    base += vec3(u_brightness * 0.18);

    vec3 tint = vec3(u_tint_r, u_tint_g, u_tint_b);
    float tintWeight = clamp(u_color_tint_opacity, 0.0, 1.0);
    base = mix(base, base * tint, tintWeight * 0.75);
    base = mix(base, tint, tintWeight * 0.40);

    if (u_border_glow > 0.01) {
        float rad = radians(u_highlight_angle);
        vec2 lightNormal = vec2(cos(rad), sin(rad));
        vec2 edgeNormal = getBoxNormal(p, halfBox, u_r);
        float dotVal = dot(edgeNormal, lightNormal);
        float primaryHighlight = pow(clamp(dotVal, 0.0, 1.0), 3.8);
        float oppositeHighlight = pow(clamp(-dotVal, 0.0, 1.0), 3.8) * 0.70;
        float rimIntensity = (primaryHighlight + oppositeHighlight) * u_border_glow;
        float edgeLine = smoothstep(-1.8, -0.2, sd) * (1.0 - smoothstep(-0.2, 0.5, sd));
        base += vec3(1.0) * (edgeLine * 2.2 * rimIntensity);
    }

    float edgeDamp = smoothstep(0.0, -2.0, sd);
    base *= mix(0.85, 1.0, edgeDamp);

    cogl_color_out = vec4(base, 1.0) * mask;
`;