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
import GObject from 'gi://GObject';

import { TimeoutTracker } from '../../../core/TimeoutTracker.js';
import { animateMinimize, animateRestore } from '../../effects/WindowEffects.js';


const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const SPOTIFY_BUS_NAME = 'org.mpris.MediaPlayer2.spotify';
const METADATA_RETRY_MS = 250;
const METADATA_MAX_RETRIES = 8;
const EMPTY_META = { trackId: '', title: '', artist: '', album: '', url: '', artUrl: '', duration: 0, changed: false };
const LOOP_ORDER = ['None', 'Playlist', 'Track'];

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
            this._activePlayerBus = null;
            this._playerProxy = null;
            this._rootProxy = null;
            this._isPlaying = false;
            this._hasPlayer = false;
            this._currentMeta = { ...EMPTY_META };

            this._initDBus();
            this._startPositionTracker();
        }

        _initDBus() {
            this._ownerSignalId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                SPOTIFY_BUS_NAME,
                Gio.DBusSignalFlags.NONE,
                (_connection, _sender, _path, _iface, _signal, params) => {
                    const [, oldOwner, newOwner] = params.deepUnpack();
                    if (newOwner && !oldOwner) this._bindPlayer(SPOTIFY_BUS_NAME);
                    else if (!newOwner) this._handlePlayerClosed();
                }
            );

            this._findActivePlayer();
        }

        _handlePlayerClosed() {
            if (!this._cancellable || (!this._activePlayerBus && !this._hasPlayer)) return;

            this._disconnectPlayer();
            this._cancelMetadataFetch();
            this._metaRetries = 0;
            this._activePlayerBus = null;
            this._rootProxy = null;
            this._isPlaying = false;
            this._hasPlayer = false;
            this._currentMeta = { ...EMPTY_META };
            this.emit('playback-state-changed', false, '', '', '', 0, false);
        }

        _startPositionTracker() {
            if (this._posTrackerId) {
                this._tracker.remove(this._posTrackerId);
                this._posTrackerId = 0;
            }
            this._posTrackerId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 250, () => {
                if (this._isPlaying) this._queryPosition();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _queryPosition() {
            if (!this._hasPlayer || !this._playerProxy || !this._activePlayerBus || !this._cancellable) return;
            this._playerProxy.call(
                'org.freedesktop.DBus.Properties.Get',
                new GLib.Variant('(ss)', [MPRIS_INTERFACE, 'Position']),
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (proxy, res) => {
                    try {
                        const reply = proxy.call_finish(res);
                        if (!this._cancellable) return;
                        if (reply) {
                            const unpacked = reply.recursiveUnpack();
                            const val = unpacked[0];
                            const posMs = Math.floor(val / 1000);
                            const monoMs = GLib.get_monotonic_time() / 1000;
                            this.emit('position-changed', posMs, monoMs);
                        }
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            this._handlePlayerClosed();
                        }
                    }
                }
            );
        }

        _findActivePlayer() {
            Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'NameHasOwner',
                new GLib.Variant('(s)', [SPOTIFY_BUS_NAME]),
                new GLib.VariantType('(b)'),
                Gio.DBusCallFlags.NONE,
                1000,
                this._cancellable,
                (connection, res) => {
                    let hasOwner;
                    try {
                        [hasOwner] = connection.call_finish(res).deepUnpack();
                    } catch (_e) {
                        return;
                    }
                    if (hasOwner && this._activePlayerBus !== SPOTIFY_BUS_NAME) this._bindPlayer(SPOTIFY_BUS_NAME);
                }
            );
        }

        _isStale(busName) {
            return !this._cancellable || this._activePlayerBus !== busName;
        }

        _bindPlayer(busName) {
            this._activePlayerBus = busName;
            this._hasPlayer = true;

            Gio.DBusProxy.new_for_bus(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                MPRIS_PATH,
                MPRIS_INTERFACE,
                this._cancellable,
                (_proxy, res) => {
                    let proxy;
                    try {
                        proxy = Gio.DBusProxy.new_for_bus_finish(res);
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) && !this._isStale(busName)) {
                            this._handlePlayerClosed();
                        }
                        return;
                    }
                    if (this._isStale(busName)) return;

                    this._disconnectPlayer();
                    this._playerProxy = proxy;
                    proxy.connectObject('g-properties-changed', (_proxy, changed) => {
                        const unpacked = changed.deepUnpack();
                        if (unpacked.PlaybackStatus) {
                            this._isPlaying = unpacked.PlaybackStatus.unpack() === 'Playing';
                        }
                        if (unpacked.Metadata) {
                            this._parseMetadata(unpacked.Metadata.deepUnpack());
                        }
                        this._emitChange();
                    }, this);
                    this._bindRoot(busName);
                    this._syncState();
                }
            );
        }

        _bindRoot(busName) {
            Gio.DBusProxy.new_for_bus(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES | Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
                null,
                busName,
                MPRIS_PATH,
                'org.mpris.MediaPlayer2',
                this._cancellable,
                (_proxy, res) => {
                    let proxy;
                    try {
                        proxy = Gio.DBusProxy.new_for_bus_finish(res);
                    } catch (_e) {
                        return;
                    }
                    if (!this._isStale(busName)) this._rootProxy = proxy;
                }
            );
        }

        _disconnectPlayer() {
            if (this._playerProxy) this._playerProxy.disconnectObject(this);
            this._playerProxy = null;
        }

        _syncState() {
            if (!this._playerProxy || !this._cancellable) return;
            const statusV = this._playerProxy.get_cached_property('PlaybackStatus');
            const status = statusV ? statusV.unpack() : 'Stopped';
            const wasPlaying = this._isPlaying;
            this._isPlaying = (status === 'Playing');

            const metaV = this._playerProxy.get_cached_property('Metadata');
            if (metaV) this._parseMetadata(metaV.deepUnpack());

            if (wasPlaying !== this._isPlaying || this._currentMeta.changed) {
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
            const url = meta['xesam:url'] ? this._extractVariantString(meta['xesam:url']) : '';
            const artUrl = meta['mpris:artUrl'] ? this._extractVariantString(meta['mpris:artUrl']) : '';
            const trackId = meta['mpris:trackid'] ? this._extractVariantString(meta['mpris:trackid']) : '';

            const rawLen = meta['mpris:length'];
            const lengthMicro = rawLen ? (rawLen.unpack ? rawLen.unpack() : Number(rawLen)) : 0;
            const duration = lengthMicro > 0 ? lengthMicro / 1000000 : 0;

            if ((!title || !artist) && this._metaRetries < METADATA_MAX_RETRIES) {
                this._scheduleMetadataFetch();
                return;
            }
            this._cancelMetadataFetch();
            this._metaRetries = 0;

            const current = this._currentMeta;
            if (current.title === title && current.artist === artist && current.artUrl === artUrl && current.trackId === trackId &&
                current.album === album && current.url === url) return;
            this._currentMeta = { trackId, title, artist, album, url, artUrl, duration, changed: true };
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
            const dur = this._currentMeta.duration ? this._currentMeta.duration : 0;
            this.emit('playback-state-changed', this._isPlaying, this._currentMeta.title, this._currentMeta.artist, this._currentMeta.artUrl, dur, this._hasPlayer);
        }

        seekPosition(positionMs) {
            if (!this._playerProxy || !this._cancellable) return;
            const trackId = this._currentMeta.trackId || '/org/mpris/MediaPlayer2/CurrentTrack';
            const positionMicro = Math.round(positionMs * 1000);

            this._playerProxy.call(
                'SetPosition',
                new GLib.Variant('(ox)', [trackId, positionMicro]),
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (proxy, res) => {
                    proxy.call_finish(res);
                    if (this._cancellable) this._syncState();
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
                if (this._controlSyncId) {
                    this._tracker.remove(this._controlSyncId);
                    this._controlSyncId = 0;
                }
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

        get trackUrl() {
            return this._currentMeta.url;
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
            this._playerProxy.call(
                'Seek',
                new GLib.Variant('(x)', [Math.round(offsetMs * 1000)]),
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                () => this._queryPosition()
            );
        }

        togglePlayerWindow(dockUI = null) {
            const winList = global.display.get_tab_list(0, null);
            let spotifyWin = null;

            for (let i = 0; i < winList.length; i++) {
                const win = winList[i];
                const wmClass = win.get_wm_class ? win.get_wm_class() : '';
                const title = win.get_title ? win.get_title() : '';

                if (
                    (wmClass && wmClass.toLowerCase().indexOf('spotify') !== -1) ||
                    (title && title.toLowerCase().indexOf('spotify') !== -1)
                ) {
                    spotifyWin = win;
                    break;
                }
            }

            if (spotifyWin) {
                let spotifyBtn = null;
                if (dockUI && dockUI.boxActor) {
                    const children = dockUI.boxActor.get_children();
                    for (let i = 0; i < children.length; i++) {
                        const child = children[i];
                        const appId = child._delegate && child._delegate.app && child._delegate.app.get_id ? child._delegate.app.get_id() : '';
                        if (appId && appId.toLowerCase().indexOf('spotify') !== -1) {
                            spotifyBtn = child;
                            break;
                        }
                    }
                }

                const dockPos = dockUI ? dockUI.dockPosition : 'BOTTOM';

                if (spotifyWin.has_focus() && !spotifyWin.minimized) {
                    if (spotifyBtn) {
                        animateMinimize(spotifyWin, spotifyBtn, dockPos);
                    } else {
                        spotifyWin.minimize();
                    }
                } else {
                    if (spotifyBtn) {
                        animateRestore(spotifyWin, spotifyBtn, dockPos);
                    } else {
                        spotifyWin.unminimize();
                        spotifyWin.activate(global.get_current_time());
                    }
                }
                return;
            }

            if (this._rootProxy && this._cancellable) {
                this._rootProxy.call('Raise', null, Gio.DBusCallFlags.NONE, -1, this._cancellable, () => { });
                return;
            }

            const app = Gio.DesktopAppInfo.new('spotify.desktop') || Gio.DesktopAppInfo.new('com.spotify.Client.desktop');
            if (app) app.launch([], null);
        }

        destroy() {
            if (this._cancellable) {
                this._cancellable.cancel();
                this._cancellable = null;
            }
            if (this._tracker) {
                if (this._posTrackerId) {
                    this._tracker.remove(this._posTrackerId);
                    this._posTrackerId = 0;
                }
                if (this._controlSyncId) {
                    this._tracker.remove(this._controlSyncId);
                    this._controlSyncId = 0;
                }
                this._cancelMetadataFetch();
                this._tracker.destroy();
                this._tracker = null;
            }
            if (this._ownerSignalId) {
                Gio.DBus.session.signal_unsubscribe(this._ownerSignalId);
                this._ownerSignalId = 0;
            }
            this._disconnectPlayer();
            this._rootProxy = null;
        }
    });