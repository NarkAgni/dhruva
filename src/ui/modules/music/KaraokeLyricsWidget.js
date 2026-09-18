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
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';

import { isActorAlive } from '../../../core/Utils.js';
import { TimeoutTracker } from '../../../core/TimeoutTracker.js';


const SLIDE_DURATION_MS = 220;
const INITIAL_HEAD_PAUSE_MS = 300;

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

        this._currentText = '';
        this._previousText = '';

        this._slideProgress = 1.0;
        this._slideStartTime = 0;
        this._slideActive = false;
        this._slideTickId = 0;

        this._marqueeOffset = 0;
        this._marqueeOverflow = 0;
        this._marqueeDuration = 0;
        this._marqueeStartTime = 0;
        this._marqueeTickId = 0;

        this._measuredCurrentW = 0;
        this._measuredPreviousW = 0;

        this._isDestroyed = false;
        this._tracker = new TimeoutTracker();
        this._fontDesc = Pango.FontDescription.from_string('Sans Bold 11');
    }

    resetState() {
        this._stopSlide();
        this._stopMarquee();
        this._currentText = '';
        this._previousText = '';
        this._marqueeOffset = 0;
        this._slideProgress = 1.0;
        this._slideActive = false;
        this.queue_repaint();
    }

    setLyricLine(text, durationMs = 3500) {
        if (this._isDestroyed || !isActorAlive(this)) return;

        const safe = text ? text.trim() : '';

        this._previousText = this._currentText;
        this._currentText = safe;

        this._stopMarquee();
        this._marqueeOffset = 0;

        if (this._currentText) {
            const layout = this.create_pango_layout(this._currentText);
            layout.set_font_description(this._fontDesc);
            this._measuredCurrentW = layout.get_pixel_size()[0];
        } else {
            this._measuredCurrentW = 0;
        }

        if (this._previousText) {
            const layout = this.create_pango_layout(this._previousText);
            layout.set_font_description(this._fontDesc);
            this._measuredPreviousW = layout.get_pixel_size()[0];
        } else {
            this._measuredPreviousW = 0;
        }

        this._startSlide(durationMs);
    }

    _startSlide(lineDurationMs) {
        if (this._isDestroyed) return;

        this._slideProgress = 0.0;
        this._slideStartTime = Date.now();
        this._slideActive = true;

        this._stopSlide();
        this._slideTickId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 16, () => {
            if (this._isDestroyed || !isActorAlive(this)) {
                this._slideTickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            const elapsed = Date.now() - this._slideStartTime;
            const t = Math.min(1.0, elapsed / SLIDE_DURATION_MS);
            this._slideProgress = 1.0 - Math.pow(1.0 - t, 3);

            this.queue_repaint();

            if (t >= 1.0) {
                this._slideActive = false;
                this._previousText = '';
                this._slideTickId = 0;

                const remainingLineTime = Math.max(800, lineDurationMs - SLIDE_DURATION_MS);
                this._evaluateMarquee(remainingLineTime);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopSlide() {
        if (this._slideTickId) {
            this._tracker.remove(this._slideTickId);
            this._slideTickId = 0;
        }
    }

    _evaluateMarquee(allocatedTimeMs) {
        if (this._isDestroyed || !isActorAlive(this) || !this._currentText) return;

        const w = this.width || 160;
        if (this._measuredCurrentW <= w) {
            this._marqueeOffset = 0;
            this._marqueeOverflow = 0;
            this.queue_repaint();
            return;
        }

        this._marqueeOverflow = this._measuredCurrentW - w + 12;

        const naturalSingingDuration = Math.max(1200, Math.min(allocatedTimeMs, Math.max(2200, this._currentText.length * 110)));
        this._marqueeDuration = Math.max(600, naturalSingingDuration - INITIAL_HEAD_PAUSE_MS);
        this._marqueeStartTime = Date.now();

        this._startMarquee();
    }

    _startMarquee() {
        this._stopMarquee();
        this._marqueeTickId = this._tracker.addTimeout(GLib.PRIORITY_DEFAULT, 16, () => {
            if (this._isDestroyed || !isActorAlive(this) || !this._currentText || this._slideActive) {
                this._marqueeTickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            const elapsed = Date.now() - this._marqueeStartTime;

            if (elapsed < INITIAL_HEAD_PAUSE_MS) {
                this._marqueeOffset = 0;
            } else {
                const scrollElapsed = elapsed - INITIAL_HEAD_PAUSE_MS;
                const progress = Math.min(1.0, scrollElapsed / this._marqueeDuration);

                this._marqueeOffset = -Math.round(this._marqueeOverflow * progress);

                if (progress >= 1.0) {
                    this._marqueeOffset = -this._marqueeOverflow;
                    this.queue_repaint();
                    this._marqueeTickId = 0;
                    return GLib.SOURCE_REMOVE;
                }
            }

            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopMarquee() {
        if (this._marqueeTickId) {
            this._tracker.remove(this._marqueeTickId);
            this._marqueeTickId = 0;
        }
    }

    vfunc_repaint() {
        if (this._isDestroyed || !isActorAlive(this)) return;
        if (!this._currentText && !this._previousText) return;

        const cr = this.get_context();
        if (!cr) return;

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
            this._drawTextLine(
                cr,
                this._previousText,
                h,
                0,
                -slideOffset,
                1.0 - this._slideProgress
            );
        }

        if (this._currentText) {
            const yOffset = this._slideActive ? (h - slideOffset) : 0;
            const xOffset = this._slideActive ? 0 : this._marqueeOffset;
            const opacity = this._slideActive ? this._slideProgress : 1.0;

            this._drawTextLine(
                cr,
                this._currentText,
                h,
                xOffset,
                yOffset,
                opacity
            );
        }

        cr.$dispose();
    }

    _drawTextLine(cr, text, h, xOffset, yOffset, opacity) {
        if (!text) return;

        const layout = PangoCairo.create_layout(cr);
        layout.set_font_description(this._fontDesc);
        layout.set_text(text, -1);
        layout.set_alignment(Pango.Alignment.LEFT);

        const logical = layout.get_pixel_extents()[1];
        const yPos = Math.round((h - logical.height) / 2) - logical.y + yOffset;

        cr.setSourceRGBA(1.0, 1.0, 1.0, Math.max(0.0, Math.min(1.0, opacity)));
        cr.moveTo(xOffset, yPos);
        PangoCairo.show_layout(cr, layout);
    }

    _cleanup() {
        this._isDestroyed = true;
        this._stopSlide();
        this._stopMarquee();
        if (this._tracker) {
            this._tracker.destroy();
            this._tracker = null;
        }
    }

    destroy() {
        this._cleanup();
        super.destroy();
    }
});