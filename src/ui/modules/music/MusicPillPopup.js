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

import { BlurEffect } from '../../blur/BlurEffect.js';
import { TimeoutTracker } from '../../../core/TimeoutTracker.js';
import { extractColorsFromPixbuf } from './MusicColorExtractor.js';
import { isActorAlive, setBoxVertical } from '../../../core/Utils.js';


let POPUP_ART_BLUR_INTENSITY = 4.0;

const WAVE_AMPLITUDE = 3.5;
const WAVE_FREQUENCY = 0.08;
const SLIDER_HEIGHT = 26;
const POPUP_GAP_PX = 20;

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

        this._buildUI();
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
                background-gradient-start: rgba(0, 0, 0, 0.35);
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

        this._spotifyIcon = new St.Icon({
            icon_name: 'spotify-indicator-symbolic',
            icon_size: 24,
            style: 'color: #ffffff;',
            x_align: Clutter.ActorAlign.START,
        });

        if (!this._spotifyIcon.gicon && !Gio.ThemedIcon.new('spotify-indicator-symbolic')) {
            this._spotifyIcon.icon_name = 'audio-x-generic-symbolic';
        }

        topRow.add_child(this._spotifyIcon);
        this._contentBox.add_child(topRow);

        const spacer = new St.Widget({
            y_expand: true,
            reactive: false,
        });
        this._contentBox.add_child(spacer);

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

        this._metaBox.add_child(this._titleLabel);
        this._metaBox.add_child(this._artistLabel);
        this._contentBox.add_child(this._metaBox);

        this._sliderCanvas = new St.DrawingArea({
            height: SLIDER_HEIGHT,
            x_expand: true,
            reactive: true,
            style: 'margin-bottom: 2px;',
        });

        this._sliderCanvas.connect('repaint', () => this._drawWavySlider());

        this._sliderCanvas.connectObject('button-press-event', (_actor, event) => {
            this._isDragging = true;
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
            this._isDragging = false;
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
            style: `
                background-color: rgba(255, 255, 255, 0.16);
                border: none;
                border-radius: 999px;
                padding: 4px 18px;
                spacing: 20px;
            `,
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
            try {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file(artPath);
                if (pixbuf) {
                    colors = extractColorsFromPixbuf(pixbuf);
                }
            } catch (_e) { }
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

        this._scrim.style = 'background-gradient-direction: vertical; background-gradient-start: rgba(0, 0, 0, 0.28); background-gradient-end: ' + bg + '; border-radius: 26px;';

        this._spotifyIcon.style = 'color: ' + accent + ';';

        this._pillBar.style = `
            background-color: rgba(255, 255, 255, 0.16);
            border: none;
            border-radius: 999px;
            padding: 4px 18px;
            spacing: 20px;
        `;

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

        const title = this._pill._titleLabel ? this._pill._titleLabel.text : 'Unknown Title';
        const artist = this._pill._artistLabel ? this._pill._artistLabel.text : 'Unknown Artist';
        const isPlaying = this._pill._isPlaying;

        this._titleLabel.text = title || 'Unknown Title';
        this._artistLabel.text = artist || 'Unknown Artist';
        this._playIcon.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        this._durationSec = this._pill._durationSec > 0 ? this._pill._durationSec : 1;

        const localArtPath = this._pill._lastArtUrl;
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
            const nowMono = GLib.get_monotonic_time() / 1000;
            const elapsed = isPlaying ? Math.max(0, nowMono - this._pill._lastPositionTimeMs) : 0;
            this._positionSec = (this._pill._lastBasePositionMs + elapsed) / 1000;

            this._timeElapsedLabel.text = formatTime(this._positionSec);
            this._timeTotalLabel.text = formatTime(this._durationSec);

            if (isPlaying) {
                this._phase += 0.04;
            }
            if (isActorAlive(this._sliderCanvas)) {
                this._sliderCanvas.queue_repaint();
            }
        }
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
        Main.layoutManager.uiGroup.add_child(this._overlay);

        this._positionPopup();

        if (this._pill && this._pill._lastExtractedColors) {
            this._applyColors(this._pill._lastArtUrl);
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

        this._loopId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 33, () => {
            if (!this._isOpen) return GLib.SOURCE_REMOVE;
            this._updateState();
            return GLib.SOURCE_CONTINUE;
        });

        this._stageClickId = global.stage.connectObject('captured-event', (_stage, event) => {
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

    hide() {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (this._loopId) {
            this._tracker.remove(this._loopId);
            this._loopId = 0;
        }

        global.stage.disconnectObject(this);
        global.display.disconnectObject(this);

        this._box.ease({
            opacity: 0,
            scale_x: 0.9,
            scale_y: 0.9,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (isActorAlive(this._overlay) && this._overlay.get_parent()) {
                    Main.layoutManager.uiGroup.remove_child(this._overlay);
                }
            },
        });
    }

    toggle() {
        if (this._isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    destroy() {
        this.hide();
        if (this._tracker) {
            this._tracker.destroy();
            this._tracker = null;
        }
        if (this._artBackground && this._artBlurEffect) {
            try { this._artBackground.remove_effect(this._artBlurEffect); } catch (_e) { }
            this._artBlurEffect = null;
        }
        if (isActorAlive(this._overlay)) {
            this._overlay.destroy();
        }
    }
}