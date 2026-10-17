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
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

import { userCacheDir, lyricsCachePath } from '../../../core/DataPaths.js';


Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.File.prototype, 'load_bytes_async', 'load_bytes_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const MAX_CACHED_SONGS = 300;

const PARENS_RE = /\s*\(.*?\)\s*/g;
const BRACKETS_RE = /\s*\[.*?\]\s*/g;


export class LyricsClient {
    constructor() {
        this._httpSession = new Soup.Session();
        this._httpSession.timeout = 6;
        this._httpSession.user_agent = 'Mozilla/5.0 (X11; Linux x86_64)';

        GLib.mkdir_with_parents(userCacheDir(), 0o755);
        this._cacheFilePath = lyricsCachePath();

        this._cache = new Map();
        this._loadDiskCache().catch(() => { });
    }

    async _loadDiskCache() {
        const file = Gio.File.new_for_path(this._cacheFilePath);
        if (file.query_exists(null)) {
            const loadResult = await file.load_bytes_async(null);
            const bytes = loadResult ? loadResult[0] : null;
            if (bytes) {
                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (data && !Array.isArray(data)) {
                    for (const [k, v] of Object.entries(data)) {
                        this._cache.set(k, v);
                    }
                }
            }
        }
    }

    _remember(key, lyrics) {
        this._cache.delete(key);
        this._cache.set(key, lyrics);
        for (const oldKey of this._cache.keys()) {
            if (this._cache.size <= MAX_CACHED_SONGS) break;
            this._cache.delete(oldKey);
        }
        this._saveDiskCache();
    }

    _saveDiskCache() {
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(Object.fromEntries(this._cache))));
        Gio.File.new_for_path(this._cacheFilePath)
            .replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null)
            .catch(() => { });
    }

    async getLyrics(title, artist, durationSec) {
        if (!title) return null;

        const cleanTitle = title
            .replace(PARENS_RE, ' ')
            .replace(BRACKETS_RE, ' ')
            .replace(/-.*/, '')
            .trim();

        const cleanArtist = (artist || '')
            .split(',')[0]
            .replace(PARENS_RE, ' ')
            .trim();

        const cacheKey = `${cleanTitle.toLowerCase()}::${cleanArtist.toLowerCase()}`;
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        let query = `track_name=${encodeURIComponent(cleanTitle)}`;
        if (cleanArtist && cleanArtist !== 'Unknown Artist') {
            query += `&artist_name=${encodeURIComponent(cleanArtist)}`;
        }
        if (durationSec > 0) {
            query += `&duration=${Math.round(durationSec)}`;
        }

        let result = await this._queryUrl(`https://lrclib.net/api/get?${query}`, durationSec);
        if (result && result.length > 0) {
            this._remember(cacheKey, result);
            return result;
        }

        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}`;
        const msg = Soup.Message.new('GET', searchUrl);
        const bytes = await this._httpSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
        if (msg.status_code === 200) {
            const list = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            if (Array.isArray(list) && list.length > 0) {
                const match = list.find(item => item.syncedLyrics) || list.find(item => item.plainLyrics) || list[0];
                if (match) {
                    if (match.syncedLyrics) {
                        result = this._parseLRC(match.syncedLyrics);
                    } else if (match.plainLyrics) {
                        result = this._paginatePlainLyrics(match.plainLyrics, durationSec);
                    }

                    if (result && result.length > 0) {
                        this._remember(cacheKey, result);
                        return result;
                    }
                }
            }
        }

        return null;
    }

    async _queryUrl(url, durationSec) {
        const msg = Soup.Message.new('GET', url);
        const bytes = await this._httpSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
        if (msg.status_code === 200) {
            const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            if (data) {
                if (data.syncedLyrics) return this._parseLRC(data.syncedLyrics);
                if (data.plainLyrics) return this._paginatePlainLyrics(data.plainLyrics, durationSec);
            }
        }
        return null;
    }

    _parseLRC(lrcText) {
        if (!lrcText) return [];
        const lines = lrcText.split('\n');
        const parsed = [];
        const timeRegex = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)/;

        for (const line of lines) {
            const match = line.match(timeRegex);
            if (match) {
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                let ms = 0;
                if (match[3]) {
                    ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3].slice(0, 3), 10);
                }
                const timeMs = (min * 60 + sec) * 1000 + ms;
                const text = match[4].trim();
                if (text) parsed.push({ time: timeMs, text });
            }
        }
        return parsed.sort((a, b) => a.time - b.time);
    }

    _paginatePlainLyrics(plainText, durationSec) {
        if (!plainText) return [];
        const rawLines = plainText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (rawLines.length === 0) return [];

        const totalMs = Math.max(15000, (durationSec || 180) * 1000);
        const intervalMs = Math.floor(totalMs / rawLines.length);

        return rawLines.map((text, idx) => ({
            time: idx * intervalMs,
            text: text
        }));
    }

    destroy() {
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }
}