/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';


export const DockThemes = {
    'default': {
        name: 'Custom (From Settings)',
        css: (cfg) => {
            if (cfg.useGradient) {
                return `background-color: transparent; 
                        background-gradient-direction: ${cfg.direction}; 
                        background-gradient-start: ${cfg.color1}; 
                        background-gradient-end: ${cfg.color2};`;
            }
            return `background-color: ${cfg.color1}; 
                    background-gradient-direction: none;`;
        },
    },


    'carbon': {
        name: 'Carbon',
        css: (cfg) => `background-color: rgba(18, 18, 20, ${cfg.opacity}); background-gradient-direction: none;`,
    },

    'nord': {
        name: 'Nord',
        css: (cfg) => `background-color: rgba(36, 41, 51, ${cfg.opacity}); background-gradient-direction: none;`,
    },

    'catppuccin': {
        name: 'Catppuccin Mocha',
        css: (cfg) => `background-color: rgba(30, 30, 46, ${cfg.opacity}); background-gradient-direction: none;`,
    },

    'gruvbox': {
        name: 'Gruvbox Dark',
        css: (cfg) => `background-color: rgba(29, 32, 33, ${cfg.opacity}); background-gradient-direction: none;`,
    },

    'ash': {
        name: 'Ash Glass',
        css: (cfg) => `background-color: rgba(220, 220, 230, ${cfg.opacity * 0.65}); background-gradient-direction: none;`,
    },


    'dracula': {
        name: 'Dracula',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(40, 42, 54, ${cfg.opacity}); background-gradient-end: rgba(68, 71, 90, ${cfg.opacity});`,
    },

    'tokyo-night': {
        name: 'Tokyo Night',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(26, 27, 38, ${cfg.opacity}); background-gradient-end: rgba(36, 40, 59, ${cfg.opacity});`,
    },

    'aurora': {
        name: 'Aurora',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(11, 52, 58, ${cfg.opacity}); background-gradient-end: rgba(14, 90, 75, ${cfg.opacity});`,
    },

    'sunset': {
        name: 'Sunset',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(30, 15, 40, ${cfg.opacity}); background-gradient-end: rgba(150, 50, 30, ${cfg.opacity});`,
    },

    'slate-ocean': {
        name: 'Slate Ocean',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: vertical; background-gradient-start: rgba(15, 32, 56, ${cfg.opacity}); background-gradient-end: rgba(28, 58, 90, ${cfg.opacity});`,
    },

    'chameleon': {
        name: 'Chameleon (Wallpaper Color)',
        css: (cfg) => {
            const c = (cfg.chameleonColor && cfg.chameleonColor.bg) || {
                r: 30,
                g: 30,
                b: 40
            };
            const r1 = c.r,
                g1 = c.g,
                b1 = c.b;
            const r2 = Math.max(0, Math.floor(r1 * 0.7));
            const g2 = Math.max(0, Math.floor(g1 * 0.7));
            const b2 = Math.max(0, Math.floor(b1 * 0.7));

            return `background-color: transparent; 
                    background-gradient-direction: vertical; 
                    background-gradient-start: rgba(${r1}, ${g1}, ${b1}, ${cfg.opacity}); 
                    background-gradient-end: rgba(${r2}, ${g2}, ${b2}, ${cfg.opacity});`;
        },
    },
};

function _rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0,
        s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }
    return {
        h: h * 360,
        s,
        l
    };
}

function _hslToRgb(h, s, l) {
    h /= 360;

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    if (s === 0) {
        const v = Math.round(l * 255);
        return {
            r: v,
            g: v,
            b: v
        };
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
        r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, h) * 255),
        b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
}

function _rgbToHex(r, g, b) {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function getChameleonAccentColor(rawR, rawG, rawB) {
    const {
        h,
        s
    } = _rgbToHsl(rawR, rawG, rawB);

    if (s < 0.05) return '#ffffff';

    const accentRgb = _hslToRgb(h, 0.85, 0.72);
    return _rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b);
}

export function extractWallpaperDominantColor() {
    try {
        const bgSettings = new Gio.Settings({
            schema: 'org.gnome.desktop.background'
        });

        let wallpaperUri = '';
        try {
            wallpaperUri = bgSettings.get_string('picture-uri-dark');
        } catch (e) {}

        if (!wallpaperUri) {
            try {
                wallpaperUri = bgSettings.get_string('picture-uri');
            } catch (e) {}
        }

        if (!wallpaperUri) return null;

        const file = Gio.File.new_for_uri(wallpaperUri);
        const path = file.get_path();
        if (!path) return null;

        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 80, 80, false);
        if (!pixbuf) return null;

        const w = pixbuf.get_width();
        const h = pixbuf.get_height();
        const channels = pixbuf.get_n_channels();
        const rowstride = pixbuf.get_rowstride();
        const pixels = pixbuf.get_pixels();

        let totalR = 0,
            totalG = 0,
            totalB = 0,
            count = 0;
        const step = 4;

        for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
                const idx = y * rowstride + x * channels;
                if (idx + 2 >= pixels.length) continue;

                const r = pixels[idx];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];

                const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                if (luminance < 15 || luminance > 240) continue;

                totalR += r;
                totalG += g;
                totalB += b;
                count++;
            }
        }

        const fallbackBg = {
            r: 30,
            g: 30,
            b: 40
        };
        const fallbackRaw = {
            r: 90,
            g: 100,
            b: 130
        };

        if (count === 0) return {
            bg: fallbackBg,
            raw: fallbackRaw
        };

        const rawR = Math.floor(totalR / count);
        const rawG = Math.floor(totalG / count);
        const rawB = Math.floor(totalB / count);

        const bgR = Math.floor(rawR * 0.55);
        const bgG = Math.floor(rawG * 0.55);
        const bgB = Math.floor(rawB * 0.55);

        return {
            bg: {
                r: bgR,
                g: bgG,
                b: bgB
            },
            raw: {
                r: rawR,
                g: rawG,
                b: rawB
            },
        };
    } catch (e) {
        console.error('[Dhruva Chameleon] Wallpaper color extract error:', e.message);
        return null;
    }
}

export function applyDockTheme(bgActor, themeId, baseLayoutCss, customConfig) {
    if (!bgActor) return;

    const theme = DockThemes[themeId] || DockThemes['default'];

    bgActor.clear_effects();

    const themeCss = theme.css(customConfig);
    bgActor.set_style(`${baseLayoutCss} ${themeCss}`);
}