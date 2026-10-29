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
import GObject from 'gi://GObject';

import { TimeoutTracker } from '../../../core/TimeoutTracker.js';
import { animateMinimize, animateRestore } from '../../effects/WindowEffects.js';


const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_NAMESPACE = 'org.mpris.MediaPlayer2';
const MPRIS_PREFIX = `${MPRIS_NAMESPACE}.`;
const MPRIS_INTERFACE = `${MPRIS_NAMESPACE}.Player`;
const IGNORED_PLAYERS = [`${MPRIS_PREFIX}playerctld`];
const METADATA_RETRY_MS = 250;
const METADATA_MAX_RETRIES = 8;
const EMPTY_META = { trackId: '', title: '', artist: '', album: '', artUrl: '', duration: 0, changed: false };
const LOOP_ORDER = ['None', 'Playlist', 'Track'];
const DEFAULT_TRACK_ID = '/org/mpris/MediaPlayer2/CurrentTrack';
const SEEK_GUARD_MS = 3000;
const POSITION_TOLERANCE_MS = 1500;

function monotonicMs() {
    return GLib.get_monotonic_time() / 1000;
}

export const MusicPlayerService = GObject.registerClass({
    Signals: {
        'playback-state-changed': {
            param_types: [
                GObject.TYPE_BOOLEAN,
                GObject.TYPE_STRING,
                GObject.TYPE_STRING,
                GObject.TYPE_STRING,
                GObject.TYPE_DOUBLE,
                GObject.TYPE_BOOLEAN
            ]
        },
        'position-changed': {
            param_types: [
                GObject.TYPE_INT,
                GObject.TYPE_INT64
            ]
        },
        'players-changed': {},
    },
},
    class MusicPlayerService extends GObject.Object {
        _init() {
            super._init();
            this._tracker = new TimeoutTracker();
            this._cancellable = new Gio.Cancellable();
            this._posTrackerId = 0;
            this._controlSyncId = 0;
            this._metaFetchId = 0;
            this._metaRetries = 0;
            this._players = new Map();
            this._activePlayerBus = null;
            this._pinnedBus = null;
            this._playerProxy = null;
            this._isPlaying = false;
            this._hasPlayer = false;
            this._currentMeta = { ...EMPTY_META };
            this._positionMs = 0;
            this._positionMono = monotonicMs();
            this._lastReportedMs = -1;
            this._seekGuardUntil = 0;
            this._reportBiasMs = 0;
            this._hasSeekedSignal = false;

            this._initDBus();
            this._startPositionTracker();
        }

        _initDBus() {
            this._ownerSignalId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                MPRIS_NAMESPACE,
                Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
                (_connection, _sender, _path, _iface, _signal, params) => {
                    const [name, oldOwner, newOwner] = params.deepUnpack();
                    if (oldOwner) this._removePlayer(name);
                    if (newOwner) this._addPlayer(name);
                }
            );

            Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE,
                1000,
                this._cancellable,
                (connection, res) => {
                    let names;
                    try {
                        [names] = connection.call_finish(res).deepUnpack();
                    } catch (_e) {
                        return;
                    }
                    names.forEach(name => this._addPlayer(name));
                }
            );
        }

        _addPlayer(busName) {
            if (!this._cancellable || !busName.startsWith(MPRIS_PREFIX) || IGNORED_PLAYERS.includes(busName) || this._players.has(busName)) return;

            const entry = { busName, proxy: null, root: null, app: null, name: busName.slice(MPRIS_PREFIX.length).split('.')[0] };
            this._players.set(busName, entry);

            Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, busName, MPRIS_PATH, MPRIS_INTERFACE,
                this._cancellable, (_source, res) => {
                    let proxy;
                    try {
                        proxy = Gio.DBusProxy.new_for_bus_finish(res);
                    } catch (_e) {
                        return;
                    }
                    if (this._players.get(busName) !== entry) return;

                    entry.proxy = proxy;
                    proxy.connectObject(
                        'g-properties-changed', (_proxy, changed) => this._onPlayerChanged(entry, changed.deepUnpack()),
                        'g-signal', (_proxy, _sender, signalName, params) => {
                            if (signalName === 'Seeked' && entry.busName === this._activePlayerBus) {
                                const [positionMicro] = params.deepUnpack();
                                this._onSeeked(positionMicro / 1000);
                            }
                        },
                        this
                    );
                    this._chooseActive();
                    this.emit('players-changed');
                });

            Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS, null, busName, MPRIS_PATH, MPRIS_NAMESPACE,
                this._cancellable, (_source, res) => {
                    let root;
                    try {
                        root = Gio.DBusProxy.new_for_bus_finish(res);
                    } catch (_e) {
                        return;
                    }
                    if (this._players.get(busName) !== entry) return;

                    entry.root = root;
                    const identity = root.get_cached_property('Identity');
                    const desktopEntry = root.get_cached_property('DesktopEntry');
                    if (identity) entry.name = identity.unpack();
                    if (desktopEntry) entry.app = Shell.AppSystem.get_default().lookup_app(`${desktopEntry.unpack()}.desktop`);
                    this.emit('players-changed');
                });
        }

        _removePlayer(busName) {
            const entry = this._players.get(busName);
            if (!entry) return;

            if (entry.proxy) entry.proxy.disconnectObject(this);
            this._players.delete(busName);
            if (this._pinnedBus === busName) this._pinnedBus = null;
            if (this._activePlayerBus === busName) {
                this._activePlayerBus = null;
                this._playerProxy = null;
            }

            this._chooseActive();
            this.emit('players-changed');
        }

        _isEntryPlaying(entry) {
            const status = entry.proxy ? entry.proxy.get_cached_property('PlaybackStatus') : null;
            return Boolean(status) && status.unpack() === 'Playing';
        }

        _chooseActive() {
            const ready = [...this._players.values()].filter(entry => entry.proxy);
            if (ready.length === 0) {
                if (this._hasPlayer) this._setActive(null);
                return;
            }

            const pinned = this._pinnedBus ? this._players.get(this._pinnedBus) : null;
            const current = this._players.get(this._activePlayerBus);
            const hasCurrent = Boolean(current) && Boolean(current.proxy);

            let next;
            if (pinned && pinned.proxy) next = pinned;
            else if (hasCurrent && this._isEntryPlaying(current)) next = current;
            else next = ready.find(entry => this._isEntryPlaying(entry)) || (hasCurrent ? current : ready[0]);

            if (next.busName !== this._activePlayerBus) this._setActive(next.busName);
        }

        _setActive(busName) {
            this._cancelMetadataFetch();
            this._metaRetries = 0;

            const entry = busName ? this._players.get(busName) : null;
            this._activePlayerBus = entry ? busName : null;
            this._playerProxy = entry ? entry.proxy : null;
            this._hasPlayer = Boolean(entry);
            this._isPlaying = false;
            this._hasSeekedSignal = false;
            this._currentMeta = { ...EMPTY_META };
            this._resetPosition();

            if (entry) this._syncState(true);
            else this._emitChange();
            this.emit('players-changed');
        }

        _onPlayerChanged(entry, changed) {
            if (entry.busName === this._activePlayerBus) {
                if (changed.PlaybackStatus) this._setPlaying(changed.PlaybackStatus.unpack() === 'Playing');
                if (changed.Metadata) this._parseMetadata(changed.Metadata.deepUnpack());
                this._emitChange();
            }
            if (changed.PlaybackStatus) this._chooseActive();
        }

        get players() {
            return [...this._players.values()]
                .filter(entry => entry.proxy)
                .map(entry => ({ busName: entry.busName, name: entry.name, gicon: entry.app ? entry.app.get_icon() : null }));
        }

        get activePlayer() {
            return this._activePlayerBus;
        }

        selectPlayer(busName) {
            if (!this._players.has(busName)) return;
            this._pinnedBus = busName;
            this._chooseActive();
        }

        _startPositionTracker() {
            this._posTrackerId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 250, () => {
                if (this._isPlaying) this._queryPosition();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _currentPositionMs() {
            return this._isPlaying ? this._positionMs + (monotonicMs() - this._positionMono) : this._positionMs;
        }

        _setPosition(positionMs) {
            this._positionMs = Math.max(0, positionMs);
            this._positionMono = monotonicMs();
            this.emit('position-changed', Math.floor(this._positionMs), this._positionMono);
        }

        _resetPosition() {
            this._lastReportedMs = -1;
            this._seekGuardUntil = 0;
            this._reportBiasMs = 0;
            this._setPosition(0);
        }

        _isSeekGuarded() {
            return monotonicMs() < this._seekGuardUntil;
        }

        _isNearExpected(positionMs) {
            return Math.abs(positionMs - this._currentPositionMs()) <= POSITION_TOLERANCE_MS;
        }

        _acceptPosition(positionMs) {
            this._seekGuardUntil = 0;
            this._reportBiasMs = 0;
            this._setPosition(positionMs);
        }

        _onReportedPosition(reportedMs) {
            if (reportedMs === this._lastReportedMs) return;
            this._lastReportedMs = reportedMs;

            if (this._hasSeekedSignal) {
                if (this._isNearExpected(reportedMs)) this._setPosition(reportedMs);
            } else if (!this._isSeekGuarded()) {
                this._setPosition(reportedMs + this._reportBiasMs);
            } else if (this._isNearExpected(reportedMs)) {
                this._acceptPosition(reportedMs);
            } else {
                this._reportBiasMs = this._currentPositionMs() - reportedMs;
            }
        }

        _onSeeked(positionMs) {
            this._hasSeekedSignal = true;
            if (this._isSeekGuarded() && !this._isNearExpected(positionMs)) return;
            this._acceptPosition(positionMs);
        }

        _beginSeek(targetMs) {
            this._seekGuardUntil = monotonicMs() + SEEK_GUARD_MS;
            this._setPosition(targetMs);
        }

        _callSeek(offsetMs) {
            this._playerProxy.call('Seek', new GLib.Variant('(x)', [Math.round(offsetMs * 1000)]),
                Gio.DBusCallFlags.NONE, -1, this._cancellable, () => { });
        }

        _setPlaying(isPlaying) {
            if (isPlaying === this._isPlaying) return;
            const positionMs = this._currentPositionMs();
            this._isPlaying = isPlaying;
            this._setPosition(positionMs);
        }

        _queryPosition() {
            if (!this._playerProxy || !this._cancellable) return;
            const busName = this._activePlayerBus;
            this._playerProxy.call(
                'org.freedesktop.DBus.Properties.Get',
                new GLib.Variant('(ss)', [MPRIS_INTERFACE, 'Position']),
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (proxy, res) => {
                    let value;
                    try {
                        [value] = proxy.call_finish(res).recursiveUnpack();
                    } catch (_e) {
                        return;
                    }
                    if (this._isStale(busName)) return;

                    this._onReportedPosition(Math.floor(value / 1000));
                }
            );
        }

        _isStale(busName) {
            return !this._cancellable || this._activePlayerBus !== busName;
        }

        _syncState(force = false) {
            if (!this._playerProxy || !this._cancellable) return;
            const statusV = this._playerProxy.get_cached_property('PlaybackStatus');
            const status = statusV ? statusV.unpack() : 'Stopped';
            const wasPlaying = this._isPlaying;
            this._setPlaying(status === 'Playing');

            const metaV = this._playerProxy.get_cached_property('Metadata');
            if (metaV) this._parseMetadata(metaV.deepUnpack());

            if (force || wasPlaying !== this._isPlaying || this._currentMeta.changed) {
                this._currentMeta.changed = false;
                this._emitChange();
            }
        }

        _extractVariantString(val) {
            if (!val) return '';
            if (val.deepUnpack) {
                val = val.deepUnpack();
            } else if (val.unpack) {
                val = val.unpack();
            }

            if (Array.isArray(val)) {
                const parts = val
                    .map(item => this._extractVariantString(item))
                    .filter(item => item && item.length > 0);
                return parts.join(', ');
            }
            return String(val).trim();
        }

        _parseMetadata(meta) {
            if (!meta) return;

            const title = meta['xesam:title'] ? this._extractVariantString(meta['xesam:title']) : '';
            const artistV = meta['xesam:artist'] || meta['xesam:albumArtist'];
            const artist = artistV ? this._extractVariantString(artistV) : '';
            const album = meta['xesam:album'] ? this._extractVariantString(meta['xesam:album']) : '';
            const artUrl = meta['mpris:artUrl'] ? this._extractVariantString(meta['mpris:artUrl']) : '';
            const trackId = meta['mpris:trackid'] ? this._extractVariantString(meta['mpris:trackid']) : '';

            const rawLen = meta['mpris:length'];
            const lengthMicro = rawLen ? (rawLen.unpack ? rawLen.unpack() : Number(rawLen)) : 0;
            const duration = lengthMicro > 0 ? lengthMicro / 1000000 : 0;

            if ((!title || !artist) && this._metaRetries < METADATA_MAX_RETRIES) {
                this._scheduleMetadataFetch();
                return;
            }
            const current = this._currentMeta;
            const isSameTrack = current.title === title && current.artist === artist;
            const knownDuration = duration > 0 ? duration : (isSameTrack ? current.duration : 0);

            if (knownDuration > 0 || this._metaRetries >= METADATA_MAX_RETRIES) {
                this._cancelMetadataFetch();
                this._metaRetries = 0;
            } else {
                this._scheduleMetadataFetch();
            }

            if (isSameTrack && current.trackId === trackId && current.album === album && current.artUrl === artUrl &&
                current.duration === knownDuration) return;
            this._currentMeta = { trackId, title, artist, album, artUrl, duration: knownDuration, changed: true };
            if (!isSameTrack) this._resetPosition();
        }

        _scheduleMetadataFetch() {
            if (this._metaFetchId) return;
            this._metaFetchId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, METADATA_RETRY_MS, () => {
                this._metaFetchId = 0;
                this._fetchMetadata();
                return GLib.SOURCE_REMOVE;
            });
        }

        _cancelMetadataFetch() {
            if (this._metaFetchId) {
                this._tracker.remove(this._metaFetchId);
                this._metaFetchId = 0;
            }
        }

        _fetchMetadata() {
            if (!this._playerProxy || !this._cancellable) return;

            const busName = this._activePlayerBus;
            this._metaRetries++;
            this._playerProxy.call(
                'org.freedesktop.DBus.Properties.Get',
                new GLib.Variant('(ss)', [MPRIS_INTERFACE, 'Metadata']),
                Gio.DBusCallFlags.NONE,
                1000,
                this._cancellable,
                (proxy, res) => {
                    let meta;
                    try {
                        const [metaVariant] = proxy.call_finish(res).deepUnpack();
                        meta = metaVariant.deepUnpack();
                    } catch (_e) {
                        if (!this._isStale(busName) && this._metaRetries < METADATA_MAX_RETRIES) this._scheduleMetadataFetch();
                        return;
                    }
                    if (this._isStale(busName)) return;

                    this._parseMetadata(meta);
                    if (this._currentMeta.changed) {
                        this._currentMeta.changed = false;
                        this._emitChange();
                    }
                }
            );
        }

        _emitChange() {
            const meta = this._currentMeta;
            this.emit('playback-state-changed', this._isPlaying, meta.title, meta.artist, meta.artUrl, meta.duration, this._hasPlayer);
        }

        seekPosition(positionMs) {
            if (!this._playerProxy || !this._cancellable) return;
            const busName = this._activePlayerBus;
            const fromMs = this._currentPositionMs();
            const targetMs = Math.max(0, positionMs);
            this._beginSeek(targetMs);

            this._playerProxy.call(
                'SetPosition',
                new GLib.Variant('(ox)', [this._currentMeta.trackId || DEFAULT_TRACK_ID, Math.round(targetMs * 1000)]),
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (proxy, res) => {
                    try {
                        proxy.call_finish(res);
                    } catch (_e) {
                        if (!this._isStale(busName)) this._callSeek(targetMs - fromMs);
                    }
                }
            );
        }

        sendControl(method) {
            if (!this._playerProxy || !this._cancellable) return;
            this._playerProxy.call(method, null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                } catch (_e) {
                    return;
                }
                if (!this._tracker) return;
                if (this._controlSyncId) this._tracker.remove(this._controlSyncId);
                this._controlSyncId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._controlSyncId = 0;
                    this._syncState();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }

        get album() {
            return this._currentMeta.album;
        }

        _cachedProperty(name) {
            return this._playerProxy ? this._playerProxy.get_cached_property(name) : null;
        }

        get canShuffle() {
            return Boolean(this._cachedProperty('Shuffle'));
        }

        get isShuffle() {
            const value = this._cachedProperty('Shuffle');
            return value ? value.unpack() : false;
        }

        get canLoop() {
            return Boolean(this._cachedProperty('LoopStatus'));
        }

        get loopStatus() {
            const value = this._cachedProperty('LoopStatus');
            return value ? value.unpack() : 'None';
        }

        _setPlayerProperty(name, value) {
            if (!this._playerProxy || !this._cancellable) return;
            this._playerProxy.call(
                'org.freedesktop.DBus.Properties.Set',
                new GLib.Variant('(ssv)', [MPRIS_INTERFACE, name, value]),
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                () => {}
            );
        }

        changeVolume(step) {
            const current = this._cachedProperty('Volume');
            const currentVol = current ? current.unpack() : 0.5;
            this._setPlayerProperty('Volume', new GLib.Variant('d', Math.max(0.0, Math.min(1.0, currentVol + step))));
        }

        toggleShuffle() {
            this._setPlayerProperty('Shuffle', new GLib.Variant('b', !this.isShuffle));
        }

        cycleLoop() {
            const next = LOOP_ORDER[(LOOP_ORDER.indexOf(this.loopStatus) + 1) % LOOP_ORDER.length];
            this._setPlayerProperty('LoopStatus', new GLib.Variant('s', next));
        }

        seekBy(offsetMs) {
            if (!this._playerProxy || !this._cancellable) return;
            this._beginSeek(this._currentPositionMs() + offsetMs);
            this._callSeek(offsetMs);
        }

        _dockButtonFor(app, dockUI) {
            if (!dockUI || !dockUI.boxActor) return null;
            const appId = app.get_id();
            return dockUI.boxActor.get_children().find(child => {
                const delegateApp = child._delegate ? child._delegate.app : null;
                return Boolean(delegateApp) && Boolean(delegateApp.get_id) && delegateApp.get_id() === appId;
            }) || null;
        }

        togglePlayerWindow(dockUI = null) {
            const entry = this._players.get(this._activePlayerBus);
            if (!entry || !this._cancellable) return;

            const app = entry.app;
            const win = app ? app.get_windows()[0] : null;
            if (!win) {
                if (entry.root) entry.root.call('Raise', null, Gio.DBusCallFlags.NONE, -1, this._cancellable, () => { });
                else if (app) app.activate();
                return;
            }

            const button = this._dockButtonFor(app, dockUI);
            const dockPos = dockUI ? dockUI.dockPosition : 'BOTTOM';

            if (win.has_focus() && !win.minimized) {
                if (button) animateMinimize(win, button, dockPos);
                else win.minimize();
            } else if (button) {
                animateRestore(win, button, dockPos);
            } else {
                win.unminimize();
                win.activate(global.get_current_time());
            }
        }

        destroy() {
            if (this._cancellable) {
                this._cancellable.cancel();
                this._cancellable = null;
            }
            if (this._tracker) {
                this._tracker.destroy();
                this._tracker = null;
            }
            if (this._ownerSignalId) {
                Gio.DBus.session.signal_unsubscribe(this._ownerSignalId);
                this._ownerSignalId = 0;
            }
            for (const entry of this._players.values()) {
                if (entry.proxy) entry.proxy.disconnectObject(this);
            }
            this._players.clear();
            this._playerProxy = null;
        }
    });