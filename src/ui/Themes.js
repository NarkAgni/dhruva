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


import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';


const WALLPAPER_SAMPLE_SIZE = 80;
const WALLPAPER_PIXEL_STEP = 4;
const DEFAULT_THEME_BG = { r: 30, g: 30, b: 40 };
const DEFAULT_THEME_RAW = { r: 90, g: 100, b: 130 };
const SLIDESHOW_IMAGE_RE = /<(?:file|from)>([\s\S]*?)<\/(?:file|from)>/;
const SLIDESHOW_SIZE_RE = /<size[^>]*>([^<]+)<\/size>/;

export const DockThemes = {
    default: {
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
        }
    },

    carbon: {
        name: 'Carbon',
        css: (cfg) => `background-color: rgba(18, 18, 20, ${cfg.opacity}); background-gradient-direction: none;`
    },

    nord: {
        name: 'Nord',
        css: (cfg) => `background-color: rgba(36, 41, 51, ${cfg.opacity}); background-gradient-direction: none;`
    },

    catppuccin: {
        name: 'Catppuccin Mocha',
        css: (cfg) => `background-color: rgba(30, 30, 46, ${cfg.opacity}); background-gradient-direction: none;`
    },

    gruvbox: {
        name: 'Gruvbox Dark',
        css: (cfg) => `background-color: rgba(29, 32, 33, ${cfg.opacity}); background-gradient-direction: none;`
    },

    ash: {
        name: 'Ash Glass',
        css: (cfg) => `background-color: rgba(220, 220, 230, ${cfg.opacity * 0.65}); background-gradient-direction: none;`
    },

    dracula: {
        name: 'Dracula',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(40, 42, 54, ${cfg.opacity}); background-gradient-end: rgba(68, 71, 90, ${cfg.opacity});`
    },

    'tokyo-night': {
        name: 'Tokyo Night',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(26, 27, 38, ${cfg.opacity}); background-gradient-end: rgba(36, 40, 59, ${cfg.opacity});`
    },

    aurora: {
        name: 'Aurora',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(11, 52, 58, ${cfg.opacity}); background-gradient-end: rgba(14, 90, 75, ${cfg.opacity});`
    },

    sunset: {
        name: 'Sunset',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: horizontal; background-gradient-start: rgba(30, 15, 40, ${cfg.opacity}); background-gradient-end: rgba(150, 50, 30, ${cfg.opacity});`
    },

    'slate-ocean': {
        name: 'Slate Ocean',
        css: (cfg) => `background-color: rgba(0, 0, 0, 0); background-gradient-direction: vertical; background-gradient-start: rgba(15, 32, 56, ${cfg.opacity}); background-gradient-end: rgba(28, 58, 90, ${cfg.opacity});`
    },

    chameleon: {
        name: 'Chameleon (Wallpaper Color)',
        css: (cfg) => {
            const c = (cfg.chameleonColor && cfg.chameleonColor.bg) || {
                r: 30,
                g: 30,
                b: 40
            };
            const r1 = c.r;
            const g1 = c.g;
            const b1 = c.b;
            const r2 = Math.max(0, Math.floor(r1 * 0.7));
            const g2 = Math.max(0, Math.floor(g1 * 0.7));
            const b2 = Math.max(0, Math.floor(b1 * 0.7));

            return `background-color: transparent; 
                    background-gradient-direction: vertical; 
                    background-gradient-start: rgba(${r1}, ${g1}, ${b1}, ${cfg.opacity}); 
                    background-gradient-end: rgba(${r2}, ${g2}, ${b2}, ${cfg.opacity});`;
        }
    }
};

function _rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
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
    return { h: h * 360, s, l };
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
        return { r: v, g: v, b: v };
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
        r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, h) * 255),
        b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
}

function _rgbToHex(r, g, b) {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function getChameleonAccentColor(rawR, rawG, rawB) {
    const { h, s } = _rgbToHsl(rawR, rawG, rawB);

    if (s < 0.05) return '#ffffff';

    const accentRgb = _hslToRgb(h, 0.85, 0.72);
    return _rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b);
}

