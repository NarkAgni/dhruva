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


import GdkPixbuf from 'gi://GdkPixbuf';


const MIN_ACCENT_CONTRAST = 3.0;
const LIGHTEN_STEP = 0.08;

function channelLuminance(value) {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
    return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readableAccent(accent, background) {
    let color = accent;
    for (let mix = LIGHTEN_STEP; contrastRatio(color, background) < MIN_ACCENT_CONTRAST && mix <= 1; mix += LIGHTEN_STEP) {
        color = accent.map(value => Math.round(value + (255 - value) * mix));
    }
    return color;
}

export function extractColorsFromPixbuf(pixbuf) {
    if (!pixbuf) return null;

    const scaled = pixbuf.scale_simple(32, 32, GdkPixbuf.InterpType.BILINEAR);
    if (!scaled) return null;

    const pixels = scaled.get_pixels();
    const nChannels = scaled.get_n_channels();
    const rowstride = scaled.get_rowstride();
    const width = scaled.get_width();
    const height = scaled.get_height();

    const buckets = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
    let totalR = 0, totalG = 0, totalB = 0, count = 0;

    for (let y = 0; y < height; y++) {
        const rowStart = y * rowstride;
        for (let x = 0; x < width; x++) {
            const idx = rowStart + (x * nChannels);
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];

            totalR += r; totalG += g; totalB += b;
            count++;

            const max = Math.max(r, g, b) / 255;
            const min = Math.min(r, g, b) / 255;
            const delta = max - min;

            let h = 0;
            if (delta > 0) {
                if (max === r / 255) h = ((g / 255 - b / 255) / delta) % 6;
                else if (max === g / 255) h = (b / 255 - r / 255) / delta + 2;
                else h = (r / 255 - g / 255) / delta + 4;
                h *= 60;
                if (h < 0) h += 360;
            }

            const s = max === 0 ? 0 : delta / max;
            const v = max;

            if (s < 0.20 || v < 0.15 || v > 0.95) continue;

            let weight = s * (1.0 - Math.abs(v - 0.6));
            const bIdx = Math.floor(h / 30) % 12;

            buckets[bIdx].weight += weight;
            buckets[bIdx].r += r * weight;
            buckets[bIdx].g += g * weight;
            buckets[bIdx].b += b * weight;
        }
    }

    let best = buckets.reduce((prev, curr) => (curr.weight > prev.weight ? curr : prev), buckets[0]);

    let accentR, accentG, accentB;
    if (best.weight > 1.0) {
        accentR = Math.round(best.r / best.weight);
        accentG = Math.round(best.g / best.weight);
        accentB = Math.round(best.b / best.weight);
    } else {
        accentR = Math.round(totalR / Math.max(1, count));
        accentG = Math.round(totalG / Math.max(1, count));
        accentB = Math.round(totalB / Math.max(1, count));
    }

    const background = [accentR, accentG, accentB].map(value => Math.round(value * 0.25));
    const [r, g, b] = readableAccent([accentR, accentG, accentB], background);

    return {
        accent: `rgb(${r}, ${g}, ${b})`,
        background: `rgba(${background[0]}, ${background[1]}, ${background[2]}, 0.88)`
    };
}