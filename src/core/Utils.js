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
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';

import { TimeoutTracker } from './TimeoutTracker.js';


const DEFAULT_RGB_CHANNEL = 20;
const DEFAULT_FALLBACK_COLOR = '#ffffff';
const SAMPLE_ICON_SIZE = 32;

const _disposedActors = new WeakSet();
const _iconColorCache = new Map();

const _ifaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
_ifaceSettings.connect('changed::icon-theme', () => {
    _iconColorCache.clear();
});

function _getActiveIconTheme() {
    return _ifaceSettings.get_string('icon-theme') || 'hicolor';

}

function _isFile(path) {
    return !!path && GLib.file_test(path, GLib.FileTest.EXISTS);
}

function _clampByte(v) {
    return Math.max(0, Math.min(255, Number.isFinite(v) ? v : 0));
}

function _toHex(c) {
    return _clampByte(c).toString(16).padStart(2, '0');
}

function _safeGetGiconFilePath(gicon) {
    if (!gicon || !gicon.get_file) return null;
    const file = gicon.get_file();
    return file ? file.get_path() : null;
}

function _resolvePathFromGicon(gicon) {
    if (!gicon) return null;

    const directPath = _safeGetGiconFilePath(gicon);
    if (_isFile(directPath)) return directPath;

    if (gicon.get_names) {
        const names = gicon.get_names() || [];
        for (const name of names) {
            const p = _findIconFilePath(name);
            if (p) return p;
        }
    }

    if (gicon.to_string) {
        const p = _findIconFilePath(gicon.to_string());
        if (p) return p;
    }

    return null;
}

export function markActorDisposed(actor) {
    if (actor) _disposedActors.add(actor);
}

export function isActorAlive(actor) {
    if (!actor || _disposedActors.has(actor)) return false;

    try {
        const str = GObject.Object.prototype.toString.call(actor);
        if (!str || str.includes('DISPOSED') || str.includes('finalized')) {
            _disposedActors.add(actor);
            return false;
        }

        const stage = Clutter.Actor.prototype.get_stage.call(actor);
        return !!stage;
    } catch (_e) {
        _disposedActors.add(actor);
        return false;
    }
}

export function captureActorRect(actor, fallbackWin = null) {
    if (isActorAlive(actor)) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(w) &&
            Number.isFinite(h) &&
            w > 0 &&
            h > 0
        ) {
            return { x, y, w, h };
        }
    }

    if (fallbackWin) {
        const frameRect = fallbackWin.get_frame_rect();
        if (frameRect) {
            return {
                x: frameRect.x + frameRect.width / 2 - 0.5,
                y: frameRect.y + frameRect.height / 2 - 0.5,
                w: 1,
                h: 1,
            };
        }
    }

    return { x: 0, y: 0, w: 1, h: 1 };
}

export function debounce(func, wait) {
    const timers = new TimeoutTracker();
    let timeoutId = null;

    const wrapper = function (...args) {
        if (timeoutId) timers.remove(timeoutId);

        timeoutId = timers.addTimeout(GLib.PRIORITY_DEFAULT, wait, () => {
            timeoutId = null;
            func.apply(this, args);
            return GLib.SOURCE_REMOVE;
        });
    };

    wrapper.cancel = () => {
        timers.destroy();
        timeoutId = null;
    };

    return wrapper;
}

export function hexToRgba(colorStr, alpha) {
    let r = DEFAULT_RGB_CHANNEL;
    let g = DEFAULT_RGB_CHANNEL;
    let b = DEFAULT_RGB_CHANNEL;

    if (typeof colorStr === 'string' && colorStr.startsWith('#')) {
        let hex = colorStr.slice(1).trim();
        if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');

        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
    } else if (typeof colorStr === 'string' && colorStr.startsWith('rgb')) {
        const parts = colorStr.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            r = _clampByte(parseFloat(parts[0]));
            g = _clampByte(parseFloat(parts[1]));
            b = _clampByte(parseFloat(parts[2]));
        }
    }

    const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function setBoxVertical(box, isVertical) {
    if (!box) return;
    if (box.set_orientation) {
        box.set_orientation(isVertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL);
    } else if (box.set_vertical) {
        box.set_vertical(isVertical);
    }
}

export function getBoxVertical(box) {
    if (!box) return false;
    if (box.get_orientation) {
        return box.get_orientation() === Clutter.Orientation.VERTICAL;
    }
    if (box.get_vertical) {
        return box.get_vertical();
    }
    return false;
}

export function clearIconColorCache() {
    _iconColorCache.clear();
}

