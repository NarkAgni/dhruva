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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';

import { clampByte } from './Color.js';
import { TimeoutTracker } from './TimeoutTracker.js';

export { hexToRgba } from './Color.js';


const SAMPLE_ICON_SIZE = 32;
const ICON_FILE_EXTENSION_RE = /\.(png|svg|symbolic)$/i;

let _disposedActors = null;
let _iconTheme = null;
let _iconColorCache = null;
let _pendingColors = null;
let _colorCancellable = null;

function _getDisposedActors() {
    if (!_disposedActors) _disposedActors = new WeakSet();
    return _disposedActors;
}

function _getIconTheme() {
    if (!_iconTheme) _iconTheme = new St.IconTheme();
    return _iconTheme;
}

function _getIconColorCache() {
    if (!_iconColorCache) _iconColorCache = new Map();
    return _iconColorCache;
}

function _getPendingColors() {
    if (!_pendingColors) _pendingColors = new Map();
    return _pendingColors;
}

function _getColorCancellable() {
    if (!_colorCancellable) _colorCancellable = new Gio.Cancellable();
    return _colorCancellable;
}

function _cancelColorLoads() {
    if (_colorCancellable) {
        _colorCancellable.cancel();
        _colorCancellable = null;
    }
    if (_pendingColors) _pendingColors.clear();
}

export function destroyUtils() {
    _cancelColorLoads();
    _pendingColors = null;
    _iconColorCache = null;
    _iconTheme = null;
    _disposedActors = null;
}

function _toHex(c) {
    return clampByte(c).toString(16).padStart(2, '0');
}

export function markActorDisposed(actor) {
    if (actor) _getDisposedActors().add(actor);
}

export function isActorAlive(actor) {
    const disposed = _getDisposedActors();
    if (!actor || disposed.has(actor)) return false;

    const str = GObject.Object.prototype.toString.call(actor);
    if (!str || str.includes('DISPOSED') || str.includes('finalized') || str.includes('disposed')) {
        disposed.add(actor);
        return false;
    }

    if (!actor.get_stage) {
        disposed.add(actor);
        return false;
    }

    return true;
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
    let timeoutId = 0;

    const wrapper = function (...args) {
        if (timeoutId) {
            timers.remove(timeoutId);
            timeoutId = 0;
        }

        timeoutId = timers.addTimeout(GLib.PRIORITY_DEFAULT, wait, () => {
            timeoutId = 0;
            func.apply(this, args);
            return GLib.SOURCE_REMOVE;
        });
    };

    wrapper.cancel = () => {
        if (timeoutId) {
            timers.remove(timeoutId);
            timeoutId = 0;
        }
        timers.destroy();
    };

    return wrapper;
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
    _cancelColorLoads();
    if (_iconColorCache) _iconColorCache.clear();
}

export function loadPixbufAtScale(path, size, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.File.new_for_path(path).read_async(GLib.PRIORITY_LOW, cancellable, (file, readRes) => {
            let stream;
            try {
                stream = file.read_finish(readRes);
            } catch (e) {
                reject(e);
                return;
            }

            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, size, size, true, cancellable, (_source, pixbufRes) => {
                stream.close_async(GLib.PRIORITY_LOW, null, () => {});
                try {
                    resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(pixbufRes));
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

function _lookupIconPath(gicon) {
    if (!gicon) return null;
    if (gicon.get_file) {
        const file = gicon.get_file();
        return file ? file.get_path() : null;
    }

    const info = _getIconTheme().lookup_by_gicon(gicon, SAMPLE_ICON_SIZE, 0);
    return info ? info.get_filename() : null;
}

function _lookupIconNamePath(iconName) {
    if (iconName.startsWith('/')) return iconName;
    return _lookupIconPath(Gio.ThemedIcon.new(iconName.replace(ICON_FILE_EXTENSION_RE, '')));
}

function _resolveIconSource(iconSource) {
    if (iconSource.charCodeAt && iconSource.startsWith) {
        return { cacheKey: iconSource, path: _lookupIconNamePath(iconSource) };
    }

    if (iconSource.get_app_info) {
        const appId = iconSource.get_id ? iconSource.get_id() : 'app';
        const info = iconSource.get_app_info();
        const path = _lookupIconPath(info ? info.get_icon() : null) ||
            _lookupIconNamePath(appId.replace(/\.desktop$/i, ''));
        return { cacheKey: appId, path };
    }

    if (iconSource.gicon) {
        const gicon = iconSource.gicon;
        const path = _lookupIconPath(gicon);
        return { cacheKey: path || gicon.to_string(), path };
    }

    if (iconSource.icon_name) {
        return { cacheKey: iconSource.icon_name, path: _lookupIconNamePath(iconSource.icon_name) };
    }

    return { cacheKey: null, path: null };
}

function _dominantColorOf(pixbuf) {
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

    if (!best) return null;

    const r = Math.round(best.rSum / best.count);
    const g = Math.round(best.gSum / best.count);
    const b = Math.round(best.bSum / best.count);
    return `#${_toHex(r)}${_toHex(g)}${_toHex(b)}`;
}

export function extractIconDominantColor(iconSource, fallbackColor, onReady) {
    if (!iconSource) return fallbackColor;

    const { cacheKey, path } = _resolveIconSource(iconSource);
    if (!cacheKey) return fallbackColor;

    const cache = _getIconColorCache();
    if (cache.has(cacheKey)) return cache.get(cacheKey) || fallbackColor;

    if (!path) {
        cache.set(cacheKey, null);
        return fallbackColor;
    }

    const pending = _getPendingColors();
    if (pending.has(cacheKey)) {
        pending.get(cacheKey).push(onReady);
        return fallbackColor;
    }
    pending.set(cacheKey, [onReady]);

    const cancellable = _getColorCancellable();
    loadPixbufAtScale(path, SAMPLE_ICON_SIZE, cancellable)
        .then(pixbuf => _dominantColorOf(pixbuf))
        .catch(() => null)
        .then(color => {
            if (cancellable.is_cancelled()) return;

            const callbacks = pending.get(cacheKey);
            pending.delete(cacheKey);
            _getIconColorCache().set(cacheKey, color);
            callbacks.forEach(callback => callback());
        });

    return fallbackColor;
}