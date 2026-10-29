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

export const USER_AGENT = 'Dhruva (https://github.com/NarkAgni/dhruva)';

const MAX_CACHED_SONGS = 300;
const DURATION_TOLERANCE_S = 3;
const API_URL = 'https://lrclib.net/api';

const PARENS_RE = /\s*\(.*?\)\s*/g;
const BRACKETS_RE = /\s*\[.*?\]\s*/g;
const TITLE_SUFFIX_RE = /\s+-\s+.*$/;
const LRC_LINE_RE = /\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)/;


function cleanTitle(title) {
    return title.replace(PARENS_RE, ' ').replace(BRACKETS_RE, ' ').replace(TITLE_SUFFIX_RE, '').trim();
}

function cleanArtist(artist) {
    return (artist || '').split(',')[0].replace(PARENS_RE, ' ').trim();
}

function cacheKey(title, artist) {
    return `${cleanTitle(title).toLowerCase()}::${cleanArtist(artist).toLowerCase()}`;
}

function parseSynced(lrcText) {
    const lines = [];
    for (const line of lrcText.split('\n')) {
        const match = line.match(LRC_LINE_RE);
        if (!match) continue;
        const text = match[4].trim();
        if (!text) continue;
        let ms = 0;
        if (match[3]) ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3].slice(0, 3), 10);
        lines.push({ time: (parseInt(match[1], 10) * 60 + parseInt(match[2], 10)) * 1000 + ms, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

function parsePlain(plainText) {
    return plainText.split('\n').map(text => text.trim()).filter(text => text.length > 0).map(text => ({ text }));
}

function entryFrom(data) {
    if (!data) return null;
    if (data.syncedLyrics) {
        const lines = parseSynced(data.syncedLyrics);
        if (lines.length > 0) return { lines, synced: true, offset: 0 };
    }
    if (data.plainLyrics) {
        const lines = parsePlain(data.plainLyrics);
        if (lines.length > 0) return { lines, synced: false, offset: 0 };
    }
    return null;
}


export class LyricsClient {
    constructor() {
        this._cancellable = new Gio.Cancellable();
        this._httpSession = new Soup.Session();
        this._httpSession.timeout = 6;
        this._httpSession.user_agent = USER_AGENT;

        GLib.mkdir_with_parents(userCacheDir(), 0o755);
        this._cacheFilePath = lyricsCachePath();

        this._cache = new Map();
        this._loadDiskCache().catch(() => { });
    }

    async _loadDiskCache() {
        const file = Gio.File.new_for_path(this._cacheFilePath);
        if (!file.query_exists(this._cancellable)) return;

        const [bytes] = await file.load_bytes_async(this._cancellable);
        if (!this._cancellable) return;

        const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        if (!data || Array.isArray(data)) return;

        for (const [key, entry] of Object.entries(data)) {
            if (entry && Array.isArray(entry.lines)) this._cache.set(key, entry);
        }
    }

    _remember(key, entry) {
        this._cache.delete(key);
        this._cache.set(key, entry);
        for (const oldKey of this._cache.keys()) {
            if (this._cache.size <= MAX_CACHED_SONGS) break;
            this._cache.delete(oldKey);
        }
        this._saveDiskCache();
    }

    _saveDiskCache() {
        if (!this._cancellable) return;
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(Object.fromEntries(this._cache))));
        Gio.File.new_for_path(this._cacheFilePath)
            .replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable)
            .catch(() => { });
    }

    async _fetchJson(url) {
        const msg = Soup.Message.new('GET', url);
        const bytes = await this._httpSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable);
        if (!this._cancellable || msg.status_code !== 200) return null;
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    async getLyrics(title, artist, durationSec, album = '') {
        if (!title || !this._cancellable) return null;

        const key = cacheKey(title, artist);
        if (this._cache.has(key)) return this._cache.get(key);

        const trackTitle = cleanTitle(title);
        const trackArtist = cleanArtist(artist);

        let query = `track_name=${encodeURIComponent(trackTitle)}`;
        if (trackArtist) query += `&artist_name=${encodeURIComponent(trackArtist)}`;
        if (album) query += `&album_name=${encodeURIComponent(album)}`;
        if (durationSec > 0) query += `&duration=${Math.round(durationSec)}`;

        let entry = entryFrom(await this._fetchJson(`${API_URL}/get?${query}`));
        if (!entry && this._cancellable) {
            const list = await this._fetchJson(`${API_URL}/search?q=${encodeURIComponent(`${trackArtist} ${trackTitle}`.trim())}`);
            if (Array.isArray(list)) {
                const isSameLength = item => durationSec <= 0 || Math.abs(item.duration - durationSec) < DURATION_TOLERANCE_S;
                const match = list.find(item => item.syncedLyrics && isSameLength(item)) ||
                    list.find(item => item.syncedLyrics) ||
                    list.find(item => item.plainLyrics && isSameLength(item)) ||
                    list.find(item => item.plainLyrics);
                entry = entryFrom(match);
            }
        }

        if (!this._cancellable || !entry) return null;
        this._remember(key, entry);
        return entry;
    }

    setOffset(title, artist, offsetMs) {
        const entry = this._cache.get(cacheKey(title, artist));
        if (!entry) return;
        entry.offset = offsetMs;
        this._saveDiskCache();
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
    }
}