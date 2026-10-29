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
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';


const SLIDE_DURATION_MS = 220;
const INITIAL_HEAD_PAUSE_MS = 300;
const MIN_LINE_MS = 800;
const LYRIC_FONT_PX = 17;
const CAP_HEIGHT_RATIO = 0.72;
const FALLBACK_FONT = 'Sans Bold 17px';

export const KaraokeLyricsWidget = GObject.registerClass({
    GTypeName: 'DhruvaKaraokeLyricsWidget',
}, class KaraokeLyricsWidget extends St.DrawingArea {
    _init(width, height) {
        super._init({
            reactive: false,
            can_focus: false,
            width: width,
            height: height,
            clip_to_allocation: true,
        });

        this._isAlive = true;
        this._currentText = '';
        this._previousText = '';
        this._color = { r: 1.0, g: 1.0, b: 1.0 };
        this._fontDesc = null;

        this._slideProgress = 1.0;
        this._slideActive = false;
        this._remainingLineMs = 0;

        this._marqueeOffset = 0;
        this._marqueeOverflow = 0;
        this._marqueeDuration = 0;

        this._measuredCurrentW = 0;

        this._slideTimeline = new Clutter.Timeline({ actor: this, duration: SLIDE_DURATION_MS });
        this._slideTimeline.connectObject(
            'new-frame', () => this._onSlideFrame(),
            'completed', () => this._onSlideCompleted(),
            this
        );

        this._marqueeTimeline = new Clutter.Timeline({ actor: this, duration: 1000 });
        this._marqueeTimeline.connectObject(
            'new-frame', () => this._onMarqueeFrame(),
            'completed', () => {
                this._marqueeOffset = -this._marqueeOverflow;
                this.queue_repaint();
            },
            this
        );

        this.connectObject(
            'style-changed', () => {
                this._fontDesc = null;
            },
            'destroy', () => this._cleanup(),
            this
        );
    }

    _font() {
        if (this._fontDesc) return this._fontDesc;
        if (!this.get_stage()) return Pango.FontDescription.from_string(FALLBACK_FONT);

        const font = this.get_theme_node().get_font().copy();
        font.set_weight(Pango.Weight.BOLD);
        font.set_absolute_size(LYRIC_FONT_PX * Pango.SCALE);
        this._fontDesc = font;
        return font;
    }

    setColor(r, g, b) {
        this._color = { r, g, b };
        this.queue_repaint();
    }

    resetState() {
        if (!this._isAlive) return;
        this._slideTimeline.stop();
        this._marqueeTimeline.stop();
        this._currentText = '';
        this._previousText = '';
        this._marqueeOffset = 0;
        this._slideProgress = 1.0;
        this._slideActive = false;
        this.queue_repaint();
    }

    setLyricLine(text, durationMs = 3500) {
        if (!this._isAlive) return;

        this._previousText = this._currentText;
        this._currentText = text ? text.trim() : '';

        this._marqueeTimeline.stop();
        this._marqueeOffset = 0;

        if (this._currentText) {
            const layout = this.create_pango_layout(this._currentText);
            layout.set_font_description(this._font());
            this._measuredCurrentW = layout.get_pixel_size()[0];
        } else {
            this._measuredCurrentW = 0;
        }

        this._remainingLineMs = Math.max(MIN_LINE_MS, durationMs - SLIDE_DURATION_MS);
        this._slideProgress = 0.0;
        this._slideActive = true;
        this._slideTimeline.stop();
        this._slideTimeline.rewind();
        this._slideTimeline.start();
    }

    _onSlideFrame() {
        const t = this._slideTimeline.get_progress();
        this._slideProgress = 1.0 - Math.pow(1.0 - t, 3);
        this.queue_repaint();
    }

    _onSlideCompleted() {
        this._slideActive = false;
        this._slideProgress = 1.0;
        this._previousText = '';
        this.queue_repaint();
        this._evaluateMarquee();
    }

    _evaluateMarquee() {
        if (!this._isAlive || !this._currentText) return;

        const w = this.width || 160;
        if (this._measuredCurrentW <= w) {
            this._marqueeOffset = 0;
            this._marqueeOverflow = 0;
            this.queue_repaint();
            return;
        }

        this._marqueeOverflow = this._measuredCurrentW - w + 12;
        const singingDuration = Math.max(1200, Math.min(this._remainingLineMs, Math.max(2200, this._currentText.length * 110)));
        this._marqueeDuration = Math.max(600, singingDuration - INITIAL_HEAD_PAUSE_MS);

        this._marqueeTimeline.stop();
        this._marqueeTimeline.set_duration(INITIAL_HEAD_PAUSE_MS + this._marqueeDuration);
        this._marqueeTimeline.rewind();
        this._marqueeTimeline.start();
    }

    _onMarqueeFrame() {
        const elapsed = this._marqueeTimeline.get_elapsed_time();
        const progress = Math.min(1.0, Math.max(0, elapsed - INITIAL_HEAD_PAUSE_MS) / this._marqueeDuration);
        this._marqueeOffset = -Math.round(this._marqueeOverflow * progress);
        this.queue_repaint();
    }

    vfunc_repaint() {
        if (!this._isAlive || (!this._currentText && !this._previousText)) return;

        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }

        cr.setOperator(0);
        cr.paint();
        cr.setOperator(2);

        const slideOffset = Math.round(h * this._slideProgress);

        if (this._slideActive && this._previousText) {
            this._drawTextLine(cr, this._previousText, h, 0, -slideOffset, 1.0 - this._slideProgress);
        }

        if (this._currentText) {
            const yOffset = this._slideActive ? (h - slideOffset) : 0;
            const xOffset = this._slideActive ? 0 : this._marqueeOffset;
            const opacity = this._slideActive ? this._slideProgress : 1.0;
            this._drawTextLine(cr, this._currentText, h, xOffset, yOffset, opacity);
        }

        cr.$dispose();
    }

    _drawTextLine(cr, text, h, xOffset, yOffset, opacity) {
        const layout = PangoCairo.create_layout(cr);
        layout.set_font_description(this._font());
        layout.set_text(text, -1);
        layout.set_alignment(Pango.Alignment.LEFT);

        const baseline = layout.get_baseline() / Pango.SCALE;
        const yPos = Math.round((h + LYRIC_FONT_PX * CAP_HEIGHT_RATIO) / 2 - baseline) + yOffset;

        const { r, g, b } = this._color;
        cr.setSourceRGBA(r, g, b, Math.max(0.0, Math.min(1.0, opacity)));
        cr.moveTo(xOffset, yPos);
        PangoCairo.show_layout(cr, layout);
    }

    _cleanup() {
        this._isAlive = false;
        this._slideTimeline.stop();
        this._marqueeTimeline.stop();
        this._slideTimeline.disconnectObject(this);
        this._marqueeTimeline.disconnectObject(this);
        this._slideTimeline = null;
        this._marqueeTimeline = null;
        this.disconnectObject(this);
    }
});