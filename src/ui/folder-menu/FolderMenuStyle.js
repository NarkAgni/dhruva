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

export function dropDelegate(source) {
    if (!source) return {};
    if (source._delegate) return source._delegate;
    if (source.button && source.button._delegate) return source.button._delegate;
    if (source.sourceActor && source.sourceActor._delegate) return source.sourceActor._delegate;
    if (source.actor && source.actor._delegate) return source.actor._delegate;
    return source;
}

export function dropButton(source) {
    const delegate = dropDelegate(source);
    return delegate.button ||
        (source && source.button) ||
        (source && source.sourceActor) ||
        (source && source.actor) ||
        (source && source.get_parent ? source : null);
}

export function dropAppId(source) {
    const delegate = dropDelegate(source);
    if (delegate.appId) return delegate.appId;
    if (delegate.app && delegate.app.get_id) return delegate.app.get_id();
    if (source && source.app && source.app.get_id) return source.app.get_id();
    return null;
}

export function applyThemeStyle(folderMenu, panel) {
    if (!folderMenu.dockUI || !folderMenu.dockUI.settings) return;
    const settings = folderMenu.dockUI.settings;
    const themeId = Settings.dockTheme || 'default';
    const opacity = Settings.backgroundOpacity / 100.0;
    const sWidth = Settings.strokeWidth;
    const sColor = Settings.strokeColor || '#ffffff';
    const sOpacity = Settings.strokeOpacity / 100.0;

    let bgRgba = hexToRgba(Settings.backgroundColor || '#000000', opacity);

    if (themeId === 'chameleon') {
        const { r, g, b } = (folderMenu.dockUI._chameleonColor && folderMenu.dockUI._chameleonColor.bg) || { r: 30, g: 30, b: 45 };
        bgRgba = `rgba(${r}, ${g}, ${b}, 0.88)`;
    } else if (folderMenu.dockUI.actor && folderMenu.dockUI.actor._tooltipBg) {
        const css = folderMenu.dockUI.actor._tooltipBg;

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
    folderMenu.bgDrawingArea._bgRgba = bgRgba;
    folderMenu.bgDrawingArea._strokeRgba = sWidth > 0 ? hexToRgba(sColor, sOpacity) : 'transparent';
    folderMenu.bgDrawingArea._sWidth = sWidth;

    folderMenu.bgDrawingArea.connectObject('repaint', (area) => {
        if (!folderMenu._dockPos) return;
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
        traceMenuPath(cr, w, h, CORNER_RADIUS, ARROW_HEIGHT, ARROW_WIDTH, folderMenu._dockPos, ax, ay);

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
    }, folderMenu);
}