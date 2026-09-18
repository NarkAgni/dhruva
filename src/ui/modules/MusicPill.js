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
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { CrispLabel } from './music/CrispLabel.js';
import { isActorAlive } from '../../core/Utils.js';
import { LyricsClient } from './music/LyricsClient.js';
import { Settings } from '../../core/SettingsManager.js';
import { MusicPillSlider } from './music/MusicPillSlider.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { MusicPlayerService } from './music/MusicPlayerService.js';
import { resetMagnification } from '../magnifier/MagnifierReset.js';
import { KaraokeLyricsWidget } from './music/KaraokeLyricsWidget.js';
import { extractColorsFromPixbuf } from './music/MusicColorExtractor.js';
import { isPointerWithinDockBounds } from '../magnifier/MagnifierMath.js';


Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const MARQUEE_PAUSE_MS = 1200;
const MARQUEE_MIN_DURATION_MS = 3500;
const MARQUEE_MS_PER_PX = 42;
const LYRICS_REVEAL_DELAY_MS = 1200;
const DOUBLE_CLICK_TIMEOUT_MS = 250;

export const MusicPill = GObject.registerClass(
    class MusicPill extends St.Widget {
        _init(dockUI, settings) {
            super._init({
                name: 'DhruvaMusicPill',
                style_class: 'dhruva-music-pill-container',
                reactive: true,
                track_hover: true,
                clip_to_allocation: false,
                layout_manager: new Clutter.BinLayout(),
            });

            this._dockUI = dockUI;
            this._settings = settings;
            this._tracker = new TimeoutTracker();
            this._isModule = true;
            this._isStatic = true;
            this._isMusicPill = true;
            this._isHovered = false;
            this._isDestroyed = false;
            this._lastArtUrl = null;
            this._hasValidTrack = false;
            this._isPlaying = false;

            this._lyrics = [];
            this._currentLyricIndex = -1;
            this._activeTrackId = '';
            this._isLyricsVisible = false;

            this._durationSec = 1;
            this._lastBasePositionMs = 0;
            this._lastPositionTimeMs = GLib.get_monotonic_time() / 1000;
            this._interpolatedTickId = 0;

            this._lastClickTime = 0;
            this._modeTransitionTimeoutId = null;
            this._lyricsReadyForTrack = false;

            this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dhruva-music-art']);
            GLib.mkdir_with_parents(this._cacheDir, 0o755);

            this._httpSession = new Soup.Session();
            this._httpSession.timeout = 10;
            this._httpSession.user_agent = 'Mozilla/5.0';

            this._service = new MusicPlayerService();
            this._lyricsClient = new LyricsClient();

            this._buildUI();

            this._service.connectObject('playback-state-changed',
                (_service, isPlaying, title, artist, artUrl, duration, hasPlayer) => {
                    this._durationSec = duration > 0 ? duration : 1;
                    this._handlePlaybackEvent(isPlaying, title, artist, artUrl, duration, hasPlayer);
                }, this);

            this._service.connectObject('position-changed',
                (_service, positionMs, monoMs) => {
                    this._lastBasePositionMs = positionMs;
                    this._lastPositionTimeMs = monoMs || (GLib.get_monotonic_time() / 1000);
                    this._updateSliderProgress(positionMs);
                }, this);

            this.connectObject('notify::hover', () => {
                if (this._isDestroyed) return;
                this._isHovered = this.hover;
                this._setSideButtonsVisible(this._isHovered);

                const dockActor = this._dockUI && this._dockUI.actor;
                if (dockActor) {
                    if (this._isHovered) {
                        dockActor._suppressZoom = true;
                        resetMagnification(dockActor, 160, false);
                    } else {
                        dockActor._suppressZoom = false;
                        const [cx, cy] = global.get_pointer();
                        const isVert = this._dockUI.dockPosition === 'LEFT' || this._dockUI.dockPosition === 'RIGHT';
                        if (!isPointerWithinDockBounds(dockActor, cx, cy, isVert, this._settings)) {
                            resetMagnification(dockActor, 160, false);
                        }
                    }
                }
            }, this);

            this.connectObject('scroll-event', (_actor, event) => {
                if (!this._isHovered || !this._service) return Clutter.EVENT_PROPAGATE;

                const dir = event.get_scroll_direction();
                if (dir === Clutter.ScrollDirection.UP) {
                    this._service.changeVolume(0.05);
                    return Clutter.EVENT_STOP;
                } else if (dir === Clutter.ScrollDirection.DOWN) {
                    this._service.changeVolume(-0.05);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.connectObject('button-press-event', (_actor, event) => {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

                const target = event.get_source ? event.get_source() : null;
                const isControlBtn = (btn) => {
                    if (!btn || !target) return false;
                    if (target === btn) return true;
                    if (btn.contains && target instanceof Clutter.Actor) {
                        return btn.contains(target);
                    }
                    return false;
                };

                if (isControlBtn(this._prevBtn) || isControlBtn(this._playBtn) || isControlBtn(this._nextBtn)) {
                    return Clutter.EVENT_PROPAGATE;
                }

                const now = Date.now();
                if (now - this._lastClickTime <= DOUBLE_CLICK_TIMEOUT_MS) {
                    this._lastClickTime = 0;
                    if (this._service) {
                        this._service.togglePlayerWindow(this._dockUI);
                    }
                    return Clutter.EVENT_STOP;
                }

                this._lastClickTime = now;
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.hide();
        }

        _buildUI() {
            this._pillBg = new St.Widget({
                style_class: 'dhruva-music-pill',
                x_expand: true,
                y_expand: true,
                reactive: false,
            });
            this.add_child(this._pillBg);

            this._mainBox = new St.BoxLayout({
                vertical: false,
                reactive: true,
                style_class: 'dhruva-music-pill',
                style: 'background-color: transparent; border: none; box-shadow: none;',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._mainBox);

            this._slider = new MusicPillSlider();
            this.add_child(this._slider);

            this._artBin = new St.Bin({
                style_class: 'dhruva-music-art-bin',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                reactive: false,
            });

            this._artFallbackIcon = new St.Icon({
                icon_size: 16,
                icon_name: 'audio-x-generic-symbolic',
                opacity: 180,
            });
            this._artBin.set_child(this._artFallbackIcon);
            this._mainBox.add_child(this._artBin);

            this._metaViewport = new St.Widget({
                style_class: 'dhruva-music-meta-box',
                clip_to_allocation: true,
                layout_manager: new Clutter.BinLayout(),
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._infoBox = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            const makeMarqueeRow = (styleClass, xAlign, fontDesc, color) => {
                const viewport = new St.Widget({
                    clip_to_allocation: true,
                    layout_manager: new Clutter.BinLayout(),
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: xAlign,
                });

                const scrollBin = new St.Widget({
                    layout_manager: new Clutter.BinLayout(),
                    x_align: Clutter.ActorAlign.START,
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: false,
                });

                const label = new CrispLabel({
                    font_desc: fontDesc,
                    color: color,
                    style_class: styleClass,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: Clutter.ActorAlign.START,
                });

                scrollBin.add_child(label);
                viewport.add_child(scrollBin);

                return { viewport, scrollBin, label };
            };

            const titleRow = makeMarqueeRow(
                'dhruva-music-title',
                Clutter.ActorAlign.START,
                'Sans Bold 11px',
                'rgba(255,255,255,1.0)'
            );
            this._titleViewport = titleRow.viewport;
            this._titleScroll = titleRow.scrollBin;
            this._titleLabel = titleRow.label;

            const artistRow = makeMarqueeRow(
                'dhruva-music-artist',
                Clutter.ActorAlign.START,
                'Sans 10px',
                'rgba(255,255,255,0.75)'
            );
            this._artistViewport = artistRow.viewport;
            this._artistScroll = artistRow.scrollBin;
            this._artistLabel = artistRow.label;

            this._infoBox.add_child(this._titleViewport);
            this._infoBox.add_child(this._artistViewport);
            this._metaViewport.add_child(this._infoBox);

            this._lyricsBox = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                opacity: 0,
                visible: false,
                style: 'spacing: 1px;',
            });

            const miniRow = makeMarqueeRow(
                'dhruva-music-mini-title',
                Clutter.ActorAlign.CENTER,
                'Sans Bold 10.5px',
                'rgba(255,255,255,1.0)'
            );
            this._miniViewport = miniRow.viewport;
            this._miniScroll = miniRow.scrollBin;
            this._lyricsHeaderTitle = miniRow.label;

            this._karaokeWidget = new KaraokeLyricsWidget(160, 18);

            this._lyricsBox.add_child(this._miniViewport);
            this._lyricsBox.add_child(this._karaokeWidget);
            this._metaViewport.add_child(this._lyricsBox);

            this._mainBox.add_child(this._metaViewport);

            this._controlsBox = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._prevBtn = new St.Button({
                style_class: 'dhruva-music-btn',
                child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 13 }),
                opacity: 0,
                width: 0,
                reactive: false,
                clip_to_allocation: true,
            });
            this._prevBtn.set_scale(0.3, 0.3);
            this._prevBtn.set_pivot_point(0.5, 0.5);
            this._prevBtn.connectObject('clicked', () => {
                if (!this._isDestroyed && this._service) this._service.sendControl('Previous');
            }, this);

            this._playIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 14 });
            this._playBtn = new St.Button({
                style_class: 'dhruva-music-btn dhruva-music-btn-play',
                child: this._playIcon,
                reactive: true,
            });
            this._playBtn.connectObject('clicked', () => {
                if (!this._isDestroyed && this._service) this._service.sendControl('PlayPause');
            }, this);

            this._nextBtn = new St.Button({
                style_class: 'dhruva-music-btn',
                child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 13 }),
                opacity: 0,
                width: 0,
                reactive: false,
                clip_to_allocation: true,
            });
            this._nextBtn.set_scale(0.3, 0.3);
            this._nextBtn.set_pivot_point(0.5, 0.5);
            this._nextBtn.connectObject('clicked', () => {
                if (!this._isDestroyed && this._service) this._service.sendControl('Next');
            }, this);

            this._controlsBox.add_child(this._prevBtn);
            this._controlsBox.add_child(this._playBtn);
            this._controlsBox.add_child(this._nextBtn);
            this._mainBox.add_child(this._controlsBox);
        }

        _startLyricsSyncLoop() {
            if (this._interpolatedTickId) {
                this._tracker.remove(this._interpolatedTickId);
                this._interpolatedTickId = 0;
            }

            this._interpolatedTickId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 50, () => {
                if (this._isDestroyed || !isActorAlive(this)) {
                    this._interpolatedTickId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                if (this._isPlaying) {
                    const nowMono = GLib.get_monotonic_time() / 1000;
                    const elapsed = Math.max(0, nowMono - this._lastPositionTimeMs);
                    const accuratePositionMs = this._lastBasePositionMs + elapsed;

                    this._updateSliderProgress(accuratePositionMs);

                    if (this._lyrics && this._lyrics.length > 0) {
                        this._syncLyricsToPosition(accuratePositionMs);
                    }
                }

                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopLyricsSyncLoop() {
            if (this._interpolatedTickId) {
                this._tracker.remove(this._interpolatedTickId);
                this._interpolatedTickId = 0;
            }
        }

        _updateSliderProgress(positionMs) {
            if (!this._slider || !isActorAlive(this._slider)) return;
            const totalMs = Math.max(1000, this._durationSec * 1000);
            const ratio = Math.max(0.0, Math.min(1.0, positionMs / totalMs));
            this._slider.setProgress(ratio);
        }

        _syncLyricsToPosition(positionMs) {
            let activeIdx = -1;
            for (let i = this._lyrics.length - 1; i >= 0; i--) {
                if (positionMs >= this._lyrics[i].time) {
                    activeIdx = i;
                    break;
                }
            }

            if (activeIdx !== -1) {
                if (!this._isLyricsVisible && !this._modeTransitionTimeoutId) {
                    this._switchMode(true);
                }

                if (activeIdx !== this._currentLyricIndex) {
                    this._currentLyricIndex = activeIdx;

                    let lineDurationMs = 3500;
                    if (activeIdx + 1 < this._lyrics.length) {
                        const rawGap = this._lyrics[activeIdx + 1].time - this._lyrics[activeIdx].time;
                        lineDurationMs = Math.max(800, rawGap);
                    }

                    if (isActorAlive(this._karaokeWidget)) {
                        this._karaokeWidget.setLyricLine(this._lyrics[activeIdx].text, lineDurationMs);
                    }
                }
            }
        }

        _scheduleMarquee(scrollBin, viewport, label) {
            if (this._isDestroyed) return;
            if (!isActorAlive(scrollBin) || !isActorAlive(viewport) || !isActorAlive(label)) return;

            this._cancelMarquee(scrollBin);

            const idleId = this._tracker.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                if (!isActorAlive(scrollBin) || !isActorAlive(viewport) || !isActorAlive(label)) {
                    return GLib.SOURCE_REMOVE;
                }
                scrollBin._marqueeIdleId = null;

                const [, textWidth] = label.get_preferred_width(-1);
                const containerWidth = viewport.get_width()
                    || viewport.get_preferred_width(-1)[1]
                    || 0;

                if (containerWidth <= 0 || textWidth <= containerWidth) {
                    scrollBin.translation_x = 0;
                    return GLib.SOURCE_REMOVE;
                }

                const overflow = textWidth - containerWidth;
                const scrollDuration = Math.max(MARQUEE_MIN_DURATION_MS, Math.round(overflow * MARQUEE_MS_PER_PX));

                const state = {
                    active: true,
                    phase: 'pause-start',
                    phaseStart: GLib.get_monotonic_time() / 1000,
                    offset: 0,
                    tickId: null,
                };
                scrollBin._marqueeState = state;

                const step = () => {
                    if (this._isDestroyed) {
                        state.tickId = null;
                        return GLib.SOURCE_REMOVE;
                    }
                    if (!isActorAlive(scrollBin) || scrollBin._marqueeState !== state || !state.active) {
                        state.tickId = null;
                        return GLib.SOURCE_REMOVE;
                    }

                    const now = GLib.get_monotonic_time() / 1000;
                    const elapsed = now - state.phaseStart;

                    if (state.phase === 'pause-start') {
                        if (elapsed >= MARQUEE_PAUSE_MS) {
                            state.phase = 'forward';
                            state.phaseStart = now;
                        }
                    } else if (state.phase === 'forward') {
                        const t = Math.min(1, elapsed / scrollDuration);
                        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                        state.offset = -overflow * e;
                        scrollBin.translation_x = state.offset;

                        if (t >= 1) {
                            state.phase = 'pause-end';
                            state.phaseStart = now;
                        }
                    } else if (state.phase === 'pause-end') {
                        if (elapsed >= MARQUEE_PAUSE_MS) {
                            state.phase = 'backward';
                            state.phaseStart = now;
                        }
                    } else if (state.phase === 'backward') {
                        const t = Math.min(1, elapsed / scrollDuration);
                        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                        state.offset = -overflow * (1 - e);
                        scrollBin.translation_x = state.offset;

                        if (t >= 1) {
                            state.phase = 'pause-start';
                            state.phaseStart = now;
                        }
                    }

                    return GLib.SOURCE_CONTINUE;
                };

                state.tickId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 16, step);
                return GLib.SOURCE_REMOVE;
            });
            scrollBin._marqueeIdleId = idleId;
        }

        _cancelMarquee(scrollBin) {
            if (!scrollBin) return;

            if (scrollBin._marqueeIdleId) {
                this._tracker.remove(scrollBin._marqueeIdleId);
                scrollBin._marqueeIdleId = null;
            }

            const state = scrollBin._marqueeState;
            if (state) {
                if (state.tickId) {
                    this._tracker.remove(state.tickId);
                    state.tickId = null;
                }
                state.active = false;
            }
            scrollBin._marqueeState = null;

            if (isActorAlive(scrollBin)) {
                scrollBin.remove_all_transitions();
                scrollBin.translation_x = 0;
            }
        }

        _restartAllMarquees() {
            if (this._isDestroyed) return;

            if (!this._isLyricsVisible) {
                this._scheduleMarquee(this._titleScroll, this._titleViewport, this._titleLabel);
                this._scheduleMarquee(this._artistScroll, this._artistViewport, this._artistLabel);
            } else {
                this._cancelMarquee(this._titleScroll);
                this._cancelMarquee(this._artistScroll);
            }

            if (this._isLyricsVisible) {
                this._scheduleMarquee(this._miniScroll, this._miniViewport, this._lyricsHeaderTitle);
            } else {
                this._cancelMarquee(this._miniScroll);
            }
        }

        _forceResync() {
            if (this._isDestroyed || !isActorAlive(this)) return;

            const isAllowed = Settings.showMusicPill;

            if (!isAllowed) {
                this._hasValidTrack = false;
                this._cancelModeTransition();
                this._switchMode(false, 0);
                if (this.visible) this.hide();
                return;
            }

            this._activeTrackId = '';
            this._lyrics = [];
            this._currentLyricIndex = -1;
            this._lyricsReadyForTrack = false;
            this._lastPositionTimeMs = GLib.get_monotonic_time() / 1000;
            this._cancelModeTransition();
            this._switchMode(false, 0);

            if (this._karaokeWidget) {
                this._karaokeWidget.resetState();
            }

            if (this._slider) {
                this._slider.reset();
            }

            this._startLyricsSyncLoop();

            if (this._service) {
                this._service.refreshNow();
            }

            if (this._metaViewport) {
                this._metaViewport.queue_relayout();
            }
        }

        _handlePlaybackEvent(isPlaying, title, artist, artUrl, duration, hasPlayer) {
            if (this._isDestroyed || !isActorAlive(this)) return;

            const isAllowed = Settings.showMusicPill;

            if (!hasPlayer || !isAllowed || !title) {
                this._hasValidTrack = false;
                this._stopLyricsSyncLoop();
                if (this.visible) {
                    this.hide();
                    if (this._dockUI && this._dockUI.queueRender) this._dockUI.queueRender();
                }
                return;
            }

            this._hasValidTrack = true;

            const safeTitle = title ? title.trim() : '';
            const safeArtist = artist ? artist.trim() : _('Unknown Artist');
            const trackId = safeTitle + '::' + safeArtist;

            const trackChanged = this._activeTrackId !== trackId;
            const playStateChanged = this._isPlaying !== isPlaying;
            this._isPlaying = isPlaying;

            if (isPlaying) {
                this._startLyricsSyncLoop();
            } else {
                this._stopLyricsSyncLoop();
            }

            if (trackChanged) {
                this._activeTrackId = trackId;
                this._lyrics = [];
                this._currentLyricIndex = -1;
                this._lyricsReadyForTrack = false;

                if (this._karaokeWidget) {
                    this._karaokeWidget.resetState();
                }

                if (this._slider) {
                    this._slider.reset();
                }

                this._cancelModeTransition();
                this._switchMode(false, 0);

                this._fetchLyrics(safeTitle, safeArtist, duration);
            }

            if (isActorAlive(this._titleLabel) && this._titleLabel.text !== safeTitle) {
                this._titleLabel.text = safeTitle;
            }
            if (isActorAlive(this._lyricsHeaderTitle) && this._lyricsHeaderTitle.text !== safeTitle) {
                this._lyricsHeaderTitle.text = safeTitle;
            }
            if (isActorAlive(this._artistLabel) && this._artistLabel.text !== safeArtist) {
                this._artistLabel.text = safeArtist;
            }
            if (isActorAlive(this._playIcon)) {
                this._playIcon.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            }

            this._loadArtwork(artUrl).catch(e => {
                console.warn('[Dhruva] Error loading artwork:', e.message);
            });

            if (!this.visible) {
                this.show();
                if (this._dockUI && this._dockUI.queueRender) this._dockUI.queueRender();
            }

            this._setSideButtonsVisible(this._isHovered);

            if (playStateChanged || trackChanged) {
                if (!isPlaying) {
                    this._cancelModeTransition();
                    this._switchMode(false);
                } else if (!trackChanged) {
                    this._scheduleLyricsReveal();
                }
            }

            if (!trackChanged && this._lyricsReadyForTrack && isPlaying && !this._isLyricsVisible) {
                this._scheduleLyricsReveal();
            }
        }

        _scheduleLyricsReveal() {
            if (this._isDestroyed) return;
            this._cancelModeTransition();

            this._modeTransitionTimeoutId = this._tracker.addTimeout(
                GLib.PRIORITY_DEFAULT,
                LYRICS_REVEAL_DELAY_MS,
                () => {
                    this._modeTransitionTimeoutId = null;

                    if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                    if (!isActorAlive(this)) return GLib.SOURCE_REMOVE;
                    if (!this._isPlaying) return GLib.SOURCE_REMOVE;
                    if (!this._lyricsReadyForTrack) return GLib.SOURCE_REMOVE;
                    if (this._lyrics.length === 0) return GLib.SOURCE_REMOVE;

                    this._switchMode(true);
                    return GLib.SOURCE_REMOVE;
                }
            );
        }

        _cancelModeTransition() {
            if (this._modeTransitionTimeoutId) {
                this._tracker.remove(this._modeTransitionTimeoutId);
                this._modeTransitionTimeoutId = null;
            }
        }

        async _fetchLyrics(title, artist, duration) {
            if (this._isDestroyed) return;
            if (!this._lyricsClient) return;

            const requestedTrackId = title + '::' + artist;
            const lyrics = await this._lyricsClient.getLyrics(title, artist, duration);

            if (this._isDestroyed || !isActorAlive(this)) return;

            this._tracker.addIdle(GLib.PRIORITY_DEFAULT, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                if (!isActorAlive(this)) return GLib.SOURCE_REMOVE;
                if (this._activeTrackId !== requestedTrackId) return GLib.SOURCE_REMOVE;

                if (lyrics && lyrics.length > 0) {
                    this._lyrics = lyrics;
                    this._lyricsReadyForTrack = true;
                    this._currentLyricIndex = -1;

                    if (this._isPlaying && !this._isLyricsVisible) {
                        this._scheduleLyricsReveal();
                    }
                } else {
                    this._lyrics = [];
                    this._lyricsReadyForTrack = false;
                    this._currentLyricIndex = -1;
                    if (this._karaokeWidget) {
                        this._karaokeWidget.resetState();
                    }
                    this._cancelModeTransition();
                    this._switchMode(false, 200);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _switchMode(showLyrics, durationOverride = null) {
            if (this._isDestroyed || !isActorAlive(this)) return;

            const outActor = showLyrics ? this._infoBox : this._lyricsBox;
            const inActor = showLyrics ? this._lyricsBox : this._infoBox;

            if (!isActorAlive(outActor) || !isActorAlive(inActor)) return;

            this._isLyricsVisible = showLyrics;
            const duration = durationOverride !== null ? durationOverride : 300;

            outActor.remove_all_transitions();
            inActor.remove_all_transitions();

            inActor.show();

            if (duration === 0) {
                outActor.opacity = 0;
                outActor.hide();
                inActor.opacity = 255;
                if (!this._isDestroyed) this._restartAllMarquees();
            } else {
                outActor.ease({
                    opacity: 0,
                    duration: duration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        if (!isActorAlive(outActor)) return;
                        outActor.hide();
                        if (isActorAlive(this) && !this._isDestroyed) this._restartAllMarquees();
                    },
                });

                inActor.ease({
                    opacity: 255,
                    duration: duration,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                });
            }

            if (this._metaViewport && this._metaViewport.queue_relayout) {
                this._metaViewport.queue_relayout();
            }
        }

        _setSideButtonsVisible(visible) {
            if (this._isDestroyed || !isActorAlive(this)) return;

            const targetOpacity = visible ? 255 : 0;
            const targetWidth = visible ? 24 : 0;
            const targetScale = visible ? 1.0 : 0.3;

            const btns = [this._prevBtn, this._nextBtn];
            for (let i = 0; i < btns.length; i++) {
                const btn = btns[i];
                if (!isActorAlive(btn)) continue;

                btn.remove_all_transitions();
                btn.reactive = visible;

                btn.ease({
                    opacity: targetOpacity,
                    width: targetWidth,
                    scale_x: targetScale,
                    scale_y: targetScale,
                    duration: 160,
                    mode: visible ? Clutter.AnimationMode.EASE_OUT_QUAD : Clutter.AnimationMode.EASE_IN_QUAD,
                });
            }
        }

        async _loadArtwork(artUrl) {
            if (this._isDestroyed || !isActorAlive(this)) return;

            try {
                if (!artUrl) {
                    this._resetArt();
                    return;
                }

                if (artUrl === this._lastArtUrl) return;
                this._lastArtUrl = artUrl;

                let localPath = null;

                if (artUrl.startsWith('file://')) {
                    localPath = Gio.File.new_for_uri(artUrl).get_path();
                } else if (artUrl.startsWith('http://') || artUrl.startsWith('https://')) {
                    localPath = await this._downloadImage(artUrl);
                } else if (GLib.file_test(artUrl, GLib.FileTest.EXISTS)) {
                    localPath = artUrl;
                }

                if (this._isDestroyed || !isActorAlive(this)) return;

                if (localPath && GLib.file_test(localPath, GLib.FileTest.EXISTS)) {
                    this._applyArtStyle(localPath);
                } else {
                    this._resetArt();
                }
            } catch (err) {
                this._resetArt();
            }
        }

        async _downloadImage(url) {
            const urlParts = url.split('/');
            let uniqueID = urlParts[urlParts.length - 1].split('?')[0].replace(/[^a-z0-9]/gi, '_');
            if (!uniqueID || uniqueID.length < 2) uniqueID = 'img_' + Math.floor(Math.random() * 10000);

            const filePath = GLib.build_filenamev([this._cacheDir, uniqueID + '.jpg']);
            const file = Gio.File.new_for_path(filePath);

            if (file.query_exists(null)) return filePath;

            const msg = Soup.Message.new('GET', url);
            msg.request_headers.append('User-Agent', 'Mozilla/5.0');
            const bytes = await this._httpSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);

            if (msg.status_code === 200) {
                file.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                return filePath;
            }
            return null;
        }

        _applyArtStyle(filePath) {
            if (this._isDestroyed || !isActorAlive(this) || !isActorAlive(this._artBin)) return;

            const fileUri = Gio.File.new_for_path(filePath).get_uri();
            this._artBin.style = 'background-image: url("' + fileUri + '"); background-size: cover; background-position: center; border-radius: 999px;';
            if (isActorAlive(this._artFallbackIcon)) this._artFallbackIcon.visible = false;

            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filePath);
            if (!pixbuf) return;

            const colors = extractColorsFromPixbuf(pixbuf);
            if (!colors) return;

            const rgb = colors.accent.match(/\d+/g);
            const borderRgba = rgb && rgb.length >= 3
                ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.18)`
                : 'rgba(255, 255, 255, 0.15)';

            let iconColor = '#ffffff';
            if (rgb && rgb.length >= 3) {
                const r = parseInt(rgb[0], 10);
                const g = parseInt(rgb[1], 10);
                const b = parseInt(rgb[2], 10);
                const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
                if (lum > 0.60) {
                    iconColor = '#121212';
                }
            }

            if (isActorAlive(this._pillBg)) {
                this._pillBg.style = `background-color: ${colors.background}; border-color: ${borderRgba};`;
            }
            if (isActorAlive(this._playBtn)) {
                this._playBtn.style = `background-color: ${colors.accent}; color: ${iconColor};`;
            }
            if (isActorAlive(this._playIcon)) {
                this._playIcon.style = `color: ${iconColor};`;
            }
            if (isActorAlive(this._prevBtn)) {
                this._prevBtn.style = `color: ${iconColor};`;
            }
            if (isActorAlive(this._nextBtn)) {
                this._nextBtn.style = `color: ${iconColor};`;
            }

            if (this._slider && rgb && rgb.length >= 3) {
                this._slider.setColor(parseInt(rgb[0], 10) / 255.0, parseInt(rgb[1], 10) / 255.0, parseInt(rgb[2], 10) / 255.0);
            }
        }

        _resetArt() {
            if (this._isDestroyed || !isActorAlive(this)) return;
            if (isActorAlive(this._artBin)) this._artBin.style = '';
            if (isActorAlive(this._artFallbackIcon)) this._artFallbackIcon.visible = true;

            if (isActorAlive(this._pillBg)) this._pillBg.style = '';
            if (isActorAlive(this._playBtn)) this._playBtn.style = '';

            if (isActorAlive(this._playIcon)) this._playIcon.style = '';
            if (isActorAlive(this._prevBtn)) this._prevBtn.style = '';
            if (isActorAlive(this._nextBtn)) this._nextBtn.style = '';

            if (this._slider) {
                this._slider.setColor(1.0, 1.0, 1.0);
                this._slider.reset();
            }
        }

        destroy() {
            this._isDestroyed = true;

            this._stopLyricsSyncLoop();

            if (this._service) {
                this._service.disconnectObject(this);
            }

            this._cancelModeTransition();

            if (this._titleScroll) this._cancelMarquee(this._titleScroll);
            if (this._artistScroll) this._cancelMarquee(this._artistScroll);
            if (this._miniScroll) this._cancelMarquee(this._miniScroll);

            if (this._karaokeWidget) {
                this._karaokeWidget._cleanup();
                this._karaokeWidget = null;
            }

            if (this._slider) {
                this._slider.destroy();
                this._slider = null;
            }

            if (this._tracker) {
                this._tracker.destroy();
                this._tracker = null;
            }

            if (this._httpSession) {
                this._httpSession.abort();
                this._httpSession = null;
            }

            if (this._lyricsClient) {
                this._lyricsClient.destroy();
                this._lyricsClient = null;
            }

            if (this._service) {
                this._service.destroy();
                this._service = null;
            }

            super.destroy();
        }
    }
);