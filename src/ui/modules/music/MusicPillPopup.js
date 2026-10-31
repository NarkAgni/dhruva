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
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { BlurEffect } from '../../blur/BlurEffect.js';
import { PopupLyricsWidget } from './PopupLyricsWidget.js';
import { FrameTicker } from '../../../core/FrameTicker.js';
import { TimeoutTracker } from '../../../core/TimeoutTracker.js';
import { extractColorsFromPixbuf } from './MusicColorExtractor.js';
import { isActorAlive, setBoxVertical } from '../../../core/Utils.js';


let POPUP_ART_BLUR_INTENSITY = 4.0;

const WAVE_AMPLITUDE = 3.5;
const WAVE_FREQUENCY = 0.08;
const WAVE_PHASE_PER_MS = 0.04 / 33;
const STATE_SYNC_MS = 100;
const SLIDER_HEIGHT = 26;
const POPUP_GAP_PX = 20;
const INACTIVE_ICON_OPACITY = 150;
const TOOL_BUTTON_STYLE = 'padding: 6px; border-radius: 999px; border: none; transition-duration: 150ms;';
const PLAYER_BUTTON_STYLE = 'padding: 5px; border-radius: 999px; border: none; transition-duration: 150ms;';
const PLAYER_ICON_SIZE = 18;
const CONTROL_BG = 'rgba(255, 255, 255, 0.16)';
const CONTROL_HOVER_BG = 'rgba(255, 255, 255, 0.26)';
const CONTROL_ACTIVE_BG = 'rgba(255, 255, 255, 0.32)';
const PILL_BAR_STYLE = `background-color: ${CONTROL_BG}; border: none; border-radius: 999px; padding: 4px 18px; spacing: 20px;`;
const SCRIM_TOP = 'rgba(0, 0, 0, 0.5)';
const LYRICS_OFFSET_STEP_MS = 500;
const META_FADE_MS = 180;

