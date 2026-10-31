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
import Shell from 'gi://Shell';
import * as RemoteSearch from 'resource:///org/gnome/shell/ui/remoteSearch.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';


Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

const PINNED_KEY = 'start-menu-pinned';
const FOLDER_PREFIX = 'folder:';
const START_FOLDER_PREFIX = 'smfolder:';
const FOLDERS_KEY = 'start-menu-folders';
const RECENT_COUNT_KEY = 'start-menu-recent-files';
const RECENT_FILES_LIMIT = 60;
const SEARCH_LIMIT = 20;
const INDEX_LIMIT = 20000;
const INDEX_DEPTH = 8;
const TRACKER_LIMIT = 40;
const TRACKER_BUS = 'org.freedesktop.Tracker3.Miner.Files';
const TRACKER_LIBRARIES = ['gi://Tsparql', 'gi://Tracker?version=3.0'];
const TRACKER_QUERY = 'SELECT DISTINCT ?url ?rank WHERE { GRAPH tracker:FileSystem { ' +
    '?file a nfo:FileDataObject ; nie:url ?url . ?file fts:match ~match . BIND(fts:rank(?file) AS ?rank) } } ' +
    `ORDER BY DESC(?rank) LIMIT ${TRACKER_LIMIT}`;
const MAX_RANK = 50;
const MIN_RANK = 10;
const RANK_SCALE = 100;
const MAX_MATCH_BONUS = 500;
const PROXIMITY_BASE = 10000;
const PROXIMITY_STEP = 1000;
const PROXIMITY_DEPTH = 10;
const DAY_S = 86400;
const RECENCY_BONUS = [[1, 100], [7, 70], [14, 50], [30, 30], [90, 10]];
const INDEX_BATCH = 200;
const INDEX_TTL_US = 10 * 60 * 1000000;
const SETTINGS_PANEL_KEY = 'X-GNOME-Settings-Panel';
const FILE_ATTRIBUTES = 'standard::name,standard::display-name,standard::content-type,standard::icon,standard::type,standard::is-symlink,thumbnail::path,time::modified,time::access';
const SKIPPED_DIRS = ['node_modules', '__pycache__', 'snap', 'venv', 'build', 'dist', 'target'];
const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': '\'' };
const SEARCH_PROVIDERS_SCHEMA = 'org.gnome.desktop.search-providers';
const SKIPPED_PROVIDERS = ['org.gnome.Nautilus.desktop', 'org.gnome.Settings.desktop'];
const REMOTE_LIMIT = 10;
const WEB_SEARCH_URL_KEY = 'start-menu-web-search-url';
const SEARCH_ENGINES = [
    ['duckduckgo.', 'DuckDuckGo'],
    ['google.', 'Google'],
    ['bing.', 'Bing'],
    ['search.brave.', 'Brave Search'],
    ['startpage.', 'Startpage'],
    ['ecosia.', 'Ecosia'],
    ['yahoo.', 'Yahoo'],
    ['yandex.', 'Yandex'],
    ['qwant.', 'Qwant'],
];
const LOGIN_BUS = 'org.freedesktop.login1';
const LOGIN_PATH = '/org/freedesktop/login1';
const LOGIN_IFACE = 'org.freedesktop.login1.Manager';


function attribute(attrs, name) {
    const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
    return match ? match[1].replace(/&(amp|lt|gt|quot|apos);/g, entity => XML_ENTITIES[entity]) : '';
}

function isoToUnix(value) {
    const date = value ? GLib.DateTime.new_from_iso8601(value, null) : null;
    return date ? date.to_unix() : 0;
}

function entryFromInfo(file, info, time) {
    const parent = file.get_parent();
    const home = GLib.get_home_dir();
    const path = file.get_path();
    const relative = path.startsWith(`${home}/`) ? path.slice(home.length + 1) : path;
    const lastUse = Math.max(info.get_attribute_uint64('time::modified'), info.get_attribute_uint64('time::access'));
    return {
        uri: file.get_uri(),
        name: info.get_display_name(),
        preparedName: prepare(info.get_display_name()),
        gicon: info.get_icon(),
        contentType: info.get_content_type() || '',
        thumbnail: info.get_attribute_byte_string('thumbnail::path'),
        isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
        location: parent ? parent.get_path() : '',
        dirCount: relative.split('/').length - 1,
        lastUse: Math.max(lastUse, time),
        time: time || info.get_attribute_uint64('time::modified'),
    };
}

