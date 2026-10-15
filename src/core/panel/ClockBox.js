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
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';

import { setBoxVertical } from '../Utils.js';
import { HYBRID_PANEL_CONFIG } from '../PanelConfig.js';


const CFG = HYBRID_PANEL_CONFIG;

const SIDE_DOCK_CLOCKWISE = true;
const MEASURE_SLACK = 2;


const RotatedClock = GObject.registerClass(
class DhruvaRotatedClock extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'dhruva-date-menu-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._lines = [];
    }

    setLines(lines) {
        this._lines = lines;
        this.queue_relayout();
        if (this.mapped) this.queue_repaint();
    }

    _fontFor(size) {
        const font = this.get_theme_node().get_font().copy();
        font.set_absolute_size(size * Pango.SCALE);
        return font;
    }

    _measure() {
        const context = this.get_pango_context();
        let length = 0;
        let thickness = 0;
        for (const line of this._lines) {
            const layout = Pango.Layout.new(context);
            layout.set_font_description(this._fontFor(line.size));
            layout.set_text(line.text, -1);
            const [w, h] = layout.get_pixel_size();
            length = Math.max(length, w);
            thickness += h;
        }
        thickness += CFG.DATE_MENU_SPACING * Math.max(0, this._lines.length - 1);
        return [length + MEASURE_SLACK, thickness + MEASURE_SLACK];
    }

    vfunc_get_preferred_width(_forHeight) {
        const [, thickness] = this._measure();
        return [thickness, thickness];
    }

    vfunc_get_preferred_height(_forWidth) {
        const [length] = this._measure();
        return [length, length];
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const color = this.get_theme_node().get_foreground_color();
        cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);

        if (SIDE_DOCK_CLOCKWISE) {
            cr.translate(width, 0);
            cr.rotate(Math.PI / 2);
        } else {
            cr.translate(0, height);
            cr.rotate(-Math.PI / 2);
        }

        const layouts = this._lines.map(line => {
            const layout = PangoCairo.create_layout(cr);
            layout.set_font_description(this._fontFor(line.size));
            layout.set_text(line.text, -1);
            return layout;
        });
        const sizes = layouts.map(layout => layout.get_pixel_size());
        const block = sizes.reduce((sum, [, h]) => sum + h, 0) +
            CFG.DATE_MENU_SPACING * Math.max(0, layouts.length - 1);

        let y = Math.round((width - block) / 2);
        layouts.forEach((layout, i) => {
            const [w, h] = sizes[i];
            cr.moveTo(Math.round((height - w) / 2), y);
            PangoCairo.show_layout(cr, layout);
            y += h + CFG.DATE_MENU_SPACING;
        });

        cr.$dispose();
    }
});


export default class ClockBox {
    constructor(clockSettings, isVertical = false) {
        this._settings = clockSettings;
        this._isVertical = isVertical;
        this._lastShowDate = null;
        this._lastKey = '';

        if (isVertical) {
            this.actor = new RotatedClock();
            return;
        }

        this.actor = new St.BoxLayout({
            style_class: 'dhruva-date-menu-box',
            style: `spacing: ${CFG.DATE_MENU_SPACING}px;`,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: false,
        });
        setBoxVertical(this.actor, true);

        this._timeLine = this._makeLine(CFG.DATE_MENU_TIME_FONT_SIZE);
        this._dateLine = this._makeLine(CFG.DATE_MENU_DATE_FONT_SIZE);
    }

    _makeLine(fontSize) {
        const label = new St.Label({
            style_class: 'dhruva-date-menu-label',
            style: `font-size: ${fontSize}px;`,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: false,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        label.clutter_text.line_wrap = false;
        this.actor.add_child(label);
        return label;
    }

    _applyLayout(showDate) {
        this._lastShowDate = showDate;
        this._dateLine.visible = showDate;
        this._timeLine.style_class = showDate ? 'dhruva-date-menu-label' : 'dhruva-date-menu-label solo';
        this._timeLine.set_style(`font-size: ${showDate ? CFG.DATE_MENU_TIME_FONT_SIZE : CFG.DATE_MENU_SOLO_TIME_FONT_SIZE}px;`);
        this._timeLine.translation_y = showDate ? 0 : CFG.DATE_MENU_SOLO_TIME_OFFSET_Y;
        this.actor.set_style(`spacing: ${showDate ? CFG.DATE_MENU_SPACING : 0}px;`);
    }

    _showLines(time, date, showDate) {
        if (this._isVertical) {
            this.actor.setLines(showDate
                ? [{ text: time, size: CFG.DATE_MENU_TIME_FONT_SIZE }, { text: date, size: CFG.DATE_MENU_DATE_FONT_SIZE }]
                : [{ text: time, size: CFG.DATE_MENU_SOLO_TIME_FONT_SIZE }]);
            return;
        }
        if (showDate !== this._lastShowDate) this._applyLayout(showDate);
        this._timeLine.set_text(time);
        if (showDate) this._dateLine.set_text(date);
    }

    update() {
        const now = GLib.DateTime.new_now_local();
        const showSeconds = this._settings.get_boolean('clock-show-seconds');
        const showDate = this._settings.get_boolean('clock-show-date');

        let time;
        if (this._settings.get_string('clock-format') === '12h')
            time = now.format(showSeconds ? '%I:%M:%S %p' : '%I:%M %p').replace(/^0/, '');
        else
            time = now.format(showSeconds ? '%H:%M:%S' : '%H:%M');
        const date = showDate ? now.format('%d/%m/%Y') : '';

        this._showLines(time, date, showDate);

        const key = `${time}|${date}`;
        const lengthChanged = key.length !== this._lastKey.length;
        this._lastKey = key;
        return lengthChanged;
    }

    destroy() {
        this.actor.destroy();
    }
}