function formatOffset(ms) {
    if (ms === 0) return '0.0s';
    return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

function setLabelText(label, text) {
    if (label.text !== text) label.text = text;
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    let total = Math.floor(seconds);
    let m = Math.floor(total / 60);
    let s = total % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
}

export class MusicPillPopup {
    constructor(musicPill, dockUI) {
        this._pill = musicPill;
        this._dockUI = dockUI;
        this._service = musicPill._service;
        this._tracker = new TimeoutTracker();

        this._isOpen = false;
        this._isDragging = false;
        this._sliderGrab = null;
        this._box = null;
        this._overlay = null;

        this._positionSec = 0;
        this._durationSec = 1;
        this._phase = 0;
        this._lastFrameTime = 0;

        this._cachedArtPath = null;
        this._accentColor = { r: 1.0, g: 1.0, b: 1.0 };
        this._accentRgba60 = 'rgba(255, 255, 255, 0.40)';
        this._accentColorStr = '#ffffff';
        this._bgGradientEnd = 'rgba(14, 14, 18, 0.95)';

        this._lyricsVersion = -1;

        this._buildUI();
        this._waveTicker = new FrameTicker(this._sliderCanvas, () => this._onWaveFrame());
        this._rebuildPlayers();
        this._service.connectObject('players-changed', () => this._rebuildPlayers(), this);
    }

    _buildUI() {
        this._overlay = new St.Widget({
            reactive: true,
            x_expand: true,
            y_expand: true,
        });

        this._overlay.connectObject('button-press-event', (_actor, event) => {
            const [clickX, clickY] = event.get_coords();
            const [boxX, boxY] = this._box.get_transformed_position();
            const [boxW, boxH] = this._box.get_transformed_size();

            const isInside = clickX >= boxX && clickX <= (boxX + boxW) &&
                clickY >= boxY && clickY <= (boxY + boxH);

            if (!isInside) {
                this.hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);

        this._box = new St.Widget({
            name: 'DhruvaMusicPopup',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            clip_to_allocation: true,
            style: `
                width: 300px;
                height: 395px;
                border-radius: 28px;
                background-color: #121214;
            `,
        });

        this._borderStroke = new St.Widget({
            x_expand: true,
            y_expand: true,
            reactive: false,
            style: `
                border-radius: 28px;
                border: 2px solid ${this._accentRgba60} !important;
                background-color: transparent;
            `,
        });

        this._artBackground = new St.Widget({
            x_expand: true,
            y_expand: true,
            reactive: false,
            style: `
                background-size: cover;
                background-position: center;
                border-radius: 26px;
            `,
        });

        this._artBlurEffect = new BlurEffect();
        this._artBlurEffect.setParams({
            radius: 26.0,
            blurIntensity: POPUP_ART_BLUR_INTENSITY,
            vibrancy: 1.25,
            blurBrightness: 0.05,
            borderGlow: 0.0,
            colorTintOpacity: 0.0,
        });
        this._artBackground.add_effect(this._artBlurEffect);
        this._artBackground.connectObject('notify::allocation', () => {
            const [w, h] = this._artBackground.get_size();
            if (w > 1 && h > 1 && this._artBlurEffect) {
                this._artBlurEffect.updateDimensions(w, h, w, h);
            }
        }, this);

        this._box.add_child(this._artBackground);

        this._scrim = new St.Widget({
            x_expand: true,
            y_expand: true,
            reactive: false,
            style: `
                background-gradient-direction: vertical;
                background-gradient-start: ${SCRIM_TOP};
                background-gradient-end: ${this._bgGradientEnd};
                border-radius: 26px;
            `,
        });
        this._box.add_child(this._scrim);

        this._contentBox = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            style: 'padding: 18px;',
        });
        setBoxVertical(this._contentBox, true);

        const topRow = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        setBoxVertical(topRow, false);

        this._playersBox = new St.BoxLayout({
            style: 'spacing: 4px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        setBoxVertical(this._playersBox, false);

        topRow.add_child(this._playersBox);
        topRow.add_child(new St.Widget({ x_expand: true, reactive: false }));

        this._lyricsBtn = this._makeToolButton('format-justify-left-symbolic', _('Lyrics'), () => this._toggleLyricsView());
        topRow.add_child(this._lyricsBtn);

        this._shuffleBtn = this._makeToolButton('media-playlist-shuffle-symbolic', _('Shuffle'), () => this._service.toggleShuffle());
        this._repeatBtn = this._makeToolButton('media-playlist-repeat-symbolic', _('Repeat'), () => this._service.cycleLoop());
        topRow.add_child(this._shuffleBtn);
        topRow.add_child(this._repeatBtn);
        this._contentBox.add_child(topRow);

        this._contentBox.add_child(this._buildLyricsArea());

        this._metaBox = new St.BoxLayout({
            style: 'spacing: 4px; margin-bottom: 10px;',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        setBoxVertical(this._metaBox, true);

        this._titleLabel = new St.Label({
            text: 'Track Title',
            style: `
                font-weight: 900;
                font-size: 19px;
                color: #ffffff;
                text-align: left;
            `,
        });
        if (this._titleLabel.clutter_text) {
            this._titleLabel.clutter_text.ellipsize = 3;
            this._titleLabel.clutter_text.line_wrap = false;
        }

        this._artistLabel = new St.Label({
            text: 'Artist',
            style: `
                font-weight: 600;
                font-size: 13px;
                color: rgba(255, 255, 255, 0.72);
                text-align: left;
            `,
        });
        if (this._artistLabel.clutter_text) {
            this._artistLabel.clutter_text.ellipsize = 3;
            this._artistLabel.clutter_text.line_wrap = false;
        }

        this._albumLabel = new St.Label({
            style: `
                font-weight: 500;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.5);
                text-align: left;
            `,
        });
        this._albumLabel.clutter_text.ellipsize = 3;
        this._albumLabel.clutter_text.line_wrap = false;

        this._metaBox.add_child(this._titleLabel);
        this._metaBox.add_child(this._artistLabel);
        this._metaBox.add_child(this._albumLabel);
        this._contentBox.add_child(this._metaBox);

        this._sliderCanvas = new St.DrawingArea({
            height: SLIDER_HEIGHT,
            x_expand: true,
            reactive: true,
            style: 'margin-bottom: 2px;',
        });

        this._sliderCanvas.connectObject('repaint', () => this._drawWavySlider(), this);

        this._sliderCanvas.connectObject('button-press-event', (_actor, event) => {
            this._isDragging = true;
            this._sliderGrab = global.stage.grab(this._sliderCanvas);
            const pct = this._getPercentFromCoord(event);
            this._positionSec = pct * this._durationSec;
            this._timeElapsedLabel.text = formatTime(this._positionSec);
            this._sliderCanvas.queue_repaint();
            return Clutter.EVENT_STOP;
        }, this);

        this._sliderCanvas.connectObject('motion-event', (_actor, event) => {
            if (!this._isDragging) return Clutter.EVENT_PROPAGATE;
            const pct = this._getPercentFromCoord(event);
            this._positionSec = pct * this._durationSec;
            this._timeElapsedLabel.text = formatTime(this._positionSec);
            this._sliderCanvas.queue_repaint();
            return Clutter.EVENT_STOP;
        }, this);

        this._sliderCanvas.connectObject('button-release-event', (_actor, event) => {
            if (!this._isDragging) return Clutter.EVENT_PROPAGATE;
            this._endSliderDrag();
            const pct = this._getPercentFromCoord(event);
            this._positionSec = pct * this._durationSec;
            this._timeElapsedLabel.text = formatTime(this._positionSec);
            this._sliderCanvas.queue_repaint();

            if (this._service) {
                const targetMs = Math.round(this._positionSec * 1000);
                this._service.seekPosition(targetMs);
            }
            return Clutter.EVENT_STOP;
        }, this);

        this._contentBox.add_child(this._sliderCanvas);

        const timeRow = new St.BoxLayout({
            x_expand: true,
            style: 'margin-bottom: 12px;',
        });
        setBoxVertical(timeRow, false);

        this._timeElapsedLabel = new St.Label({
            text: '0:00',
            style: 'font-size: 13px; font-weight: 800; color: rgba(255, 255, 255, 0.95);',
            x_align: Clutter.ActorAlign.START,
        });

        const timeSpacer = new St.Widget({
            x_expand: true,
            reactive: false,
        });

        this._timeTotalLabel = new St.Label({
            text: '0:00',
            style: 'font-size: 13px; font-weight: 800; color: rgba(255, 255, 255, 0.65);',
            x_align: Clutter.ActorAlign.END,
        });

        timeRow.add_child(this._timeElapsedLabel);
        timeRow.add_child(timeSpacer);
        timeRow.add_child(this._timeTotalLabel);
        this._contentBox.add_child(timeRow);

        this._pillBar = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: PILL_BAR_STYLE,
        });
        setBoxVertical(this._pillBar, false);

        this._prevBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'media-skip-backward-symbolic',
                icon_size: 20,
                style: 'color: #ffffff;',
            }),
            style: 'padding: 8px; border-radius: 999px; background-color: transparent; border: none; color: #ffffff; transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });

        this._prevBtn.connectObject('notify::hover', () => {
            if (!isActorAlive(this._prevBtn)) return;
            this._prevBtn.style = this._prevBtn.hover
                ? 'padding: 8px; border-radius: 999px; background-color: rgba(255, 255, 255, 0.22); border: none; color: #ffffff; transition-duration: 150ms;'
                : 'padding: 8px; border-radius: 999px; background-color: transparent; border: none; color: #ffffff; transition-duration: 150ms;';
        }, this);

        this._prevBtn.connectObject('clicked', () => {
            if (this._service) this._service.sendControl('Previous');
        }, this);

        this._playIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            icon_size: 26,
            style: 'color: #ffffff;',
        });
        this._playBtn = new St.Button({
            child: this._playIcon,
            style: `
                padding: 8px 24px;
                border-radius: 999px;
                background-color: rgba(255, 255, 255, 0.35);
                border: none;
                transition-duration: 150ms;
            `,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._playBtn.connectObject('notify::hover', () => {
            if (!isActorAlive(this._playBtn)) return;
            const baseCol = this._accentColorStr || 'rgba(255, 255, 255, 0.35)';
            this._playBtn.style = this._playBtn.hover
                ? `padding: 8px 24px; border-radius: 999px; background-color: ${baseCol}; filter: brightness(1.15); border: none; transition-duration: 150ms;`
                : `padding: 8px 24px; border-radius: 999px; background-color: ${baseCol}; border: none; transition-duration: 150ms;`;
        }, this);
        this._playBtn.connectObject('clicked', () => {
            if (this._service) this._service.sendControl('PlayPause');
        }, this);

        this._nextBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'media-skip-forward-symbolic',
                icon_size: 20,
                style: 'color: #ffffff;',
            }),
            style: 'padding: 8px; border-radius: 999px; background-color: transparent; border: none; color: #ffffff; transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });

        this._nextBtn.connectObject('notify::hover', () => {
            if (!isActorAlive(this._nextBtn)) return;
            this._nextBtn.style = this._nextBtn.hover
                ? 'padding: 8px; border-radius: 999px; background-color: rgba(255, 255, 255, 0.22); border: none; color: #ffffff; transition-duration: 150ms;'
                : 'padding: 8px; border-radius: 999px; background-color: transparent; border: none; color: #ffffff; transition-duration: 150ms;';
        }, this);

        this._nextBtn.connectObject('clicked', () => {
            if (this._service) this._service.sendControl('Next');
        }, this);

        this._pillBar.add_child(this._prevBtn);
        this._pillBar.add_child(this._playBtn);
        this._pillBar.add_child(this._nextBtn);

        this._contentBox.add_child(this._pillBar);
        this._box.add_child(this._contentBox);
        this._box.add_child(this._borderStroke);
        this._overlay.add_child(this._box);
    }

    _buildLyricsArea() {
        const area = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            reactive: false,
        });

        this._lyricsArea = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            visible: false,
            style: 'spacing: 6px; margin: 8px 0 10px 0; padding: 8px 0; border-radius: 16px; background-color: rgba(0, 0, 0, 0.22);',
        });
        setBoxVertical(this._lyricsArea, true);

        this._offsetRow = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;',
        });
        setBoxVertical(this._offsetRow, false);

        this._offsetEarlierBtn = this._makeToolButton('list-remove-symbolic', _('Show lyrics earlier'),
            () => this._pill.adjustLyricsOffset(-LYRICS_OFFSET_STEP_MS));
        this._offsetLaterBtn = this._makeToolButton('list-add-symbolic', _('Show lyrics later'),
            () => this._pill.adjustLyricsOffset(LYRICS_OFFSET_STEP_MS));
        this._offsetEarlierBtn.visible = true;
        this._offsetLaterBtn.visible = true;
        this._offsetLabel = new St.Label({
            text: formatOffset(0),
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 12px; font-weight: 700; color: rgba(255, 255, 255, 0.75); min-width: 44px; text-align: center;',
        });

        this._offsetRow.add_child(this._offsetEarlierBtn);
        this._offsetRow.add_child(this._offsetLabel);
        this._offsetRow.add_child(this._offsetLaterBtn);
        this._lyricsArea.add_child(this._offsetRow);

        this._lyricsWidget = new PopupLyricsWidget();
        this._lyricsWidget.connectObject('line-activated', (_widget, index) => this._pill.seekToLyric(index), this);
        this._lyricsArea.add_child(this._lyricsWidget);

        area.add_child(this._lyricsArea);
        return area;
    }

    _setLyricsViewVisible(isVisible) {
        if (this._lyricsArea.visible === isVisible) return;

        this._lyricsArea.visible = isVisible;

        this._metaBox.remove_all_transitions();
        if (isVisible) {
            this._metaBox.hide();
            return;
        }
        this._metaBox.opacity = 0;
        this._metaBox.show();
        this._metaBox.ease({ opacity: 255, duration: META_FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    _toggleLyricsView() {
        this._setLyricsViewVisible(!this._lyricsArea.visible);
        this._syncLyricsView();
    }

    _syncLyricsView() {
        const hasLyrics = this._pill.lyricsLines.length > 0;
        this._lyricsBtn.visible = hasLyrics;
        if (!hasLyrics) this._setLyricsViewVisible(false);
        this._lyricsBtn._icon.opacity = this._lyricsArea.visible ? 255 : INACTIVE_ICON_OPACITY;
        if (!this._lyricsArea.visible) return;

        const isSynced = this._pill.lyricsSynced;
        if (this._lyricsVersion !== this._pill.lyricsVersion) {
            this._lyricsVersion = this._pill.lyricsVersion;
            this._lyricsWidget.setLyrics(this._pill.lyricsLines, isSynced);
        }

        this._offsetRow.visible = isSynced;
        setLabelText(this._offsetLabel, formatOffset(this._pill.lyricsOffsetMs));
        this._lyricsWidget.setActiveIndex(this._pill.currentLyricIndex);
    }

    _rebuildPlayers() {
        if (!isActorAlive(this._playersBox)) return;
        this._playersBox.destroy_all_children();

        const active = this._service.activePlayer;
        for (const player of this._service.players) {
            const isActive = player.busName === active;
            const icon = new St.Icon({ icon_size: PLAYER_ICON_SIZE, style: 'color: #ffffff;', opacity: isActive ? 255 : INACTIVE_ICON_OPACITY });
            if (player.gicon) icon.gicon = player.gicon;
            else icon.icon_name = 'audio-x-generic-symbolic';

            const button = new St.Button({
                child: icon,
                accessible_name: player.name,
                style: `${PLAYER_BUTTON_STYLE} background-color: ${isActive ? CONTROL_ACTIVE_BG : CONTROL_BG};`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            button.connectObject('clicked', () => this._service.selectPlayer(player.busName), this);
            this._playersBox.add_child(button);
        }
    }

    _makeToolButton(iconName, label, onClick) {
        const icon = new St.Icon({ icon_name: iconName, icon_size: 16, style: 'color: #ffffff;' });
        const button = new St.Button({
            child: icon,
            accessible_name: label,
            style: `${TOOL_BUTTON_STYLE} background-color: ${CONTROL_BG};`,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        button._icon = icon;
        button.connectObject(
            'clicked', onClick,
            'notify::hover', () => {
                button.style = `${TOOL_BUTTON_STYLE} background-color: ${button.hover ? CONTROL_HOVER_BG : CONTROL_BG};`;
            },
            this
        );
        return button;
    }

    _syncToolButtons() {
        const service = this._service;

        this._shuffleBtn.visible = service.canShuffle;
        this._shuffleBtn._icon.opacity = service.isShuffle ? 255 : INACTIVE_ICON_OPACITY;

        const loop = service.loopStatus;
        this._repeatBtn.visible = service.canLoop;
        this._repeatBtn._icon.icon_name = loop === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
        this._repeatBtn._icon.opacity = loop === 'None' ? INACTIVE_ICON_OPACITY : 255;
    }

    _endSliderDrag() {
        this._isDragging = false;
        if (this._sliderGrab) {
            this._sliderGrab.dismiss();
            this._sliderGrab = null;
        }
    }

    _getPercentFromCoord(event) {
        const [x] = event.get_coords();
        const [absX] = this._sliderCanvas.get_transformed_position();
        const rel = x - absX;
        const w = this._sliderCanvas.get_width();
        if (w <= 0) return 0;
        return Math.min(1.0, Math.max(0.0, rel / w));
    }

    _drawWavySlider() {
        if (!isActorAlive(this._sliderCanvas)) return;
        const cr = this._sliderCanvas.get_context();
        if (!cr) return;

        const [w, h] = this._sliderCanvas.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        const centerY = h / 2;
        const ratio = Math.min(1.0, Math.max(0.0, this._positionSec / Math.max(1, this._durationSec)));
        const currentX = w * ratio;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.22);
        cr.setLineWidth(4.0);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.moveTo(currentX, centerY);
        cr.lineTo(w, centerY);
        cr.stroke();

        const c = this._accentColor;
        cr.setSourceRGBA(c.r, c.g, c.b, 0.95);
        cr.setLineWidth(4.0);
        cr.setLineCap(Cairo.LineCap.ROUND);

        cr.moveTo(0, centerY);

        const isPlaying = this._pill && this._pill._isPlaying;

        for (let i = 0; i <= currentX; i++) {
            let py = centerY;
            if (isPlaying && !this._isDragging) {
                const damping = Math.min(1.0, i / 14.0);
                py += Math.sin(i * WAVE_FREQUENCY - this._phase) * WAVE_AMPLITUDE * damping;
            }
            cr.lineTo(i, py);
        }
        cr.stroke();

        const thumbW = 5.0;
        const thumbH = 14.0;
        const thumbRadius = 2.5;
        const thumbX = Math.max(0, Math.min(w - thumbW, currentX - thumbW / 2.0));
        const thumbY = centerY - thumbH / 2.0;

        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        cr.newSubPath();
        cr.arc(thumbX + thumbW - thumbRadius, thumbY + thumbRadius, thumbRadius, -0.5 * Math.PI, 0);
        cr.arc(thumbX + thumbW - thumbRadius, thumbY + thumbH - thumbRadius, thumbRadius, 0, 0.5 * Math.PI);
        cr.arc(thumbX + thumbRadius, thumbY + thumbH - thumbRadius, thumbRadius, 0.5 * Math.PI, Math.PI);
        cr.arc(thumbX + thumbRadius, thumbY + thumbRadius, thumbRadius, Math.PI, 1.5 * Math.PI);
        cr.closePath();
        cr.fill();

        cr.$dispose();
    }

    _applyColors(artPath) {
        let colors = this._pill ? this._pill._lastExtractedColors : null;

        if (!colors && artPath && GLib.file_test(artPath, GLib.FileTest.EXISTS)) {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(artPath, 64, 64, true);
            if (pixbuf) {
                colors = extractColorsFromPixbuf(pixbuf);
            }
        }

        if (colors) {
            this._renderDynamicStyling(colors);
        }
    }

    _renderDynamicStyling(colors) {
        if (!isActorAlive(this._box) || !colors) return;

        const accent = colors.accent || '#ffffff';
        const bg = colors.background || 'rgba(14, 14, 18, 0.95)';

        this._accentColorStr = accent;

        let iconColor = '#ffffff';

        const m = accent.match(/\d+/g);
        if (m && m.length >= 3) {
            const red = parseInt(m[0], 10);
            const green = parseInt(m[1], 10);
            const blue = parseInt(m[2], 10);

            this._accentColor = {
                r: red / 255.0,
                g: green / 255.0,
                b: blue / 255.0,
            };
            this._accentRgba60 = 'rgba(' + red + ', ' + green + ', ' + blue + ', 0.60)';

            const lum = (0.299 * red + 0.587 * green + 0.114 * blue) / 255.0;
            if (lum > 0.55) {
                iconColor = '#121212';
            }
        } else {
            this._accentColor = { r: 1.0, g: 1.0, b: 1.0 };
            this._accentRgba60 = 'rgba(255, 255, 255, 0.60)';
        }

        this._bgGradientEnd = bg;

        this._box.style = 'width: 300px; height: 395px; border-radius: 28px; background-color: #121214;';

        if (isActorAlive(this._borderStroke)) {
            this._borderStroke.style = 'border-radius: 28px; border: 2px solid ' + this._accentRgba60 + ' !important; background-color: transparent;';
        }

        this._scrim.style = 'background-gradient-direction: vertical; background-gradient-start: ' + SCRIM_TOP + '; background-gradient-end: ' + bg + '; border-radius: 26px;';

        this._playBtn.style = 'padding: 8px 24px; border-radius: 999px; background-color: ' + accent + '; border: none; transition-duration: 150ms;';

        if (isActorAlive(this._playIcon)) {
            this._playIcon.style = 'color: ' + iconColor + ' !important;';
        }

        if (isActorAlive(this._sliderCanvas)) {
            this._sliderCanvas.queue_repaint();
        }
    }

    _updateState() {
        if (!this._isOpen || !isActorAlive(this._box)) return;

        const isPlaying = this._pill._isPlaying;

        setLabelText(this._titleLabel, this._pill._titleLabel.text);
        setLabelText(this._artistLabel, this._pill._artistLabel.text);
        setLabelText(this._albumLabel, this._service.album || '');
        this._albumLabel.visible = Boolean(this._service.album);
        this._syncToolButtons();
        this._syncLyricsView();
        this._playIcon.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        this._durationSec = this._pill._durationSec > 0 ? this._pill._durationSec : 1;

        const localArtPath = this._pill._artPath;
        if (localArtPath && localArtPath !== this._cachedArtPath) {
            let fileUri = localArtPath;
            let cleanPath = localArtPath;
            if (localArtPath.startsWith('file://')) {
                cleanPath = Gio.File.new_for_uri(localArtPath).get_path();
                fileUri = localArtPath;
            } else if (localArtPath.startsWith('/')) {
                fileUri = Gio.File.new_for_path(localArtPath).get_uri();
                cleanPath = localArtPath;
            }

            if (fileUri && cleanPath && GLib.file_test(cleanPath, GLib.FileTest.EXISTS)) {
                this._cachedArtPath = localArtPath;
                this._artBackground.style = 'background-image: url("' + fileUri + '"); background-size: cover; background-position: center; border-radius: 26px;';
                this._applyColors(cleanPath);
            }
        } else if (!localArtPath && this._cachedArtPath) {
            this._cachedArtPath = null;
            this._artBackground.style = 'background-image: none; border-radius: 26px;';
            if (isActorAlive(this._playIcon)) {
                this._playIcon.style = 'color: #ffffff !important;';
            }
        } else if (this._pill && this._pill._lastExtractedColors && (!this._accentColorStr || this._accentColorStr === '#1db954')) {
            this._applyColors(localArtPath);
        }

        if (!this._isDragging) {
            this._syncPosition(GLib.get_monotonic_time() / 1000, isPlaying);
            setLabelText(this._timeElapsedLabel, formatTime(this._positionSec));
            setLabelText(this._timeTotalLabel, this._pill.hasDuration ? formatTime(this._durationSec) : '--:--');

            if (isActorAlive(this._sliderCanvas)) {
                if (isPlaying) this._waveTicker.start();
                else this._sliderCanvas.queue_repaint();
            }
        }
    }

    _syncPosition(nowMs, isPlaying) {
        const elapsed = isPlaying ? Math.max(0, nowMs - this._pill._lastPositionTimeMs) : 0;
        this._positionSec = (this._pill._lastBasePositionMs + elapsed) / 1000;
    }

    _onWaveFrame() {
        if (!this._isOpen || this._isDragging || !isActorAlive(this._sliderCanvas)) {
            this._lastFrameTime = 0;
            return false;
        }

        const now = GLib.get_monotonic_time() / 1000;
        const isPlaying = this._pill._isPlaying;
        if (isPlaying && this._lastFrameTime) this._phase += (now - this._lastFrameTime) * WAVE_PHASE_PER_MS;
        this._lastFrameTime = isPlaying ? now : 0;

        this._syncPosition(now, isPlaying);
        this._sliderCanvas.queue_repaint();
        return isPlaying;
    }

    _positionPopup() {
        const [pillX, pillY] = this._pill.get_transformed_position();
        const [pillW, pillH] = this._pill.get_transformed_size();
        const [boxW, boxH] = this._box.get_preferred_size();

        let dockY = pillY;
        let dockH = pillH;
        let dockX = pillX;
        let dockW = pillW;

        if (this._dockUI && this._dockUI.actor && isActorAlive(this._dockUI.actor)) {
            const [dx, dy] = this._dockUI.actor.get_transformed_position();
            const [dw, dh] = this._dockUI.actor.get_transformed_size();
            dockX = dx;
            dockY = dy;
            dockW = dw;
            dockH = dh;
        }

        const monitor = Main.layoutManager.findMonitorForActor(this._pill);
        const monX = monitor ? monitor.x : 0;
        const monY = monitor ? monitor.y : 0;
        const monW = monitor ? monitor.width : global.screen_width;
        const monH = monitor ? monitor.height : global.screen_height;

        const dockPos = this._dockUI ? this._dockUI.dockPosition : 'BOTTOM';

        let targetX = pillX + (pillW - boxW) / 2;
        let targetY = dockY - boxH - POPUP_GAP_PX;

        if (dockPos === 'TOP') {
            targetY = dockY + dockH + POPUP_GAP_PX;
        } else if (dockPos === 'LEFT') {
            targetX = dockX + dockW + POPUP_GAP_PX;
            targetY = pillY + (pillH - boxH) / 2;
        } else if (dockPos === 'RIGHT') {
            targetX = dockX - boxW - POPUP_GAP_PX;
            targetY = pillY + (pillH - boxH) / 2;
        }

        targetX = Math.max(monX + 12, Math.min(monX + monW - boxW - 12, targetX));
        targetY = Math.max(monY + 12, Math.min(monY + monH - boxH - 12, targetY));

        this._box.set_position(Math.round(targetX), Math.round(targetY));

        if (this._artBlurEffect) {
            this._artBlurEffect.updateDimensions(boxW, boxH, boxW, boxH);
        }
    }

    show() {
        if (this._isOpen) return;
        this._isOpen = true;

        if (this._dockUI && this._dockUI._activeContextMenu) {
            this._dockUI._activeContextMenu.hide();
        }

        this._overlay.set_position(0, 0);
        this._overlay.set_size(global.stage.width, global.stage.height);
        if (!this._overlay.get_parent()) Main.layoutManager.uiGroup.add_child(this._overlay);

        this._positionPopup();

        if (this._pill && this._pill._lastExtractedColors) {
            this._applyColors(this._pill._artPath);
        }

        this._updateState();

        this._box.opacity = 0;
        this._box.scale_y = 0.88;
        this._box.scale_x = 0.88;
        this._box.set_pivot_point(0.5, 0.5);

        this._box.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        if (this._loopId) {
            this._tracker.remove(this._loopId);
            this._loopId = 0;
        }
        this._loopId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, STATE_SYNC_MS, () => {
            if (!this._isOpen) {
                this._loopId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._updateState();
            return GLib.SOURCE_CONTINUE;
        });

        global.stage.connectObject('captured-event', (_stage, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                const [cx, cy] = event.get_coords();
                const [bx, by] = this._box.get_transformed_position();
                const [bw, bh] = this._box.get_transformed_size();

                const inside = cx >= bx && cx <= (bx + bw) &&
                    cy >= by && cy <= (by + bh);

                if (!inside) {
                    this.hide();
                    return Clutter.EVENT_PROPAGATE;
                }
            } else if (event.type() === Clutter.EventType.KEY_PRESS) {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this.hide();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);

        global.display.connectObject('notify::focus-window', () => {
            if (this._isOpen) {
                this.hide();
            }
        }, this);
    }

    _disconnectOpenState() {
        this._endSliderDrag();

        if (this._waveTicker) this._waveTicker.stop();
        this._lastFrameTime = 0;

        if (this._loopId && this._tracker) {
            this._tracker.remove(this._loopId);
            this._loopId = 0;
        }

        global.stage.disconnectObject(this);
        global.display.disconnectObject(this);
    }

    hide() {
        this._disconnectOpenState();
        if (this._isOpen) {
            this._isOpen = false;

            this._box.ease({
                opacity: 0,
                scale_x: 0.9,
                scale_y: 0.9,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => {
                    if (!this._isOpen && isActorAlive(this._overlay)) {
                        if (this._overlay.get_parent()) Main.layoutManager.uiGroup.remove_child(this._overlay);
                    }
                },
            });
        }
    }

    toggle() {
        if (this._isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    destroy() {
        this._isOpen = false;
        this._disconnectOpenState();

        if (this._tracker) {
            this._tracker.destroy();
            this._tracker = null;
        }

        if (this._waveTicker) {
            this._waveTicker.destroy();
            this._waveTicker = null;
        }

        [this._overlay, this._artBackground, this._sliderCanvas, this._prevBtn, this._playBtn, this._nextBtn,
            this._shuffleBtn, this._repeatBtn, this._lyricsBtn, this._offsetEarlierBtn, this._offsetLaterBtn, this._lyricsWidget].forEach(actor => {
            if (actor) actor.disconnectObject(this);
        });
        if (this._service) this._service.disconnectObject(this);

        if (isActorAlive(this._box)) {
            this._box.remove_all_transitions();
        }

        this._artBlurEffect = null;
        if (isActorAlive(this._overlay)) {
            if (this._overlay.get_parent()) {
                Main.layoutManager.uiGroup.remove_child(this._overlay);
            }
            this._overlay.destroy();
        }
        this._overlay = null;
        this._box = null;
    }
}