function prepare(text) {
    return text.normalize('NFD').toLowerCase();
}

function splitTerms(query) {
    return prepare(query).split(/\s+/).filter(term => term.length > 0);
}

function matchRank(prepared, words) {
    let position = 0;
    let malus = 0;
    for (const word of words) {
        position = prepared.indexOf(word);
        if (position === -1) return -1;
        malus += prepared.length - position - word.length;
    }
    return Math.max(MIN_RANK, MAX_RANK - position - malus / RANK_SCALE);
}

function recencyBonus(lastUse) {
    const days = (GLib.get_real_time() / 1000000 - lastUse) / DAY_S;
    const step = RECENCY_BONUS.find(([limit]) => days <= limit);
    return step ? step[1] : 0;
}

function relevance(entry, rank) {
    const proximity = entry.dirCount < PROXIMITY_DEPTH ? PROXIMITY_BASE - PROXIMITY_STEP * entry.dirCount : 0;
    const recent = entry.dirCount === 0 ? 0 : recencyBonus(entry.lastUse);
    return proximity + recent + Math.min(MAX_MATCH_BONUS, 10 * rank);
}

async function loadTrackerLibrary() {
    for (const name of TRACKER_LIBRARIES) {
        try {
            const library = (await import(name)).default;
            Gio._promisify(library.SparqlConnection, 'bus_new_async', 'bus_new_finish');
            Gio._promisify(library.SparqlStatement.prototype, 'execute_async', 'execute_finish');
            Gio._promisify(library.SparqlCursor.prototype, 'next_async', 'next_finish');
            return library;
        } catch (_e) {
            continue;
        }
    }
    return null;
}


export class StartMenuData {
    constructor(settings, appManager) {
        this._settings = settings;
        this._appManager = appManager;
        this._appSystem = Shell.AppSystem.get_default();
        this._cancellable = new Gio.Cancellable();
        this._recentFiles = [];
        this._indexedFiles = [];
        this._indexPromise = null;
        this._indexTime = 0;
        this._settingsPanels = null;
        this._trackerPromise = null;
        this._trackerStatement = null;
        this._recentPromise = null;
        this._isRecentDirty = true;
        this._providers = null;
        this.canHibernate = false;

        this._recentFile = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']));
        this._recentMonitor = this._recentFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._recentMonitor.connectObject('changed', () => {
            this._isRecentDirty = true;
        }, this);

        this._checkHibernate();
    }

    _checkHibernate() {
        Gio.DBus.system.call(LOGIN_BUS, LOGIN_PATH, LOGIN_IFACE, 'CanHibernate', null, new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (connection, res) => {
                try {
                    const [answer] = connection.call_finish(res).deepUnpack();
                    this.canHibernate = answer === 'yes';
                } catch (_e) {
                    this.canHibernate = false;
                }
            });
    }

    hibernate() {
        Gio.DBus.system.call(LOGIN_BUS, LOGIN_PATH, LOGIN_IFACE, 'Hibernate', new GLib.Variant('(b)', [true]), null,
            Gio.DBusCallFlags.NONE, -1, null, null);
    }

    get recentFiles() {
        return this._recentFiles;
    }

    async _describe(file, time) {
        try {
            const info = await file.query_info_async(FILE_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._cancellable);
            return info.get_file_type() === Gio.FileType.SYMBOLIC_LINK ? null : entryFromInfo(file, info, time);
        } catch (_e) {
            return null;
        }
    }

    loadRecentFiles() {
        if (this._recentPromise) return this._recentPromise;
        if (!this._isRecentDirty) return Promise.resolve(this._recentFiles);

        this._isRecentDirty = false;
        this._recentPromise = this._readRecentFiles().finally(() => {
            this._recentPromise = null;
        });
        return this._recentPromise;
    }

