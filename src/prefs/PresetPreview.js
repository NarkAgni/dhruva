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


import Gtk from 'gi://Gtk';

import { readValue } from './Presets.js';
import { roundedRect, paintBackdrop, parseColor, MOCK_ICON_COLORS } from './PrefsWidgets.js';


const THEME_COLORS = {
    carbon: [18, 18, 20], nord: [36, 41, 51], catppuccin: [30, 30, 46], gruvbox: [29, 32, 33],
    ash: [220, 220, 230], dracula: [40, 42, 54], 'tokyo-night': [26, 27, 38], aurora: [11, 52, 58],
    sunset: [90, 32, 35], 'slate-ocean': [15, 32, 56], chameleon: [70, 40, 78],
};
const RUNNING = [0, 1, 3];
const ZOOM_CENTER = 3;
const ACCENT = [0.38, 0.66, 1.0];


export class PresetPreview {
    constructor(settings, height, values = null) {
        this._settings = settings;
        this._override = values;
        this.widget = new Gtk.DrawingArea({ content_height: height, hexpand: true });
        this.widget.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));
    }

    setOverride(values) {
        this._override = values;
        this.redraw();
    }

    redraw() {
        this.widget.queue_draw();
    }

    _get(key) {
        if (this._override && key in this._override) return this._override[key];
        return readValue(this._settings, key);
    }

    _barColor() {
        if (this._get('blur-enabled')) return [1, 1, 1, 0.18];
        const theme = this._get('dock-theme');
        const opacity = this._get('background-opacity') / 100;
        const rgb = THEME_COLORS[theme];
        if (rgb) return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, Math.max(0.35, opacity)];
        const color = parseColor(this._settings.get_string('background-color'));
        return [color.red, color.green, color.blue, Math.max(0.35, opacity)];
    }

    _draw(cr, w, h) {
        const scale = h / 300;
        roundedRect(cr, 0, 0, w, h, 16 * Math.min(1, scale * 1.4));
        cr.clip();
        paintBackdrop(cr, w, h);

        const isPanel = this._get('hybrid-panel-mode');
        if (!isPanel) {
            cr.rectangle(0, 0, w, Math.max(6, 16 * scale));
            cr.setSourceRGBA(0, 0, 0, 0.75);
            cr.fill();
        }
        this._paintWindow(cr, w, h, scale);

        if (isPanel) this._paintPanel(cr, w, h, scale);
        else this._paintDock(cr, w, h, scale);
    }

    _paintWindow(cr, w, h, scale) {
        const x = w * 0.2;
        const y = h * 0.16;
        const ww = w * 0.48;
        const wh = h * 0.46;
        roundedRect(cr, x, y, ww, wh, 10 * scale);
        cr.setSourceRGBA(0.93, 0.94, 0.97, 0.9);
        cr.fill();
        roundedRect(cr, x, y, ww, 18 * scale, 10 * scale);
        cr.setSourceRGBA(0.82, 0.84, 0.9, 1);
        cr.fill();
        for (let i = 0; i < 3; i++) {
            cr.arc(x + ww - (14 + i * 14) * scale, y + 9 * scale, 4 * scale, 0, 2 * Math.PI);
            cr.setSourceRGBA(0.55, 0.57, 0.64, 1);
            cr.fill();
        }
    }

    _iconSizes(base) {
        const zoom = this._get('hover-zoom') ? this._get('hover-zoom-factor') : 1;
        return MOCK_ICON_COLORS.map((_c, i) => base * (1 + (zoom - 1) * Math.exp(-((i - ZOOM_CENTER) ** 2) / 1.6)));
    }

    _paintIcons(cr, startAlong, crossCenter, sizes, gap, position, crossEdge) {
        const isVertical = position === 'LEFT' || position === 'RIGHT';
        let along = startAlong;
        sizes.forEach((size, i) => {
            const [r, g, b] = MOCK_ICON_COLORS[i];
            const crossStart = crossEdge === null ? crossCenter - size / 2 : crossEdge(size);
            const x = isVertical ? crossStart : along;
            const y = isVertical ? along : crossStart;
            roundedRect(cr, x, y, size, size, size * 0.26);
            cr.setSourceRGB(r, g, b);
            cr.fill();
            if (RUNNING.includes(i)) this._paintIndicator(cr, x, y, size, position);
            along += size + gap;
        });
    }

    _paintIndicator(cr, x, y, size, position) {
        if (!this._get('show-running-indicators')) return;
        const isVertical = position === 'LEFT' || position === 'RIGHT';
        const style = this._get('indicator-style');
        const dot = Math.max(2, size * 0.1);
        const offset = size * 0.14;
        const [ix, iy] = {
            BOTTOM: [x + size / 2, y + size + offset],
            TOP: [x + size / 2, y - offset],
            LEFT: [x - offset, y + size / 2],
            RIGHT: [x + size + offset, y + size / 2],
        }[position];
        const isWindows = style === 'windows';
        cr.setSourceRGBA(isWindows ? ACCENT[0] : 1, isWindows ? ACCENT[1] : 1, isWindows ? ACCENT[2] : 1, 0.95);

        if (style === 'dot') {
            cr.arc(ix, iy, dot / 2 + 0.5, 0, 2 * Math.PI);
        } else if (style === 'square') {
            cr.rectangle(ix - dot / 2, iy - dot / 2, dot, dot);
        } else {
            const length = style === 'line' ? size * 0.9 : size * (isWindows ? 0.36 : 0.28);
            if (isVertical) roundedRect(cr, ix - dot / 2, iy - length / 2, dot, length, dot / 2);
            else roundedRect(cr, ix - length / 2, iy - dot / 2, length, dot, dot / 2);
        }
        cr.fill();
    }

    _paintGrid(cr, cx, cy, size) {
        const dot = size * 0.16;
        for (let i = 0; i < 4; i++) {
            const dx = (i % 2 === 0 ? -1 : 1) * dot * 1.3;
            const dy = (i < 2 ? -1 : 1) * dot * 1.3;
            roundedRect(cr, cx + dx - dot / 2, cy + dy - dot / 2, dot, dot, dot / 3);
            cr.setSourceRGBA(1, 1, 1, 0.9);
            cr.fill();
        }
    }

    _paintPill(cr, x, y, width, height) {
        roundedRect(cr, x, y, width, height, height / 2);
        cr.setSourceRGBA(0.1, 0.1, 0.12, 0.95);
        cr.fill();
        cr.arc(x + height / 2, y + height / 2, height * 0.34, 0, 2 * Math.PI);
        cr.setSourceRGB(0.86, 0.36, 0.62);
        cr.fill();
        roundedRect(cr, x + height, y + height * 0.32, width - height * 1.5, height * 0.14, 2);
        cr.setSourceRGBA(1, 1, 1, 0.8);
        cr.fill();
        roundedRect(cr, x + height, y + height * 0.56, (width - height * 1.5) * 0.6, height * 0.12, 2);
        cr.setSourceRGBA(1, 1, 1, 0.45);
        cr.fill();
    }

    _paintDock(cr, w, h, scale) {
        const position = this._get('dock-position');
        const isVertical = position === 'LEFT' || position === 'RIGHT';
        const isFull = this._get('full-width');
        const iconBase = Math.max(8, this._get('icon-size') * scale * 0.9);
        const gap = Math.max(2, this._get('icon-spacing') * scale);
        const thickness = iconBase + Math.max(4, this._get('dock-height') * scale) + 6 * scale;
        const margin = isFull ? 0 : Math.max(3, this._get('dock-margin') * scale);
        const radius = Math.min(this._get('border-radius') * scale, thickness / 2);
        const sizes = this._iconSizes(iconBase);
        const hasGrid = this._get('show-grid-button');
        const hasPill = this._get('show-music-pill');
        const pillLength = hasPill ? iconBase * 3.4 : 0;
        const gridSize = hasGrid ? iconBase : 0;
        const contentLength = sizes.reduce((sum, size) => sum + size, 0) + gap * (sizes.length - 1) +
            (hasGrid ? gridSize + gap : 0) + (hasPill ? pillLength + gap : 0);
        const screenLength = isVertical ? h : w;
        const barLength = isFull ? screenLength : Math.min(screenLength - 12, contentLength + 20 * scale);
        const barStart = (screenLength - barLength) / 2;
        const crossStart = {
            BOTTOM: h - margin - thickness, TOP: Math.max(6, 16 * scale) + margin,
            LEFT: margin, RIGHT: w - margin - thickness,
        }[position];

        cr.save();
        if (this._get('hide-mode') === 'always') cr.pushGroup();

        if (isVertical) roundedRect(cr, crossStart, barStart, thickness, barLength, isFull ? 0 : radius);
        else roundedRect(cr, barStart, crossStart, barLength, thickness, isFull ? 0 : radius);
        const [r, g, b, a] = this._barColor();
        cr.setSourceRGBA(r, g, b, a);
        cr.fill();

        const alignment = isFull ? this._get('icon-alignment') : 'CENTER';
        let along = barStart + (barLength - contentLength) / 2;
        if (alignment === 'START') along = barStart + 12 * scale;
        else if (alignment === 'END') along = barStart + barLength - contentLength - 12 * scale;

        const crossCenter = crossStart + thickness / 2;
        const zoomEdge = this._get('hover-zoom') && !isVertical && position === 'BOTTOM'
            ? size => crossStart + thickness - 4 * scale - iconBase * 0.15 - size
            : null;
        const gridFirst = this._get('grid-button-position') !== 'END';

        const paintGrid = () => {
            if (!hasGrid) return;
            const center = along + gridSize / 2;
            if (isVertical) this._paintGrid(cr, crossCenter, center, gridSize);
            else this._paintGrid(cr, center, crossCenter, gridSize);
            along += gridSize + gap;
        };

        if (gridFirst) paintGrid();
        if (hasPill) {
            const pillThickness = iconBase * 0.92;
            if (isVertical) this._paintPill(cr, crossCenter - pillThickness / 2, along, pillThickness, pillLength);
            else this._paintPill(cr, along, crossCenter - pillThickness / 2, pillLength, pillThickness);
            along += pillLength + gap;
        }
        this._paintIcons(cr, along, crossCenter, sizes, gap, position, zoomEdge);
        along += sizes.reduce((sum, size) => sum + size + gap, 0);
        if (!gridFirst) paintGrid();

        if (this._get('hide-mode') === 'always') {
            cr.popGroupToSource();
            cr.paintWithAlpha(0.35);
        }
        cr.restore();
    }

    _paintPanel(cr, w, h, scale) {
        const isDynamic = this._get('dynamic-panel');
        const barH = Math.max(18, 40 * scale);
        const iconSize = Math.max(8, Math.min(barH * 0.62, this._get('icon-size') * scale * 0.9));
        const gap = Math.max(2, this._get('icon-spacing') * scale);
        const sizes = this._iconSizes(iconSize);
        const appsWidth = sizes.reduce((sum, size) => sum + size, 0) + gap * (sizes.length - 1);
        const statusWidth = 90 * scale;
        const sideWidth = 60 * scale;

        let barX = 0;
        let barW = w;
        let barY = h - barH;
        let radius = 0;
        if (isDynamic) {
            barW = Math.min(w - 16, appsWidth + statusWidth + sideWidth + 40 * scale);
            const position = this._get('dynamic-panel-position');
            barX = position === 'START' ? 8 : (position === 'END' ? w - barW - 8 : (w - barW) / 2);
            barY = h - barH - 6 * scale;
            radius = Math.min(this._get('border-radius') * scale, barH / 2);
        }

        roundedRect(cr, barX, barY, barW, barH, radius);
        const [r, g, b, a] = this._barColor();
        cr.setSourceRGBA(r, g, b, Math.max(a, 0.8));
        cr.fill();

        const centerY = barY + barH / 2;
        roundedRect(cr, barX + 12 * scale, centerY - 3 * scale, 18 * scale, 6 * scale, 3 * scale);
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.fill();
        for (let i = 0; i < 2; i++) {
            cr.arc(barX + (38 + i * 10) * scale, centerY, 3 * scale, 0, 2 * Math.PI);
            cr.setSourceRGBA(1, 1, 1, 0.45);
            cr.fill();
        }

        const right = barX + barW - 12 * scale;
        roundedRect(cr, right - 34 * scale, centerY - 9 * scale, 34 * scale, 7 * scale, 2);
        cr.setSourceRGBA(1, 1, 1, 0.9);
        cr.fill();
        roundedRect(cr, right - 30 * scale, centerY + 3 * scale, 30 * scale, 6 * scale, 2);
        cr.setSourceRGBA(1, 1, 1, 0.55);
        cr.fill();
        for (let i = 0; i < 3; i++) {
            roundedRect(cr, right - (52 + i * 16) * scale, centerY - 5 * scale, 10 * scale, 10 * scale, 2);
            cr.setSourceRGBA(1, 1, 1, 0.85);
            cr.fill();
        }

        let along = barX + (barW - appsWidth) / 2;
        if (this._get('show-grid-button')) {
            const gridCenter = along - gap - iconSize / 2;
            this._paintGrid(cr, gridCenter, centerY, iconSize);
        }
        if (this._get('show-music-pill')) {
            const pillW = iconSize * 3.2;
            this._paintPill(cr, along + appsWidth + gap * 2, centerY - iconSize * 0.46, pillW, iconSize * 0.92);
        }
        this._paintIcons(cr, along, centerY, sizes, gap, 'BOTTOM', null);
    }
}