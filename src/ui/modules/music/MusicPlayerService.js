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

export const MusicPlayerService = GObject.registerClass({
    Signals: {
        'playback-state-changed': { param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_DOUBLE, GObject.TYPE_BOOLEAN] },
        'position-changed': { param_types: [GObject.TYPE_INT, GObject.TYPE_INT64] },
    },
},
class MusicPlayerService extends GObject.Object {
    _init() {
        super._init();
        this._tracker = new TimeoutTracker();
        this._activePlayerBus = null;
        this._playerProxy = null;
        this._propProxy = null;
        this._rootProxy = null;
        this._isPlaying = false;
        this._hasPlayer = false;
        this._currentMeta = { trackId: '', title: '', artist: '', artUrl: '', duration: 0, changed: false };

        this._initDBus();
        this._startHeartbeat();
        this._startPositionTracker();
    }

    _initDBus() {
        this._dbusProxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            null
        );

        this._ownerSignalId = this._dbusProxy.connectSignal('NameOwnerChanged', (_proxy, _sender, args) => {
            const name = args[0];
            const oldOwner = args[1];
            const newOwner = args[2];

            if (name === SPOTIFY_BUS_NAME) {
                if (newOwner && (!oldOwner || oldOwner === '')) {
                    this._bindPlayer(name);
                } else if (!newOwner || newOwner === '') {
                    this._handlePlayerClosed();
                }
            }
        });

