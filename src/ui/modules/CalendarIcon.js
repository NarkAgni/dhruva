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

// Live calendar icon: shows the icon theme's own calendar artwork with today's
// date in place of the one baked into it. See CalendarArt.js for the drawing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { ART_SIZE, redateThemeIcon } from './CalendarArt.js';

const CALENDAR_APP_IDS = [
    'org.gnome.Calendar.desktop',
    'gnome-calendar.desktop',
];

// Theme icons already found to carry no date, so each dock rebuild does not
// scan them again.
const _undatedSources = new Set();

export function isCalendarApp(app) {
    return Boolean(app) && CALENDAR_APP_IDS.includes(app.get_id());
}

export function todayStamp() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function themeIconFile(app) {
    const gicon = app.get_icon();
    const names = gicon instanceof Gio.ThemedIcon ? gicon.get_names() : [];
    const theme = St.IconTheme.new();
    for (const name of names) {
        const filename = theme.lookup_icon(name, ART_SIZE, 0)?.get_filename();
        if (filename) return filename;
    }
    return null;
}

// Deletes earlier cards; the texture cache keys on the path, so each day
// needs a new file and yesterday's is dead weight.
function removeStaleCards(dir, keep) {
    try {
        const enumerator = Gio.File.new_for_path(dir).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null))) {
            const name = info.get_name();
            if (name.startsWith('calendar-') && name !== keep)
                enumerator.get_child(info).delete(null);
        }
        enumerator.close(null);
    } catch (_e) {
        // A leftover file costs a few KB; not worth failing the dock over.
    }
}

// Returns a texture of the theme's calendar icon showing today's date, or
// null when the theme's icon carries no date to replace. The caller then
// shows the theme icon as it is.
export function createCalendarIconTexture(app, renderSize) {
    const source = themeIconFile(app);
    if (!source || _undatedSources.has(source)) return null;

    // The source path is part of the name, so switching icon themes draws a
    // fresh card instead of reusing the old theme's.
    const sourceKey = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, source, -1).slice(0, 12);
    const name = `calendar-${todayStamp()}-${sourceKey}.png`;
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dhruva']);
    const path = GLib.build_filenamev([dir, name]);

    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        GLib.mkdir_with_parents(dir, 0o755);
        removeStaleCards(dir, name);
        try {
            if (!redateThemeIcon(source, path)) {
                _undatedSources.add(source);
                return null;
            }
        } catch (e) {
            console.warn(`Dhruva: live calendar icon failed: ${e.message}`);
            return null;
        }
    }

    const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    const gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(path) });
    return St.TextureCache.get_default().load_gicon(null, gicon, renderSize, scaleFactor, 1.0);
}