function _getWallpaperUri() {
    const bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
    const interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
    const isDark = interfaceSettings.get_string('color-scheme') === 'prefer-dark';

    const preferred = bgSettings.get_string(isDark ? 'picture-uri-dark' : 'picture-uri');
    return preferred || bgSettings.get_string(isDark ? 'picture-uri' : 'picture-uri-dark');
}

function _imagePathFromSlideshow(contents) {
    const match = new TextDecoder().decode(contents).match(SLIDESHOW_IMAGE_RE);
    if (!match) return null;

    const sizeMatch = match[1].match(SLIDESHOW_SIZE_RE);
    const imagePath = (sizeMatch ? sizeMatch[1] : match[1]).trim();
    return imagePath || null;
}

function _dominantColorOf(pixbuf) {
    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    const channels = pixbuf.get_n_channels();
    const rowstride = pixbuf.get_rowstride();
    const pixels = pixbuf.get_pixels();

    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;

    for (let y = 0; y < h; y += WALLPAPER_PIXEL_STEP) {
        for (let x = 0; x < w; x += WALLPAPER_PIXEL_STEP) {
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

    if (count === 0) {
        return {
            bg: DEFAULT_THEME_BG,
            raw: DEFAULT_THEME_RAW
        };
    }

    const rawR = Math.floor(totalR / count);
    const rawG = Math.floor(totalG / count);
    const rawB = Math.floor(totalB / count);

    return {
        bg: { r: Math.floor(rawR * 0.55), g: Math.floor(rawG * 0.55), b: Math.floor(rawB * 0.55) },
        raw: { r: rawR, g: rawG, b: rawB }
    };
}

function _loadWallpaperSample(imagePath, cancellable, done) {
    Gio.File.new_for_path(imagePath).read_async(GLib.PRIORITY_LOW, cancellable, (file, readRes) => {
        let stream;
        try {
            stream = file.read_finish(readRes);
        } catch (e) {
            done(null, e);
            return;
        }

        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, WALLPAPER_SAMPLE_SIZE, WALLPAPER_SAMPLE_SIZE, false, cancellable, (_source, pixbufRes) => {
            stream.close_async(GLib.PRIORITY_LOW, null, () => {});
            try {
                done(GdkPixbuf.Pixbuf.new_from_stream_finish(pixbufRes), null);
            } catch (e) {
                done(null, e);
            }
        });
    });
}

export function extractWallpaperDominantColor(cancellable, callback) {
    const finish = (pixbuf, error) => {
        if (cancellable.is_cancelled()) return;
        if (error) console.warn(`[Dhruva] Could not read wallpaper colour: ${error.message}`);
        callback(pixbuf ? _dominantColorOf(pixbuf) : null);
    };

    const uri = _getWallpaperUri();
    const path = uri ? Gio.File.new_for_uri(uri).get_path() : null;
    if (!path) {
        finish(null, null);
        return;
    }

    if (!path.toLowerCase().endsWith('.xml')) {
        _loadWallpaperSample(path, cancellable, finish);
        return;
    }

    Gio.File.new_for_path(path).load_contents_async(cancellable, (file, res) => {
        let imagePath;
        try {
            const [, contents] = file.load_contents_finish(res);
            imagePath = _imagePathFromSlideshow(contents);
        } catch (e) {
            finish(null, e);
            return;
        }

        if (imagePath) _loadWallpaperSample(imagePath, cancellable, finish);
        else finish(null, null);
    });
}

export function applyDockTheme(bgActor, themeId, baseLayoutCss, customConfig) {
    if (!bgActor) return;

    const theme = DockThemes[themeId] || DockThemes['default'];

    if (bgActor.clear_effects) {
        bgActor.clear_effects();
    }

    const themeCss = theme.css(customConfig);
    if (bgActor.set_style) {
        bgActor.set_style(`${baseLayoutCss} ${themeCss}`);
    }
}