    async _readRecentFiles() {
        let contents;
        try {
            [contents] = await this._recentFile.load_contents_async(this._cancellable);
        } catch (_e) {
            return this._recentFiles;
        }

        const bookmarks = [];
        for (const match of new TextDecoder().decode(contents).matchAll(/<bookmark\s([^>]*)>/g)) {
            const href = attribute(match[1], 'href');
            if (!href.startsWith('file://')) continue;
            const time = Math.max(isoToUnix(attribute(match[1], 'modified')), isoToUnix(attribute(match[1], 'visited')));
            bookmarks.push({ href, time });
        }
        bookmarks.sort((a, b) => b.time - a.time);

        const described = await Promise.all(bookmarks.slice(0, RECENT_FILES_LIMIT)
            .map(entry => this._describe(Gio.File.new_for_uri(entry.href), entry.time)));
        const previous = new Map(this._recentFiles.map(entry => [entry.uri, entry]));
        this._recentFiles = described
            .filter(entry => entry && !entry.isDirectory)
            .map(entry => {
                const known = previous.get(entry.uri);
                return known && known.time === entry.time && known.thumbnail === entry.thumbnail ? known : entry;
            });
        return this._recentFiles;
    }

    async _scan(dir, depth, out) {
        let enumerator;
        try {
            enumerator = await dir.enumerate_children_async(FILE_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this._cancellable);
        } catch (_e) {
            return;
        }

        const subdirs = [];
        while (out.length < INDEX_LIMIT) {
            let infos;
            try {
                infos = await enumerator.next_files_async(INDEX_BATCH, GLib.PRIORITY_LOW, this._cancellable);
            } catch (_e) {
                break;
            }
            if (infos.length === 0) break;

            for (const info of infos) {
                const name = info.get_name();
                if (name.startsWith('.') || SKIPPED_DIRS.includes(name)) continue;
                if (info.get_file_type() === Gio.FileType.SYMBOLIC_LINK) continue;
                const child = dir.get_child(name);
                const entry = entryFromInfo(child, info, 0);
                out.push(entry);
                if (entry.isDirectory && depth > 0 && !info.get_is_symlink()) subdirs.push(child);
            }
        }
        enumerator.close_async(GLib.PRIORITY_LOW, null, () => { });

        for (const subdir of subdirs) {
            if (out.length >= INDEX_LIMIT || this._cancellable.is_cancelled()) break;
            await this._scan(subdir, depth - 1, out);
        }
    }

    ensureIndex() {
        const now = GLib.get_monotonic_time();
        if (!this._indexPromise || now - this._indexTime > INDEX_TTL_US) {
            this._indexTime = now;
            const files = [];
            this._indexPromise = this._scan(Gio.File.new_for_path(GLib.get_home_dir()), INDEX_DEPTH, files)
                .then(() => {
                    this._indexedFiles = files;
                })
                .catch(() => { });
        }
        return this._indexPromise;
    }

    _tracker() {
        if (!this._trackerPromise) {
            this._trackerPromise = loadTrackerLibrary().then(async library => {
                if (!library) return null;
                try {
                    const connection = await library.SparqlConnection.bus_new_async(TRACKER_BUS, null, null, this._cancellable);
                    this._trackerStatement = connection.query_statement(TRACKER_QUERY, this._cancellable);
                    return connection;
                } catch (_e) {
                    return null;
                }
            });
        }
        return this._trackerPromise;
    }

    async searchIndexedFiles(query) {
        const connection = await this._tracker();
        if (!connection || !this._trackerStatement) return [];

        const hits = [];
        try {
            this._trackerStatement.bind_string('match', query);
            const cursor = await this._trackerStatement.execute_async(this._cancellable);
            while (await cursor.next_async(this._cancellable)) {
                const [url] = cursor.get_string(0);
                if (url && url.startsWith('file://') && !url.includes('/.')) hits.push({ url, rank: cursor.get_double(1) });
            }
            cursor.close();
        } catch (_e) {
            return [];
        }

        const entries = await Promise.all(hits.map(hit => this._describe(Gio.File.new_for_uri(hit.url), 0)));
        return entries.filter(Boolean).map((entry, index) => ({ entry, trackerRank: hits[index].rank }));
    }

    searchFiles(query, indexedHits = []) {
        const words = splitTerms(query);
        const recentTimes = new Map(this._recentFiles.map(entry => [entry.uri, entry.time]));
        const trackerRanks = new Map(indexedHits.map(hit => [hit.entry.uri, hit.trackerRank]));
        const seen = new Set();
        const scored = [];

        for (const entry of [...this._recentFiles, ...indexedHits.map(hit => hit.entry), ...this._indexedFiles]) {
            if (seen.has(entry.uri)) continue;
            seen.add(entry.uri);

            const match = matchRank(entry.preparedName, words);
            if (match < 0) continue;
            const lastUse = Math.max(entry.lastUse, recentTimes.get(entry.uri) || 0);
            const rank = match + (trackerRanks.get(entry.uri) || 0);
            scored.push({ entry, score: relevance({ ...entry, lastUse }, rank) });
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, SEARCH_LIMIT)
            .map(item => item.entry);
    }

