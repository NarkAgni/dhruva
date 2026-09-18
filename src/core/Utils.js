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


import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';

import { TimeoutTracker } from './TimeoutTracker.js';


const _disposedActors = new WeakSet();
const _iconColorCache = new Map();

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
        if (!stage) {
            return false;
        }

        return true;
    } catch (_e) {
        _disposedActors.add(actor);
        return false;
    }
}

export function captureActorRect(actor, fallbackWin = null) {
    if (isActorAlive(actor)) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
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
                h: 1
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
    let r = 20;
    let g = 20;
    let b = 20;

    if (colorStr.startsWith('#')) {
        let hex = colorStr.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');

        r = parseInt(hex.substring(0, 2), 16) || 20;
        g = parseInt(hex.substring(2, 4), 16) || 20;
        b = parseInt(hex.substring(4, 6), 16) || 20;
    } else if (colorStr.startsWith('rgb')) {
        const parts = colorStr.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            r = parseInt(parts[0]);
            g = parseInt(parts[1]);
            b = parseInt(parts[2]);
        }
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

function _findIconFilePath(iconName) {
    if (!iconName) return null;
    if (iconName.startsWith('/') && GLib.file_test(iconName, GLib.FileTest.EXISTS)) {
        return iconName;
    }

    const searchDirs = [
        '/usr/share/icons/hicolor/scalable/apps',
        '/usr/share/icons/hicolor/scalable/places',
        '/usr/share/icons/hicolor/48x48/apps',
        '/usr/share/icons/hicolor/48x48/places',
        '/usr/share/icons/Adwaita/scalable/places',
        '/usr/share/icons/Adwaita/48x48/places',
        '/usr/share/pixmaps',
        `${GLib.get_user_data_dir()}/icons/hicolor/scalable/apps`,
        `${GLib.get_user_data_dir()}/icons/hicolor/scalable/places`,
        `${GLib.get_user_data_dir()}/icons/hicolor/48x48/apps`,
    ];

    const extensions = ['.svg', '.png', ''];

    for (const dir of searchDirs) {
        for (const ext of extensions) {
            const candidate = `${dir}/${iconName}${ext}`;
            if (GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
                return candidate;
            }
        }
    }
    return null;
}

export function extractIconDominantColor(iconSource, fallbackColor = '#ffffff') {
    if (!iconSource) {
        return fallbackColor;
    }

    let actualSource = iconSource;
    if (actualSource.gicon) actualSource = actualSource.gicon;
    else if (actualSource.icon_name) actualSource = actualSource.icon_name;

    let cacheKey = null;
    if (typeof actualSource === 'string') {
        cacheKey = actualSource;
    } else if (actualSource.get_id) {
        cacheKey = actualSource.get_id();
    } else if (actualSource.get_names && actualSource.get_names().length > 0) {
        cacheKey = actualSource.get_names()[0];
    } else if (actualSource.to_string) {
        cacheKey = actualSource.to_string();
    }

    if (cacheKey && _iconColorCache.has(cacheKey)) {
        const cached = _iconColorCache.get(cacheKey);
        return cached;
    }

    try {
        let pixbuf = null;
        let resolvedPath = null;

        if (iconSource.get_app_info) {
            const info = iconSource.get_app_info();
            const gicon = info ? info.get_icon() : null;

            if (gicon) {
                if (gicon.get_file) {
                    resolvedPath = gicon.get_file().get_path();
                } else if (gicon.get_names) {
                    const names = gicon.get_names();
                    for (const name of names) {
                        resolvedPath = _findIconFilePath(name);
                        if (resolvedPath) break;
                    }
                } else if (gicon.to_string) {
                    resolvedPath = _findIconFilePath(gicon.to_string());
                }
            }
        } else if (typeof actualSource === 'string') {
            resolvedPath = _findIconFilePath(actualSource);
        } else if (actualSource.get_names) {
            for (const n of actualSource.get_names()) {
                resolvedPath = _findIconFilePath(n);
                if (resolvedPath) break;
            }
        }

        if (resolvedPath && GLib.file_test(resolvedPath, GLib.FileTest.EXISTS)) {
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(resolvedPath, 32, 32, true);
        } else {
            const info = iconSource.get_app_info ? iconSource.get_app_info() : null;
            const gicon = info ? info.get_icon() : null;
            if (gicon) {
                const file = gicon.get_file ? gicon.get_file() : null;
                if (file) {
                    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(file.get_path(), 32, 32, true);
                }
            }
        }

        if (!pixbuf) {
            if (cacheKey) _iconColorCache.set(cacheKey, fallbackColor);
            return fallbackColor;
        }

        const pixels = pixbuf.get_pixels();
        const nChannels = pixbuf.get_n_channels();
        const stride = pixbuf.get_rowstride();
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();

        let bestR = 255, bestG = 255, bestB = 255;
        let maxScore = -1;

        for (let y = 1; y < height - 1; y += 2) {
            for (let x = 1; x < width - 1; x += 2) {
                const idx = y * stride + x * nChannels;
                const r = pixels[idx];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];
                const a = nChannels >= 4 ? pixels[idx + 3] : 255;

                if (a < 80) continue;

                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const delta = max - min;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                if (lum < 25 || lum > 240 || delta < 20) continue;

                const saturation = delta / max;
                const score = saturation * (255 - Math.abs(128 - lum));

                if (score > maxScore) {
                    maxScore = score;
                    bestR = r;
                    bestG = g;
                    bestB = b;
                }
            }
        }

        let hex = fallbackColor;
        if (maxScore > 0) {
            const toHex = c => c.toString(16).padStart(2, '0');
            hex = `#${toHex(bestR)}${toHex(bestG)}${toHex(bestB)}`;
        }

        if (cacheKey) _iconColorCache.set(cacheKey, hex);
        return hex;
    } catch (e) {
        if (cacheKey) _iconColorCache.set(cacheKey, fallbackColor);
        return fallbackColor;
    }
}