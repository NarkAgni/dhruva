/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    finishMinimizeEffect,
    finishRestoreEffect
} from './WindowEffects.js';


const WAVE_INTENSITY = 0.25;

class SnakeBase extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }

    _init(iconScreenPos, dockPos) {
        super._init();
        this._iconScreenPos = {
            ...iconScreenPos
        };
        this._dockPos = dockPos || 'BOTTOM';
        this.progress = 0;
        this._ready = false;
        this._finished = false;
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);
        if (!actor || this._ready) return;

        this._ready = true;
        const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        this._monitor = monitor;

        this._win = {
            x: actor.get_x() - monitor.x,
            y: actor.get_y() - monitor.y,
            w: actor.get_width(),
            h: actor.get_height(),
        };

        this._icon = {
            x: this._iconScreenPos.x - monitor.x,
            y: this._iconScreenPos.y - monitor.y,
            w: this._iconScreenPos.w,
            h: this._iconScreenPos.h,
        };

        this._buildTarget();
        this.set_n_tiles(30, 30);

        this._timeline = new Clutter.Timeline({
            actor,
            duration: 520
        });

        this._frameId = this._timeline.connect('new-frame', (tl) => {
            if (!this.get_actor()) {
                this._finish();
                return;
            }
            this._setProgress(tl.get_progress());
            this.get_actor()?.get_parent()?.queue_redraw();
            this.invalidate();
        });

        this._doneId = this._timeline.connect('completed', () => this._finish());
        this._timeline.start();

        this._destroyId = actor.connect('destroy', () => this._finish());
    }

    _finish() {
        if (this._finished) return;
        this._finished = true;

        if (this._timeline) {
            this._timeline.stop();
            if (this._frameId) this._timeline.disconnect(this._frameId);
            if (this._doneId) this._timeline.disconnect(this._doneId);
            this._timeline = null;
        }

        const actor = this.get_actor();
        if (actor) {
            if (this._destroyId) {
                actor.disconnect(this._destroyId);
                this._destroyId = null;
            }
            actor.remove_effect(this);
            this._onDone(actor);
        }
    }

    destroy() {
        this._finish();
    }

    _onDone(_actor) {}

    _buildTarget() {
        const cx = this._icon.x + this._icon.w / 2;
        const cy = this._icon.y + this._icon.h / 2;
        const insetX = this._icon.w * 0.4;
        const insetY = this._icon.h * 0.4;

        if (this._dockPos === 'BOTTOM') {
            this._tgt = {
                x: cx,
                y: this._icon.y + insetY
            };
        } else if (this._dockPos === 'TOP') {
            this._tgt = {
                x: cx,
                y: this._icon.y + this._icon.h - insetY
            };
        } else if (this._dockPos === 'LEFT') {
            this._tgt = {
                x: this._icon.x + this._icon.w - insetX,
                y: cy
            };
        } else {
            this._tgt = {
                x: this._icon.x + insetX,
                y: cy
            };
        }
    }

    _setProgress(p) {
        this.progress = p;
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w;
        const wH = this._win.h;
        const curX = v.tx * wW;
        const curY = v.ty * wH;
        const tgtX = this._tgt.x - this._win.x;
        const tgtY = this._tgt.y - this._win.y;

        let distFromDock;
        if (this._dockPos === 'BOTTOM') {
            distFromDock = 1 - v.ty;
        } else if (this._dockPos === 'TOP') {
            distFromDock = v.ty;
        } else if (this._dockPos === 'LEFT') {
            distFromDock = v.tx;
        } else {
            distFromDock = 1 - v.tx;
        }

        const sweep = 0.55;
        const localP = Math.max(0, Math.min(1, (p - distFromDock * sweep) / (1 - sweep)));
        const eased = localP * localP * (3 - 2 * localP);

        let newX = curX + (tgtX - curX) * eased;
        let newY = curY + (tgtY - curY) * eased;

        const waveAmp = (this._dockPos === 'BOTTOM' || this._dockPos === 'TOP') ?
            wW * WAVE_INTENSITY :
            wH * WAVE_INTENSITY;

        if (this._dockPos === 'BOTTOM' || this._dockPos === 'TOP') {
            const axisT = (this._dockPos === 'BOTTOM') ? (1 - v.ty) : v.ty;
            const phase = axisT * Math.PI * 4;
            const lateral = Math.sin(phase) * waveAmp * p * (1 - eased);
            newX += lateral;
        } else {
            const axisT = (this._dockPos === 'RIGHT') ? (1 - v.tx) : v.tx;
            const phase = axisT * Math.PI * 4;
            const lateral = Math.sin(phase) * waveAmp * p * (1 - eased);
            newY += lateral;
        }

        v.x = newX;
        v.y = newY;
    }

    vfunc_modify_paint_volume(_pv) {
        return false;
    }
}

export class SnakeMinimize extends SnakeBase {
    static {
        GObject.registerClass(this);
    }

    _setProgress(p) {
        this.progress = p;
    }

    _onDone(actor) {
        if (actor) {
            actor.hide();
            actor.remove_all_transitions();
            finishMinimizeEffect(actor);
        }
    }
}

export class SnakeRestore extends SnakeBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconScreenPos, dockPos) {
        super._init(iconScreenPos, dockPos);
        this.progress = 1;
    }

    _setProgress(p) {
        this.progress = 1 - p;
    }

    _onDone(actor) {
        if (actor) {
            actor.show();
            actor.remove_all_transitions();
            finishRestoreEffect(actor);
        }
    }
}