    searchApps(query) {
        return Shell.AppSystem.search(query).flat()
            .map(id => this._appSystem.lookup_app(id))
            .filter(app => app && app.get_app_info().should_show())
            .slice(0, SEARCH_LIMIT);
    }

    remoteProviders() {
        if (!this._providers) {
            try {
                this._providers = RemoteSearch.loadRemoteSearchProviders(new Gio.Settings({ schema_id: SEARCH_PROVIDERS_SCHEMA }))
                    .filter(provider => !SKIPPED_PROVIDERS.includes(provider.appInfo.get_id()));
            } catch (e) {
                console.error('[Dhruva] Could not load search providers:', e.message);
                this._providers = [];
            }
        }
        return this._providers;
    }

    async _searchProvider(provider, terms, cancellable) {
        try {
            const ids = await provider.getInitialResultSet(terms, cancellable);
            if (ids.length === 0) return null;
            const metas = await provider.getResultMetas(ids.slice(0, REMOTE_LIMIT), cancellable);
            return metas.length > 0 ? { provider, metas } : null;
        } catch (_e) {
            return null;
        }
    }

    async searchRemote(terms, skippedIds, cancellable) {
        const providers = this.remoteProviders().filter(provider => !skippedIds.includes(provider.appInfo.get_id()));
        const groups = await Promise.all(providers.map(provider => this._searchProvider(provider, terms, cancellable)));
        return groups.filter(Boolean);
    }

    webSearchEngine() {
        let host = '';
        try {
            host = GLib.Uri.parse(this._settings.get_string(WEB_SEARCH_URL_KEY).replace('%s', ''), GLib.UriFlags.NONE).get_host() || '';
        } catch (_e) {
            return null;
        }
        const name = host.replace(/^www\./, '');
        const known = SEARCH_ENGINES.find(([prefix]) => name.startsWith(prefix));
        return known ? known[1] : name || null;
    }

    webBrowser() {
        return Gio.AppInfo.get_default_for_uri_scheme('https');
    }

    webSearchUri(query) {
        const template = this._settings.get_string(WEB_SEARCH_URL_KEY);
        const encoded = encodeURIComponent(query);
        return template.includes('%s') ? template.replace('%s', encoded) : `${template}${encoded}`;
    }

    _loadSettingsPanels() {
        if (!this._settingsPanels) {
            this._settingsPanels = Gio.AppInfo.get_all().filter(info => info.get_string && info.get_string(SETTINGS_PANEL_KEY));
        }
        return this._settingsPanels;
    }

