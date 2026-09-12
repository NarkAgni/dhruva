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
import Clutter from 'gi://Clutter';

import { setBoxVertical } from '../../core/Utils.js';


const CONTROL_BTN_SIZE = 20;

export function createIconMenuItem(text, onClick, isDestructive = false, bindObject = null) {
    const btn = new St.Button({
        reactive: true,
        x_expand: true,
        style_class: isDestructive ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn'
    });

    const box = new St.BoxLayout({
        style: 'spacing: 12px;',
        y_align: Clutter.ActorAlign.CENTER
    });
    setBoxVertical(box, false);

    box.add_child(new St.Label({
        text,
        style_class: isDestructive ? 'context-menu-action-label-destructive' : 'context-menu-action-label',
        y_align: Clutter.ActorAlign.CENTER
    }));

    btn.set_child(box);
    if (onClick) btn.connectObject('clicked', onClick, bindObject || btn);
    return btn;
}

export function createMenuItem(text, onClick, isDestructive = false, bindObject = null) {
    const btn = new St.Button({
        reactive: true,
        x_expand: true,
        style_class: isDestructive ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn'
    });

    btn.set_child(new St.Label({
        text,
        style_class: isDestructive ? 'context-menu-action-label-destructive' : 'context-menu-action-label'
    }));

    if (onClick) btn.connectObject('clicked', onClick, bindObject || btn);
    return btn;
}

export function createWindowControl(iconName, rgbColor, onClick, bindObject = null) {
    const btn = new St.Button({
        child: new St.Icon({
            icon_name: iconName,
            icon_size: 13,
            style: 'color: rgba(255,255,255,1.0);'
        }),
        style_class: 'context-menu-win-control-btn',
        style: `background-color: rgba(${rgbColor}, 0.40);`,
        reactive: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER
    });

    const target = bindObject || btn;

    if (onClick) btn.connectObject('clicked', onClick, target);

    btn.connectObject('enter-event', () => {
        btn.set_style(`background-color: rgba(${rgbColor}, 0.75); border-radius: 999px; width: ${CONTROL_BTN_SIZE}px; height: ${CONTROL_BTN_SIZE}px; border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 4px 10px rgba(0,0,0,0.45); transition-duration: 150ms;`);
        btn.ease({ scale_x: 1.1, scale_y: 1.1, duration: 120 });
        return Clutter.EVENT_PROPAGATE;
    }, target);

    btn.connectObject('leave-event', () => {
        btn.set_style(`background-color: rgba(${rgbColor}, 0.40); border-radius: 999px; width: ${CONTROL_BTN_SIZE}px; height: ${CONTROL_BTN_SIZE}px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 2px 5px rgba(0,0,0,0.25); transition-duration: 150ms;`);
        btn.ease({ scale_x: 1.0, scale_y: 1.0, duration: 120 });
        return Clutter.EVENT_PROPAGATE;
    }, target);

    return btn;
}

export function addSeparator(panel) {
    if (!panel) return;
    panel.add_child(new St.Widget({
        style_class: 'context-menu-separator-line'
    }));
}