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
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';

import { isActorAlive } from '../../../core/Utils.js';


export const CrispLabel = GObject.registerClass({
    GTypeName: 'DhruvaCrispLabel',
    Properties: {
        'text': GObject.ParamSpec.string(
            'text', 'text', 'text',
            GObject.ParamFlags.READWRITE,
            ''
        ),
    },
}, class CrispLabel extends St.DrawingArea {
    _init(params = {}) {
        const fontDesc = params.font_desc || 'Sans 11';
        const color = params.color || 'rgba(255,255,255,1.0)';
        const align = params.align || 'left';

        delete params.font_desc;
        delete params.color;
        delete params.align;

        super._init({
            reactive: false,
            can_focus: false,
            ...params,
        });

        this._fontDesc = Pango.FontDescription.from_string(fontDesc);
        this._color = color;
        this._align = align;
        this._text = '';

        this._measuredW = 0;
        this._measuredH = 0;
        this._baselineY = 0;

        this.clutter_text = {
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: false,
            use_markup: false,
            single_line_mode: true,
        };

        this.connect('notify::text', () => this.queue_repaint());
    }

    get text() {
        return this._text;
    }

    set text(v) {
        const s = (v === null || v === undefined) ? '' : String(v);
        if (this._text === s) return;
        this._text = s;
        this._remeasure();
        this.queue_repaint();
    }

    _remeasure() {
        if (!isActorAlive(this)) return;
        const layout = this.create_pango_layout(this._text || ' ');
        layout.set_font_description(this._fontDesc);
        layout.set_alignment(
            this._align === 'center' ? Pango.Alignment.CENTER :
            this._align === 'right' ? Pango.Alignment.RIGHT :
            Pango.Alignment.LEFT
        );

        const [logicalW, logicalH] = layout.get_pixel_size();
        this._measuredW = logicalW;
        this._measuredH = logicalH;

        this.set_size(logicalW, logicalH);
    }

    vfunc_get_preferred_width(_forHeight) {
        if (!this._text) {
            const layout = this.create_pango_layout(' ');
            layout.set_font_description(this._fontDesc);
            const [w] = layout.get_pixel_size();
            return [w, w];
        }
        this._remeasure();
        return [this._measuredW, this._measuredW];
    }

    vfunc_get_preferred_height(_forWidth) {
        if (!this._text) {
            const layout = this.create_pango_layout(' ');
            layout.set_font_description(this._fontDesc);
            const [, h] = layout.get_pixel_size();
            return [h, h];
        }
        this._remeasure();
        return [this._measuredH, this._measuredH];
    }

    vfunc_repaint() {
        if (!isActorAlive(this) || !this._text) return;

        const cr = this.get_context();
        const [w, h] = this.get_surface_size();

        cr.setOperator(0);
        cr.paint();
        cr.setOperator(2);

        const layout = this.create_pango_layout(this._text);
        layout.set_font_description(this._fontDesc);
        layout.set_alignment(
            this._align === 'center' ? Pango.Alignment.CENTER :
            this._align === 'right' ? Pango.Alignment.RIGHT :
            Pango.Alignment.LEFT
        );

        const [textW, textH] = layout.get_pixel_size();
        const x = Math.round((w - textW) / 2);
        const y = Math.round((h - textH) / 2);

        Gdk_parseColorToCairo(cr, this._color);
        cr.moveTo(x, y);
        PangoCairo.show_layout(cr, layout);

        cr.$dispose();
    }
});

function Gdk_parseColorToCairo(cr, color) {
    if (color.startsWith('#')) {
        let hex = color.slice(1);
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        cr.setSourceRGBA(r, g, b, 1.0);
        return;
    }
    const m = color.match(/[\d.]+/g);
    if (m && m.length >= 3) {
        cr.setSourceRGBA(
            parseInt(m[0], 10) / 255,
            parseInt(m[1], 10) / 255,
            parseInt(m[2], 10) / 255,
            m.length >= 4 ? parseFloat(m[3]) : 1.0
        );
    } else {
        cr.setSourceRGBA(1, 1, 1, 1);
    }
}