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
import PangoCairo from 'gi://PangoCairo';


export function buildClockModule(dockUI, _iconSize) {
    const settings = dockUI.settings;
    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    if (!settings.get_boolean('show-clock') || isVertical) {
        return null;
    }

    const fontSize = settings.get_int('clock-font-size') || 15;
    const is24h = settings.get_boolean('use-24h-clock');
    
    const timeFormat = is24h ? '%a %d | %H:%M' : '%a %d | %I:%M %p';
    let currentTimeString = GLib.DateTime.new_now_local().format(timeFormat);

    const clockLabel = new St.DrawingArea({
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'dock-clock-label'
    });

    const layout = clockLabel.create_pango_layout(currentTimeString);
    const desc = Pango.FontDescription.from_string(`Sans Bold ${fontSize}px`);
    layout.set_font_description(desc);

    const updateDimensions = () => {
        layout.set_text(currentTimeString, -1);
        const [textWidth, textHeight] = layout.get_pixel_size();
        clockLabel.set_size(textWidth + 8, textHeight + 4);
    };
    updateDimensions();

    clockLabel.connect('repaint', (area) => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const [textWidth, textHeight] = layout.get_pixel_size();

        const x = (width - textWidth) / 2;
        const y = (height - textHeight) / 2;

        cr.setSourceRGBA(0, 0, 0, 0.7);
        cr.moveTo(x, y + 1);
        PangoCairo.show_layout(cr, layout);

        cr.setSourceRGBA(1, 1, 1, 0.9);
        cr.moveTo(x, y);
        PangoCairo.show_layout(cr, layout);

        cr.$dispose();
    });

    const clockBtn = new St.Bin({
        child: clockLabel,
        style_class: 'dock-app-button clock-module',
        reactive: true,
        track_hover: false,
        can_focus: false
    });
    clockBtn.set_pivot_point(0.5, 0.5);

    clockBtn.ease = function (props) {
        const newProps = Object.assign({}, props);
        delete newProps.scale_x;
        delete newProps.scale_y;
        Clutter.Actor.prototype.ease.call(this, newProps);
    };
    const origScale = clockBtn.set_scale.bind(clockBtn);
    clockBtn.set_scale = (sx, sy) => {
        if (sx === 1 && sy === 1) origScale(sx, sy);
    };
    clockBtn._delegate = {
        app: {
            get_name: () => 'Date & Time',
            get_state: () => 0,
            get_windows: () => []
        }
    };

    const updateClock = () => {
        const is24hClock = settings.get_boolean('use-24h-clock');
        const fmt = is24hClock ? '%a %d | %H:%M' : '%a %d | %I:%M %p';

        currentTimeString = GLib.DateTime.new_now_local().format(fmt);
        updateDimensions();
        clockLabel.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    };
    updateClock();
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, updateClock);
    clockBtn.connect('destroy', () => {
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return clockBtn;
}