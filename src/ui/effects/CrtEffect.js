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


import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { finishMinimizeEffect, finishRestoreEffect } from './WindowEffects.js';


const TARGET_OFFSET = 0.20;

class CRTBase extends Clutter.DeformEffect {
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
            h: actor.get_height()
        };

        this._buildTarget();
        this.set_n_tiles(16, 16);

        this._timeline = new Clutter.Timeline({
            actor,
            duration: 450
        });

        this._frameId = this._timeline.connect('new-frame', (tl) => {
            const currentActor = this.get_actor();
            if (!currentActor) {
                this._finish();
                return;
            }
            this._setProgress(tl.get_progress());
            const parent = currentActor.get_parent();
            if (parent) parent.queue_redraw();
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

    _buildTarget() {
        let tgtX = this._iconScreenPos.x - this._monitor.x + this._iconScreenPos.w / 2;
        let tgtY = this._iconScreenPos.y - this._monitor.y + this._iconScreenPos.h / 2;

        if (this._dockPos === 'BOTTOM') {
            tgtY += this._iconScreenPos.h * TARGET_OFFSET;
        } else if (this._dockPos === 'TOP') {
            tgtY -= this._iconScreenPos.h * TARGET_OFFSET;
        } else if (this._dockPos === 'LEFT') {
            tgtX -= this._iconScreenPos.w * TARGET_OFFSET;
        } else if (this._dockPos === 'RIGHT') {
            tgtX += this._iconScreenPos.w * TARGET_OFFSET;
        }

        this._tgt = {
            x: tgtX,
            y: tgtY
        };
    }

    _setProgress(p) {
        this.progress = p;
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w,
            wH = this._win.h;
        const cx = wW / 2,
            cy = wH / 2;
        const vx = (v.tx * wW) - cx,
            vy = (v.ty * wH) - cy;

        let scaleX = 1.0,
            scaleY = 1.0,
            moveP = 0.0;

        if (p < 0.4) {
            const p1 = p / 0.4;
            scaleY = 1.0 - (p1 * p1);
            scaleX = 1.0 + (p1 * 0.05);
        } else {
            const p2 = (p - 0.4) / 0.6;
            scaleY = 0.0;
            scaleX = 1.05 * (1.0 - p2);
            moveP = p2 * p2;
        }

        const rx = vx * scaleX;
        const ry = vy * scaleY;
        const currentCenterX = cx + ((this._tgt.x - this._win.x) - cx) * moveP;
        const currentCenterY = cy + ((this._tgt.y - this._win.y) - cy) * moveP;

        v.x = currentCenterX + rx;
        v.y = currentCenterY + ry;
    }

    vfunc_modify_paint_volume() {
        return false;
    }
}

export class CRTMinimize extends CRTBase {
    static {
        GObject.registerClass(this);
    }

    _onDone(actor) {
        if (actor) {
            actor.hide();
            if (actor.remove_all_transitions) actor.remove_all_transitions();
            finishMinimizeEffect(actor);
        }
    }
}

export class CRTRestore extends CRTBase {
    static {
        GObject.registerClass(this);
    }

    _init(iconPos, dockPos) {
        super._init(iconPos, dockPos);
        this.progress = 1;
    }

    _setProgress(p) {
        this.progress = 1 - p;
    }

    _onDone(actor) {
        if (actor) {
            actor.show();
            if (actor.remove_all_transitions) actor.remove_all_transitions();
            finishRestoreEffect(actor);
        }
    }
}