    searchSettings(query) {
        const words = splitTerms(query);
        return this._loadSettingsPanels()
            .map(info => ({ info, score: matchRank(prepare(`${info.get_name()} ${(info.get_keywords() || []).join(' ')}`), words) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, SEARCH_LIMIT)
            .map(item => item.info);
    }

    recentApps(limit) {
        const apps = [...this._appSystem.get_running()];
        for (const app of Shell.AppUsage.get_default().get_most_used()) {
            if (apps.length >= limit) break;
            if (!apps.includes(app) && app.get_app_info().should_show()) apps.push(app);
        }
        return apps.slice(0, limit);
    }

    installedApps() {
        return this._appSystem.get_installed()
            .filter(info => info.should_show())
            .map(info => this._appSystem.lookup_app(info.get_id()))
            .filter(Boolean)
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
    }

    _pinnedKeys() {
        const own = this._settings.get_strv(PINNED_KEY);
        return own.length > 0 ? own : this._appManager.getDockOrder();
    }

    get recentFilesCount() {
        return this._settings.get_int(RECENT_COUNT_KEY);
    }

    _startFolders() {
        try {
            const folders = JSON.parse(this._settings.get_string(FOLDERS_KEY));
            return Array.isArray(folders) ? folders : [];
        } catch (_e) {
            return [];
        }
    }

    _saveStartFolders(folders) {
        this._settings.set_string(FOLDERS_KEY, JSON.stringify(folders));
    }

    _lookupApps(ids) {
        return ids.map(id => this._appSystem.lookup_app(id)).filter(Boolean);
    }

    pinnedItems() {
        const dockFolders = new Map(this._appManager.getFolders().map(folder => [`${FOLDER_PREFIX}${folder.id}`, folder]));
        const startFolders = new Map(this._startFolders().map(folder => [`${START_FOLDER_PREFIX}${folder.id}`, folder]));
        return this._pinnedKeys().map(key => {
            const folder = dockFolders.get(key) || startFolders.get(key);
            if (folder) return { key, folder, apps: this._lookupApps(folder.apps), isStartFolder: startFolders.has(key) };
            const app = this._appSystem.lookup_app(key);
            return app ? { key, app } : null;
        }).filter(Boolean);
    }

    setPinnedOrder(keys) {
        this._settings.set_strv(PINNED_KEY, keys);
    }

    _uniqueFolderName() {
        const base = _('New Folder');
        const names = new Set(this._startFolders().map(folder => folder.name));
        if (!names.has(base)) return base;
        let counter = 2;
        while (names.has(`${base} ${counter}`)) counter++;
        return `${base} ${counter}`;
    }

    renameFolder(folderId, name) {
        const folders = this._startFolders();
        const folder = folders.find(item => item.id === folderId);
        const clean = name.trim();
        if (!folder || !clean || clean === folder.name) return;
        folder.name = clean;
        this._saveStartFolders(folders);
    }

    setFolderApps(folderId, appIds) {
        const folders = this._startFolders();
        const folder = folders.find(item => item.id === folderId);
        if (!folder) return;
        folder.apps = appIds;
        this._saveStartFolders(folders);
    }

    unpin(key) {
        this._settings.set_strv(PINNED_KEY, this._pinnedKeys().filter(item => item !== key));
    }

    groupIntoFolder(targetKey, sourceKey) {
        const folders = this._startFolders();
        const id = `${GLib.get_real_time()}`;
        folders.push({ id, name: this._uniqueFolderName(), apps: [targetKey, sourceKey] });
        this._saveStartFolders(folders);

        const keys = this._pinnedKeys()
            .filter(key => key !== sourceKey)
            .map(key => (key === targetKey ? `${START_FOLDER_PREFIX}${id}` : key));
        this._settings.set_strv(PINNED_KEY, keys);
    }

    addToFolder(folderKey, appKey) {
        const folders = this._startFolders();
        const folder = folders.find(item => `${START_FOLDER_PREFIX}${item.id}` === folderKey);
        if (!folder) return;
        if (!folder.apps.includes(appKey)) folder.apps.push(appKey);
        this._saveStartFolders(folders);
        this._settings.set_strv(PINNED_KEY, this._pinnedKeys().filter(key => key !== appKey));
    }

    removeFromFolder(folderId, appId) {
        const folders = this._startFolders();
        const folder = folders.find(item => item.id === folderId);
        if (!folder) return;

        folder.apps = folder.apps.filter(id => id !== appId);
        const folderKey = `${START_FOLDER_PREFIX}${folderId}`;
        const keys = this._pinnedKeys();
        const index = keys.indexOf(folderKey);
        const restored = folder.apps.length <= 1 ? [...folder.apps, appId] : [appId];

        if (folder.apps.length <= 1) {
            this._saveStartFolders(folders.filter(item => item !== folder));
            keys.splice(index, 1, ...restored);
        } else {
            this._saveStartFolders(folders);
            keys.splice(index + 1, 0, ...restored);
        }
        this._settings.set_strv(PINNED_KEY, keys);
    }

    isPinned(app) {
        return this._pinnedKeys().includes(app.get_id());
    }

    togglePinned(app) {
        const id = app.get_id();
        const keys = [...this._pinnedKeys()];
        const index = keys.indexOf(id);
        if (index === -1) keys.push(id);
        else keys.splice(index, 1);
        this._settings.set_strv(PINNED_KEY, keys);
    }

    destroy() {
        this._recentMonitor.disconnectObject(this);
        this._recentMonitor.cancel();
        this._recentMonitor = null;
        this._cancellable.cancel();
        this._recentFiles = [];
        this._indexedFiles = [];
        this._indexPromise = null;
        this._settingsPanels = null;
        this._trackerPromise = null;
        this._trackerStatement = null;
        this._providers = null;
    }
}