        this._findActivePlayer();
    }

    _handlePlayerClosed() {
        if (this._propProxy && this._propSubId) {
            this._propProxy.disconnectSignal(this._propSubId);
            this._propSubId = null;
        }
        this._activePlayerBus = null;
        this._playerProxy = null;
        this._propProxy = null;
        this._rootProxy = null;
        this._isPlaying = false;
        this._hasPlayer = false;
        this._currentMeta = { trackId: '', title: '', artist: '', artUrl: '', duration: 0, changed: false };
        this.emit('playback-state-changed', false, '', '', '', 0, false);
    }

    _startHeartbeat() {
        this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 1500, () => {
            if (!this._activePlayerBus) {
                this._findActivePlayer();
            } else {
                this._verifyPlayerAlive();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    refreshNow() {
        if (!this._activePlayerBus) {
            this._findActivePlayer();
        }
        this._syncState();
        this._currentMeta.changed = true;
        this._emitChange();
    }

    _verifyPlayerAlive() {
        if (!this._dbusProxy || !this._activePlayerBus) return;
        try {
            const res = this._dbusProxy.call_sync(
                'GetNameOwner',
                new GLib.Variant('(s)', [SPOTIFY_BUS_NAME]),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            const unpacked = res ? res.recursiveUnpack() : null;
            if (!unpacked || !unpacked[0]) {
                this._handlePlayerClosed();
            } else {
                this._syncState();
            }
        } catch (_e) {
            this._handlePlayerClosed();
        }
    }

    _startPositionTracker() {
        this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 250, () => {
            if (this._hasPlayer && this._propProxy && this._isPlaying && this._activePlayerBus) {
                this._propProxy.call(
                    'Get',
                    new GLib.Variant('(ss)', [MPRIS_INTERFACE, 'Position']),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (proxy, res) => {
                        try {
                            const reply = proxy.call_finish(res);
                            if (reply) {
                                const unpacked = reply.recursiveUnpack();
                                const val = unpacked[0];
                                const posMs = Math.floor(val / 1000);
                                const monoMs = GLib.get_monotonic_time() / 1000;
                                this.emit('position-changed', posMs, monoMs);
                            }
                        } catch (_e) {
                            this._handlePlayerClosed();
                        }
                    }
                );
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _findActivePlayer() {
        if (!this._dbusProxy) return;
        try {
            const res = this._dbusProxy.call_sync(
                'GetNameOwner',
                new GLib.Variant('(s)', [SPOTIFY_BUS_NAME]),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            const unpacked = res ? res.recursiveUnpack() : null;
            if (unpacked && unpacked[0]) {
                if (this._activePlayerBus !== SPOTIFY_BUS_NAME) {
                    this._bindPlayer(SPOTIFY_BUS_NAME);
                }
            } else {
                this._handlePlayerClosed();
            }
        } catch (_e) {
            this._handlePlayerClosed();
        }
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
            null,
            (_proxy, res) => {
                try {
                    this._playerProxy = Gio.DBusProxy.new_for_bus_finish(res);
                    if (this._playerProxy) {
                        this._bindProperties(busName);
                        this._bindRoot(busName);
                        this._syncState();
                    } else {
                        this._handlePlayerClosed();
                    }
                } catch (_e) {
                    this._handlePlayerClosed();
                }
            }
        );
    }

    _bindRoot(busName) {
        try {
            this._rootProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                MPRIS_PATH,
                'org.mpris.MediaPlayer2',
                null
            );
        } catch (_e) {
            this._rootProxy = null;
        }
    }

    _bindProperties(busName) {
        if (this._propProxy && this._propSubId) {
            this._propProxy.disconnectSignal(this._propSubId);
            this._propSubId = null;
        }

        try {
            this._propProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                MPRIS_PATH,
                'org.freedesktop.DBus.Properties',
                null
            );

            this._propSubId = this._propProxy.connectSignal('PropertiesChanged', (_proxy, _sender, args) => {
                const changed = args[1];
                const unpacked = changed.deepUnpack();
                if (unpacked.PlaybackStatus) {
                    this._isPlaying = (unpacked.PlaybackStatus.unpack() === 'Playing');
                }
                if (unpacked.Metadata) {
                    this._parseMetadata(unpacked.Metadata.deepUnpack());
                }
                this._emitChange();
            });
        } catch (_e) {
            this._handlePlayerClosed();
        }
    }

    _syncState() {
        if (!this._playerProxy) return;
        try {
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
        } catch (_e) {
            this._handlePlayerClosed();
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

        let title = '';
        if (meta['xesam:title']) {
            title = this._extractVariantString(meta['xesam:title']);
        }

        let artist = '';
        if (meta['xesam:artist']) {
            artist = this._extractVariantString(meta['xesam:artist']);
        } else if (meta['xesam:albumArtist']) {
            artist = this._extractVariantString(meta['xesam:albumArtist']);
        }

        let artUrl = '';
        if (meta['mpris:artUrl']) {
            artUrl = this._extractVariantString(meta['mpris:artUrl']);
        }

        let trackId = '';
        if (meta['mpris:trackid']) {
            trackId = this._extractVariantString(meta['mpris:trackid']);
        }

        let lengthMicro = 0;
        if (meta['mpris:length']) {
            const rawLen = meta['mpris:length'];
            lengthMicro = rawLen.unpack ? rawLen.unpack() : Number(rawLen);
        }
        const durationSec = lengthMicro > 0 ? lengthMicro / 1000000 : 0;

        if (this._currentMeta.title !== title || this._currentMeta.artUrl !== artUrl || this._currentMeta.artist !== artist || this._currentMeta.trackId !== trackId) {
            this._currentMeta = {
                trackId: trackId || '/org/mpris/MediaPlayer2/CurrentTrack',
                title: title || 'Unknown Title',
                artist: artist || 'Unknown Artist',
                artUrl: artUrl || '',
                duration: durationSec,
                changed: true,
            };
        }
    }

    _emitChange() {
        const dur = this._currentMeta.duration ? this._currentMeta.duration : 0;
        this.emit('playback-state-changed', this._isPlaying, this._currentMeta.title, this._currentMeta.artist, this._currentMeta.artUrl, dur, this._hasPlayer);
    }

    seekPosition(positionMs) {
        if (!this._playerProxy) return;
        const trackId = this._currentMeta.trackId || '/org/mpris/MediaPlayer2/CurrentTrack';
        const positionMicro = Math.round(positionMs * 1000);

        this._playerProxy.call(
            'SetPosition',
            new GLib.Variant('(ox)', [trackId, positionMicro]),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => {
                this._syncState();
            }
        );
    }

    sendControl(method) {
        if (!this._playerProxy) return;
        this._playerProxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, () => {
            this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
                this._syncState();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    changeVolume(step) {
        if (!this._playerProxy || !this._propProxy) return;
        const currentVariant = this._playerProxy.get_cached_property('Volume');
        const currentVol = currentVariant ? currentVariant.unpack() : 0.5;
        const targetVol = Math.max(0.0, Math.min(1.0, currentVol + step));

        this._propProxy.call(
            'Set',
            new GLib.Variant('(ssv)', [MPRIS_INTERFACE, 'Volume', new GLib.Variant('d', targetVol)]),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => {}
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

        if (this._rootProxy) {
            this._rootProxy.call('Raise', null, Gio.DBusCallFlags.NONE, -1, null, () => {});
            return;
        }

        const app = Gio.DesktopAppInfo.new('spotify.desktop') || Gio.DesktopAppInfo.new('com.spotify.Client.desktop');
        if (app) app.launch([], null);
    }

    destroy() {
        if (this._tracker) {
            this._tracker.destroy();
            this._tracker = null;
        }
        if (this._dbusProxy && this._ownerSignalId) {
            this._dbusProxy.disconnectSignal(this._ownerSignalId);
            this._ownerSignalId = null;
        }
        if (this._propProxy && this._propSubId) {
            this._propProxy.disconnectSignal(this._propSubId);
            this._propSubId = null;
        }
        this._playerProxy = null;
        this._propProxy = null;
        this._rootProxy = null;
    }
});