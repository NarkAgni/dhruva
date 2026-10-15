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
import { BlurPanel } from '../blur/BlurPanel.js';
import { traceMenuPath } from './MenuShape.js';
import { Settings } from '../../core/SettingsManager.js';
import { resolveTooltipColors } from '../dock/DockThemeResolver.js';


const CORNER_RADIUS = 18;
const ARROW_HEIGHT = 12;
const ARROW_WIDTH = 24;

function parseRgba(str) {
    const m = (str || '').match(/[\d.]+/g);
    return m ? m.map(Number) : [0, 0, 0, 0];
}

export function applyMenuThemeStyle(menu, panel) {
    const settings = menu.dockUI.settings;
    const isBlurEnabled = settings.get_boolean('blur-enabled');

    panel.set_style('background-color: transparent !important; border: none !important; box-shadow: none !important;');

    if (isBlurEnabled && !menu._blurPanel && menu.menuContainer) {
        const basePad = 2;
        const insets = { top: basePad, bottom: basePad, left: basePad, right: basePad };

        menu._blurPanel = new BlurPanel(
            menu.menuContainer,
            settings,
            CORNER_RADIUS - basePad,
            menu.menuContainer,
            insets
        );
        menu._blurPanel.basePad = basePad;
        menu._blurPanel.contentActor = panel;
    }

    const themeId = Settings.dockTheme || 'default';
    const sWidth = Math.max(1, Settings.strokeWidth);
    const sColor = Settings.strokeColor || '#ffffff';
    const sOpacity = Settings.strokeOpacity / 100.0;

    let bgRgba = 'rgba(24, 24, 28, 0.90)';

    if (isBlurEnabled) {
        bgRgba = 'rgba(0, 0, 0, 0)';
    } else {
        const resolved = resolveTooltipColors(menu.dockUI, themeId);
        const css = (resolved && resolved.css) ? resolved.css : '';

        let match = css.match(/background-gradient-start:\s*([^;]+)/i);
        if (!match) match = css.match(/background-color:\s*([^;]+)/i);

        if (match && match[1] && match[1].trim() !== 'transparent' && match[1].trim() !== 'rgba(0, 0, 0, 0)') {
            bgRgba = match[1].trim();
        } else {
            const opacity = Math.min(1.0, (Settings.backgroundOpacity / 100.0) + 0.10);
            bgRgba = hexToRgba(Settings.backgroundColor || '#241F31', opacity);
        }
    }

    menu.bgDrawingArea._bgRgba = bgRgba;
    menu.bgDrawingArea._strokeRgba = sWidth > 0 ? hexToRgba(sColor, sOpacity) : 'rgba(255, 255, 255, 0.22)';
    menu.bgDrawingArea._sWidth = sWidth;

    if (menu.bgDrawingArea._repaintConnected) return;
    menu.bgDrawingArea._repaintConnected = true;

    menu.bgDrawingArea.connectObject('repaint', (area) => {
        if (!menu._dockPos) return;

        const cr = area.get_context();
        const [fullW, fullH] = area.get_surface_size();
        const sw = area._sWidth || 1;
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
        traceMenuPath(cr, w, h, CORNER_RADIUS, ARROW_HEIGHT, ARROW_WIDTH, menu._dockPos, ax, ay);

        const [br, bg, bb, ba] = parseRgba(area._bgRgba);
        if (ba > 0) {
            cr.setSourceRGBA(br / 255, bg / 255, bb / 255, ba);
            cr.fillPreserve();
        }

        const [sr, sg, sb, sa] = parseRgba(area._strokeRgba);
        cr.setSourceRGBA(sr / 255, sg / 255, sb / 255, Math.max(0.18, sa));
        cr.setLineWidth(sw);
        cr.setLineJoin(cairo.LineJoin.ROUND);
        cr.stroke();

        cr.$dispose();
    }, menu);
}