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
    uniform float u_mx;
    uniform float u_my;
    uniform float u_r;
    uniform float u_brightness;
    uniform float u_vibrancy;
    uniform float u_border_glow;
    uniform float u_highlight_angle;
    uniform float u_tint_r;
    uniform float u_tint_g;
    uniform float u_tint_b;
    uniform float u_color_tint_opacity;
    uniform int u_arrow_side;
    uniform float u_arrow_pos;
    uniform float u_arrow_w;
    uniform float u_arrow_h;

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

    const int MAX_STEPS = 36;
    float stride = max(1.0, sigma / 12.0);
    float s = sigma / stride;

    vec3 gauss_coeff;
    gauss_coeff.x = 1.0 / (sqrt(2.0 * 3.14159265) * s);
    gauss_coeff.y = exp(-0.5 / (s * s));
    gauss_coeff.z = gauss_coeff.y * gauss_coeff.y;

    float total_weight = gauss_coeff.x;
    vec4 blurred = getTextureClamped(uv, w, h) * gauss_coeff.x;
    gauss_coeff.xy *= gauss_coeff.yz;

    int n_steps = int(ceil(1.5 * s)) * 2;
    for (int i = 1; i <= MAX_STEPS; i += 2) {
        if (i > n_steps) break;

        float coeff_subtotal = gauss_coeff.x;
        gauss_coeff.xy *= gauss_coeff.yz;
        coeff_subtotal += gauss_coeff.x;

        float gauss_ratio = gauss_coeff.x / coeff_subtotal;
        float foffset = (float(i) + gauss_ratio) * stride;
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

    vec2 px = uv * vec2(w, h);
    vec2 bodyMin = vec2(u_mx, u_my);
    vec2 bodyMax = bodyMin + vec2(u_mw, u_mh);
    if (u_arrow_side == 1) bodyMax.y -= u_arrow_h;
    else if (u_arrow_side == 2) bodyMin.y += u_arrow_h;
    else if (u_arrow_side == 3) bodyMin.x += u_arrow_h;
    else if (u_arrow_side == 4) bodyMax.x -= u_arrow_h;

    float arrowZone = 0.0;

    vec2 p = px - (bodyMin + bodyMax) * 0.5;
    vec2 halfBox = (bodyMax - bodyMin) * 0.5;
    float sd = sdRoundedBox(p, halfBox, u_r);
    float mask = 1.0 - smoothstep(-0.5, 0.5, sd);

    if (u_arrow_side > 0) {
        float across = (u_arrow_side == 1) ? px.y - bodyMax.y
                     : (u_arrow_side == 2) ? bodyMin.y - px.y
                     : (u_arrow_side == 3) ? bodyMin.x - px.x
                     : px.x - bodyMax.x;
        float along = (u_arrow_side <= 2) ? px.x - u_mx : px.y - u_my;
        float halfWidth = u_arrow_w * 0.5 * (1.0 - across / max(u_arrow_h, 1.0));
        float inside = clamp(halfWidth - abs(along - u_arrow_pos) + 0.5, 0.0, 1.0);
        float triangle = inside * step(-0.5, across) * step(across, u_arrow_h);
        mask = max(mask, triangle);

        float baseReach = clamp(u_arrow_w * 0.5 + 2.0 - abs(along - u_arrow_pos), 0.0, 1.0);
        arrowZone = max(triangle, baseReach * step(-3.0, across) * step(across, u_arrow_h));
    }

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
        float edgeLine = smoothstep(-1.8, -0.2, sd) * (1.0 - smoothstep(-0.2, 0.5, sd)) * (1.0 - arrowZone);
        base += vec3(1.0) * (edgeLine * 2.2 * rimIntensity);
    }

    float edgeDamp = max(smoothstep(0.0, -2.0, sd), arrowZone);
    base *= mix(0.85, 1.0, edgeDamp);

    float dither = fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453);
    base += vec3((dither - 0.5) / 255.0);

    cogl_color_out = vec4(base, 1.0) * mask;
`;