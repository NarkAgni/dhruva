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


const DEFAULT_TARGET_OFFSET = 0.20;

export class BaseDeformEffect extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }

    _init(iconScreenPos, dockPos, isRestore = false) {
        super._init();
        this._iconScreenPos = { ...iconScreenPos };
        this._dockPos = dockPos || 'BOTTOM';
        this._isRestore = isRestore;
        this.progress = isRestore ? 1 : 0;
        this._ready = false;
        this._finished = false;
    }

    _getDuration() {
        return 500;
    }

    _getTiles() {
        return [24, 24];
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

        this._icon = {
            x: this._iconScreenPos.x - monitor.x,
            y: this._iconScreenPos.y - monitor.y,
            w: this._iconScreenPos.w,
            h: this._iconScreenPos.h
        };

        this._buildTarget();

        const [tilesX, tilesY] = this._getTiles();
        this.set_n_tiles(tilesX, tilesY);

        this._timeline = new Clutter.Timeline({
            actor,
            duration: this._getDuration()
        });

        this._timeline.connectObject(
            'new-frame', (tl) => {
                const currentActor = this.get_actor();
                if (!currentActor) {
                    this._finish();
                    return;
                }
                this._setProgress(tl.get_progress());
                const parent = currentActor.get_parent();
                if (parent) parent.queue_redraw();
                this.invalidate();
            },
            'completed', () => this._finish(),
            this
        );

        this._timeline.start();
        actor.connectObject('destroy', () => this._finish(), this);
    }

    _buildTarget() {
        let tgtX = this._iconScreenPos.x - this._monitor.x + this._iconScreenPos.w / 2;
        let tgtY = this._iconScreenPos.y - this._monitor.y + this._iconScreenPos.h / 2;

        if (this._dockPos === 'BOTTOM') {
            tgtY += this._iconScreenPos.h * DEFAULT_TARGET_OFFSET;
        } else if (this._dockPos === 'TOP') {
            tgtY -= this._iconScreenPos.h * DEFAULT_TARGET_OFFSET;
        } else if (this._dockPos === 'LEFT') {
            tgtX -= this._iconScreenPos.w * DEFAULT_TARGET_OFFSET;
        } else if (this._dockPos === 'RIGHT') {
            tgtX += this._iconScreenPos.w * DEFAULT_TARGET_OFFSET;
        }

        this._tgt = { x: tgtX, y: tgtY };
    }

    _setProgress(p) {
        this.progress = this._isRestore ? (1 - p) : p;
    }

    _finish() {
        if (this._finished) return;
        this._finished = true;

        if (this._timeline) {
            this._timeline.stop();
            this._timeline.disconnectObject(this);
            this._timeline = null;
        }

        const actor = this.get_actor();
        if (actor) {
            actor.disconnectObject(this);
            actor.remove_effect(this);
            this._onDone(actor);
        }
    }

    destroy() {
        this._finish();
    }

    _onDone(actor) {
        if (!actor) return;
        if (this._isRestore) {
            actor.show();
            if (actor.remove_all_transitions) actor.remove_all_transitions();
            finishRestoreEffect(actor);
        } else {
            actor.hide();
            if (actor.remove_all_transitions) actor.remove_all_transitions();
            finishMinimizeEffect(actor);
        }
    }

    vfunc_modify_paint_volume() {
        return false;
    }
}