function _findIconFilePath(iconName) {
    if (!iconName) return null;
    if (iconName.startsWith('/') && _isFile(iconName)) return iconName;

    const cleanName = iconName.replace(/\.(png|svg|symbolic)$/i, '');
    const activeTheme = _getActiveIconTheme();

    const roots = [];
    if (activeTheme && activeTheme !== 'hicolor') {
        roots.push(
            `${GLib.get_home_dir()}/.local/share/icons/${activeTheme}`,
            `${GLib.get_home_dir()}/.icons/${activeTheme}`,
            `/usr/share/icons/${activeTheme}`
        );
    }

    roots.push(
        `${GLib.get_home_dir()}/.local/share/icons/hicolor`,
        `/usr/share/icons/hicolor`,
        '/usr/share/pixmaps'
    );

    const searchRoots = [...new Set(roots)];
    const subDirs = [
        'scalable/apps',
        '256x256/apps',
        '128x128/apps',
        '64x64/apps',
        '48x48/apps',
        '32x32/apps',
        'scalable/places',
        '48x48/places',
        'apps',
        '',
    ];

    const extensions = ['.svg', '.png', ''];

    for (const root of searchRoots) {
        for (const sub of subDirs) {
            for (const ext of extensions) {
                const candidate = sub
                    ? `${root}/${sub}/${cleanName}${ext}`
                    : `${root}/${cleanName}${ext}`;

                if (_isFile(candidate)) return candidate;
            }
        }
    }

    return null;
}

export function extractIconDominantColor(iconSource, fallbackColor = DEFAULT_FALLBACK_COLOR) {
    if (!iconSource) return fallbackColor;

    const activeTheme = _getActiveIconTheme();
    let cacheKey = null;
    let resolvedPath = null;
    let giconTarget = null;

    if (typeof iconSource === 'string') {
        cacheKey = `${activeTheme}::${iconSource}`;
        resolvedPath = iconSource.startsWith('/') ? iconSource : _findIconFilePath(iconSource);
    } else if (iconSource.get_app_info) {
        const info = iconSource.get_app_info();
        const gicon = info ? info.get_icon() : null;
        const appId = iconSource.get_id ? iconSource.get_id() : 'app';

        cacheKey = `${activeTheme}::${appId}`;

        if (gicon) {
            giconTarget = gicon;
            resolvedPath = _resolvePathFromGicon(giconTarget);
        }

        if (!resolvedPath) {
            resolvedPath = _findIconFilePath(appId.replace(/\.desktop$/i, ''));
        }
    } else if (iconSource.gicon) {
        giconTarget = iconSource.gicon;
        resolvedPath = _resolvePathFromGicon(giconTarget);

        const giconString = (() => {
            return giconTarget?.to_string ? giconTarget.to_string() : 'gicon';

        })();

        cacheKey = `${activeTheme}::${resolvedPath || giconString}`;
    } else if (iconSource.icon_name) {
        cacheKey = `${activeTheme}::${iconSource.icon_name}`;
        resolvedPath = _findIconFilePath(iconSource.icon_name);
    }

    if (cacheKey && _iconColorCache.has(cacheKey)) {
        return _iconColorCache.get(cacheKey);
    }

    try {
        let pixbuf = null;

        if (_isFile(resolvedPath)) {
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                resolvedPath,
                SAMPLE_ICON_SIZE,
                SAMPLE_ICON_SIZE,
                true
            );
        }

        if (!pixbuf && giconTarget) {
            const p = _safeGetGiconFilePath(giconTarget);
            if (_isFile(p)) {
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                    p,
                    SAMPLE_ICON_SIZE,
                    SAMPLE_ICON_SIZE,
                    true
                );
            }
        }

        if (!pixbuf) return fallbackColor;

        const pixels = pixbuf.get_pixels();
        const channels = pixbuf.get_n_channels();
        const stride = pixbuf.get_rowstride();
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();

        const buckets = new Map();
        let totalColoredPixels = 0;

        for (let y = 0; y < height; y += 2) {
            for (let x = 0; x < width; x += 2) {
                const i = y * stride + x * channels;
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = channels >= 4 ? pixels[i + 3] : 255;

                if (a < 80) continue;

                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const delta = max - min;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                // Skip near-black and near-white pixels that usually carry less brand color signal.
                if (lum < 20 || lum > 245) continue;

                const qr = Math.round(r / 16) * 16;
                const qg = Math.round(g / 16) * 16;
                const qb = Math.round(b / 16) * 16;
                const key = `${qr},${qg},${qb}`;

                const saturation = max > 0 ? delta / max : 0;
                const weight = 1 + saturation * 4;

                if (!buckets.has(key)) {
                    buckets.set(key, { rSum: 0, gSum: 0, bSum: 0, count: 0, weight: 0 });
                }

                const bucket = buckets.get(key);
                bucket.rSum += r;
                bucket.gSum += g;
                bucket.bSum += b;
                bucket.count += 1;
                bucket.weight += weight;
                totalColoredPixels += 1;
            }
        }

        let best = null;
        let bestWeight = -1;
        const minCount = Math.max(2, totalColoredPixels * 0.03);

        for (const bucket of buckets.values()) {
            if (bucket.count >= minCount && bucket.weight > bestWeight) {
                bestWeight = bucket.weight;
                best = bucket;
            }
        }

        let hex = fallbackColor;
        if (best && best.count > 0) {
            const r = Math.round(best.rSum / best.count);
            const g = Math.round(best.gSum / best.count);
            const b = Math.round(best.bSum / best.count);
            hex = `#${_toHex(r)}${_toHex(g)}${_toHex(b)}`;
        }

        if (cacheKey) _iconColorCache.set(cacheKey, hex);
        return hex;
    } catch (_e) {
        return fallbackColor;
    }
}