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


import cairo from 'gi://cairo';

import { hexToRgba } from '../../core/Utils.js';
import { traceMenuPath } from '../shared/MenuShape.js';
import { Settings } from '../../core/SettingsManager.js';


const CORNER_RADIUS = 18;
const ARROW_HEIGHT = 12;
const ARROW_WIDTH = 24;

function parseRgba(str) {
    const m = (str || '').match(/[\d.]+/g);
    return m ? m.map(Number) : [0, 0, 0, 0];
}

export function applyThemeStyle(contextMenu, panel) {
    if (!contextMenu || !contextMenu.dockUI || !contextMenu.dockUI.settings) return;

    const settings = contextMenu.dockUI.settings;
    const themeId = Settings.dockTheme || 'default';
    const opacity = Settings.backgroundOpacity / 100.0;
    const sWidth = Settings.strokeWidth;
    const sColor = Settings.strokeColor || '#ffffff';
    const sOpacity = Settings.strokeOpacity / 100.0;

    let bgRgba = hexToRgba(Settings.backgroundColor || '#000000', opacity);

    if (themeId === 'chameleon') {
        const chameleonColor = contextMenu.dockUI._chameleonColor;
        const bg = (chameleonColor && chameleonColor.bg) ? chameleonColor.bg : { r: 30, g: 30, b: 45 };
        bgRgba = `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.88)`;
    } else if (contextMenu.dockUI.actor && contextMenu.dockUI.actor._tooltipBg) {
        const css = contextMenu.dockUI.actor._tooltipBg;
        let match = css.match(/background-gradient-start:\s*(rgba?\([^)]+\))/);
        if (!match) match = css.match(/background-color:\s*(rgba?\([^)]+\))/);

        if (match) {
            const color = match[1];
            if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
                const allColors = css.match(/rgba?\([^)]+\)/g);
                if (allColors) {
                    bgRgba = allColors.find(c => c !== 'rgba(0, 0, 0, 0)' && c.replace(/\s/g, '') !== 'rgba(0,0,0,0)') || bgRgba;
                }
            } else {
                bgRgba = color;
            }
        }
    }

    panel.set_style('background-color: transparent; border: none;');
    contextMenu.bgDrawingArea._bgRgba = bgRgba;
    contextMenu.bgDrawingArea._strokeRgba = sWidth > 0 ? hexToRgba(sColor, sOpacity) : 'transparent';
    contextMenu.bgDrawingArea._sWidth = sWidth;

    if (contextMenu.bgDrawingArea._repaintConnected) return;
    contextMenu.bgDrawingArea._repaintConnected = true;

    contextMenu.bgDrawingArea.connectObject('repaint', (area) => {
        if (!contextMenu._dockPos) return;

        const cr = area.get_context();
        const [fullW, fullH] = area.get_surface_size();
        const sw = area._sWidth || 0;
        const half = sw / 2;
        const w = fullW - sw;
        const h = fullH - sw;

        const ax = (area._arrowCenter || fullW / 2) - half;
        const ay = (area._arrowCenter || fullH / 2) - half;

        cr.save();
        cr.setOperator(cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        cr.translate(half, half);
        traceMenuPath(cr, w, h, CORNER_RADIUS, ARROW_HEIGHT, ARROW_WIDTH, contextMenu._dockPos, ax, ay);

        const [br, bg, bb, ba] = parseRgba(area._bgRgba);
        cr.setSourceRGBA(br / 255, bg / 255, bb / 255, ba);
        cr.fillPreserve();

        if (sw > 0) {
            const [sr, sg, sb, sa] = parseRgba(area._strokeRgba);
            cr.setSourceRGBA(sr / 255, sg / 255, sb / 255, sa);
            cr.setLineWidth(sw);
            cr.setLineJoin(cairo.LineJoin.ROUND);
            cr.stroke();
        } else {
            cr.newPath();
        }

        cr.$dispose();
    }, contextMenu);
}