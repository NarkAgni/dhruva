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
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';


const ACTIVE_SIZE_PT = 18;
const NEIGHBOR_SIZE_PT = 12;
const INACTIVE_SIZE_PT = 11;
const LINE_SPACING = 8;
const PADDING_X = 14;
const SCROLL_EASING = 0.06;
const FRAME_MS = 16;
const SETTLE_PX = 0.5;
const WHEEL_STEP_PX = 40;
const FALLBACK_FAMILY = 'Sans';

const ACTIVE_COLOR = { r: 1, g: 1, b: 1, a: 1 };
const NEIGHBOR_COLOR = { r: 1, g: 1, b: 1, a: 0.6 };
const INACTIVE_COLOR = { r: 1, g: 1, b: 1, a: 0.25 };
const PLAIN_COLOR = { r: 1, g: 1, b: 1, a: 0.85 };

export const PopupLyricsWidget = GObject.registerClass({
    GTypeName: 'DhruvaPopupLyricsWidget',
    Signals: {
        'line-activated': { param_types: [GObject.TYPE_INT] },
    },
}, class PopupLyricsWidget extends St.DrawingArea {
    _init() {
        super._init({
            reactive: true,
            can_focus: false,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });

        this._isAlive = true;
        this._lines = [];
        this._isSynced = false;
        this._geometries = [];
        this._geometryLines = null;
        this._geometryWidth = -1;
        this._geometryIndex = -2;
        this._totalHeight = 0;
        this._activeIndex = -1;
        this._scrollOffset = 0;
        this._targetScrollOffset = 0;
        this._family = null;

        this._scrollTimeline = new Clutter.Timeline({ actor: this, duration: 1000, repeat_count: -1 });
        this._scrollTimeline.connectObject('new-frame', () => this._onScrollFrame(), this);
        this._lastFrameTime = 0;

        this.connectObject(
            'style-changed', () => {
                this._family = null;
                this._geometryLines = null;
            },
            'button-release-event', (_actor, event) => this._onClick(event),
            'scroll-event', (_actor, event) => this._onWheel(event),
            'destroy', () => this._cleanup(),
            this
        );
    }

    _fontFamily() {
        if (this._family) return this._family;
        if (!this.get_stage()) return FALLBACK_FAMILY;
        this._family = this.get_theme_node().get_font().get_family() || FALLBACK_FAMILY;
        return this._family;
    }

    _font(sizePt) {
        const font = new Pango.FontDescription();
        font.set_family(this._fontFamily());
        font.set_weight(Pango.Weight.BOLD);
        font.set_size(sizePt * Pango.SCALE);
        return font;
    }

    setLyrics(lines, isSynced) {
        if (!this._isAlive) return;
        this._lines = lines;
        this._isSynced = isSynced;
        this._geometryLines = null;
        this._activeIndex = -1;
        this._scrollOffset = 0;
        this._targetScrollOffset = 0;
        this.queue_repaint();
    }

    setActiveIndex(index) {
        if (!this._isAlive || !this._isSynced || index === this._activeIndex) return;
        this._activeIndex = index;
        this.queue_repaint();
        this._startScroll();
    }

    _startScroll() {
        if (this._scrollTimeline.is_playing()) return;
        this._lastFrameTime = 0;
        this._scrollTimeline.start();
    }

    _onScrollFrame() {
        const now = GLib.get_monotonic_time() / 1000;
        const dt = this._lastFrameTime ? Math.max(1, now - this._lastFrameTime) : FRAME_MS;
        this._lastFrameTime = now;

        const diff = this._targetScrollOffset - this._scrollOffset;
        if (Math.abs(diff) < SETTLE_PX) {
            this._scrollOffset = this._targetScrollOffset;
            this._scrollTimeline.stop();
        } else {
            this._scrollOffset += diff * (1 - Math.pow(1 - SCROLL_EASING, dt / FRAME_MS));
        }
        this.queue_repaint();
    }

    _sizeFor(index) {
        if (!this._isSynced) return NEIGHBOR_SIZE_PT;
        if (index === this._activeIndex) return ACTIVE_SIZE_PT;
        return Math.abs(index - this._activeIndex) === 1 ? NEIGHBOR_SIZE_PT : INACTIVE_SIZE_PT;
    }

    _colorFor(index) {
        if (!this._isSynced) return PLAIN_COLOR;
        if (index === this._activeIndex) return ACTIVE_COLOR;
        return Math.abs(index - this._activeIndex) === 1 ? NEIGHBOR_COLOR : INACTIVE_COLOR;
    }

    _measure(layout, width, height) {
        if (this._geometryLines !== this._lines || this._geometryWidth !== width || this._geometryIndex !== this._activeIndex) {
            this._geometryLines = this._lines;
            this._geometryWidth = width;
            this._geometryIndex = this._activeIndex;
            this._geometries = [];
            let cursorY = 0;

            this._lines.forEach((line, index) => {
                const font = this._font(this._sizeFor(index));
                layout.set_font_description(font);
                layout.set_text(line.text, -1);
                const lineHeight = layout.get_extents()[1].height / Pango.SCALE;
                this._geometries.push({ y: cursorY, height: lineHeight, text: line.text, font, color: this._colorFor(index) });
                cursorY += lineHeight + LINE_SPACING;
            });

            this._totalHeight = Math.max(cursorY - LINE_SPACING, 0);
        }

        if (!this._isSynced) {
            this._targetScrollOffset = Math.max(0, Math.min(this._targetScrollOffset, this._totalHeight - height));
            return;
        }

        const geo = this._geometries[this._activeIndex];
        const firstHeight = this._geometries.length > 0 ? this._geometries[0].height : 0;
        this._targetScrollOffset = geo
            ? geo.y + geo.height / 2 - height / 2
            : firstHeight / 2 - height / 2;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        if (width <= 0 || height <= 0 || this._lines.length === 0) {
            cr.$dispose();
            return;
        }

        const layout = PangoCairo.create_layout(cr);
        layout.set_width((width - PADDING_X * 2) * Pango.SCALE);
        layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        layout.set_alignment(Pango.Alignment.CENTER);

        this._measure(layout, width, height);
        if (Math.abs(this._targetScrollOffset - this._scrollOffset) >= SETTLE_PX) this._startScroll();

        for (const geo of this._geometries) {
            const y = geo.y - this._scrollOffset;
            if (y + geo.height < -30 || y > height + 30) continue;

            layout.set_font_description(geo.font);
            layout.set_text(geo.text, -1);
            cr.setSourceRGBA(geo.color.r, geo.color.g, geo.color.b, geo.color.a);
            cr.moveTo(PADDING_X, y);
            PangoCairo.show_layout(cr, layout);
        }

        cr.$dispose();
    }

    _onClick(event) {
        if (!this._isSynced || event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;

        const [, , localY] = this.transform_stage_point(...event.get_coords());
        const contentY = localY + this._scrollOffset;
        const index = this._geometries.findIndex(geo => contentY >= geo.y - LINE_SPACING / 2 && contentY <= geo.y + geo.height + LINE_SPACING / 2);
        if (index === -1) return Clutter.EVENT_PROPAGATE;

        this.emit('line-activated', index);
        return Clutter.EVENT_STOP;
    }

    _onWheel(event) {
        if (this._isSynced) return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();
        let delta = 0;
        if (direction === Clutter.ScrollDirection.UP) delta = -WHEEL_STEP_PX;
        else if (direction === Clutter.ScrollDirection.DOWN) delta = WHEEL_STEP_PX;
        else if (direction === Clutter.ScrollDirection.SMOOTH) delta = event.get_scroll_delta()[1] * WHEEL_STEP_PX;
        if (delta === 0) return Clutter.EVENT_PROPAGATE;

        this._targetScrollOffset += delta;
        this.queue_repaint();
        return Clutter.EVENT_STOP;
    }

    _cleanup() {
        this._isAlive = false;
        this._scrollTimeline.stop();
        this._scrollTimeline.disconnectObject(this);
        this._scrollTimeline = null;
        this.disconnectObject(this);
    }
});