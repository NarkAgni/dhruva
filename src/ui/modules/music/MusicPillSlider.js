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
import GObject from 'gi://GObject';


export const MusicPillSlider = GObject.registerClass(
    class MusicPillSlider extends St.DrawingArea {
        _init() {
            super._init({
                name: 'DhruvaMusicPillSlider',
                reactive: false,
                can_focus: false,
                x_expand: true,
                y_expand: true,
            });

            this._progressRatio = 0.0;
            this._accentColor = { r: 1.0, g: 1.0, b: 1.0 };
            this._strokeWidth = 2.5;
        }

        setProgress(ratio) {
            const clamped = Math.max(0.0, Math.min(1.0, ratio));
            if (Math.abs(this._progressRatio - clamped) > 0.0008) {
                this._progressRatio = clamped;
                this.queue_repaint();
            }
        }

        setColor(r, g, b) {
            this._accentColor = { r, g, b };
            this.queue_repaint();
        }

        reset() {
            this._progressRatio = 0.0;
            this.queue_repaint();
        }

        vfunc_repaint() {
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

            if (this._progressRatio <= 0.0) {
                cr.$dispose();
                return;
            }

            const stroke = this._strokeWidth;
            const halfStroke = stroke / 2.0;
            const left = halfStroke;
            const top = halfStroke;
            const right = w - halfStroke;
            const bottom = h - halfStroke;
            const radius = Math.max(2, (bottom - top) / 2.0);

            const seg1 = (right - radius) - (w / 2.0);
            const arc1 = 0.5 * Math.PI * radius;
            const seg2 = (bottom - radius) - (top + radius);
            const arc2 = 0.5 * Math.PI * radius;
            const seg3 = (right - radius) - (left + radius);
            const arc3 = 0.5 * Math.PI * radius;
            const seg4 = seg2;
            const arc4 = 0.5 * Math.PI * radius;
            const seg5 = (w / 2.0) - (left + radius);

            const totalPerimeter = seg1 + arc1 + seg2 + arc2 + seg3 + arc3 + seg4 + arc4 + seg5;
            const targetDist = totalPerimeter * this._progressRatio;
            let remaining = targetDist;

            cr.setLineWidth(stroke);
            cr.setLineCap(1);
            cr.setSourceRGBA(this._accentColor.r, this._accentColor.g, this._accentColor.b, 0.85);
            cr.moveTo(w / 2.0, top);

            if (remaining > 0) {
                const step = Math.min(remaining, seg1);
                cr.lineTo((w / 2.0) + step, top);
                remaining -= step;
            }
            if (remaining > 0) {
                const stepArc = Math.min(remaining, arc1);
                cr.arc(right - radius, top + radius, radius, -0.5 * Math.PI, -0.5 * Math.PI + (stepArc / arc1) * (0.5 * Math.PI));
                remaining -= stepArc;
            }
            if (remaining > 0) {
                const step = Math.min(remaining, seg2);
                cr.lineTo(right, top + radius + step);
                remaining -= step;
            }
            if (remaining > 0) {
                const stepArc = Math.min(remaining, arc2);
                cr.arc(right - radius, bottom - radius, radius, 0, (stepArc / arc2) * (0.5 * Math.PI));
                remaining -= stepArc;
            }
            if (remaining > 0) {
                const step = Math.min(remaining, seg3);
                cr.lineTo(right - radius - step, bottom);
                remaining -= step;
            }
            if (remaining > 0) {
                const stepArc = Math.min(remaining, arc3);
                cr.arc(left + radius, bottom - radius, radius, 0.5 * Math.PI, 0.5 * Math.PI + (stepArc / arc3) * (0.5 * Math.PI));
                remaining -= stepArc;
            }
            if (remaining > 0) {
                const step = Math.min(remaining, seg4);
                cr.lineTo(left, bottom - radius - step);
                remaining -= step;
            }
            if (remaining > 0) {
                const stepArc = Math.min(remaining, arc4);
                cr.arc(left + radius, top + radius, radius, Math.PI, Math.PI + (stepArc / arc4) * (0.5 * Math.PI));
                remaining -= stepArc;
            }
            if (remaining > 0) {
                const step = Math.min(remaining, seg5);
                cr.lineTo(left + radius + step, top);
            }

            cr.stroke();
            cr.$dispose();
        }
    }
);