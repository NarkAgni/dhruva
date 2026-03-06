import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { finishMinimizeEffect, finishRestoreEffect } from './WindowEffects.js';

const TARGET_OFFSET = 0.20;

class JellyBase extends Clutter.DeformEffect {
    static { GObject.registerClass(this); }

    _init(iconScreenPos, dockPos) {
        super._init();
        this._iconScreenPos = { ...iconScreenPos };
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
        this.set_n_tiles(24, 24);

        this._timeline = new Clutter.Timeline({ actor, duration: 700 });
        
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
            if (this._doneId)  this._timeline.disconnect(this._doneId);
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

        this._tgt = { x: tgtX, y: tgtY };
    }

    _setProgress(p) { 
        this.progress = p; 
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;
        
        const p = this.progress;
        const wW = this._win.w, wH = this._win.h;
        const cx = wW / 2, cy = wH / 2;
        const vx = (v.tx * wW) - cx, vy = (v.ty * wH) - cy;

        const wobbleEnvelope = Math.sin(p * Math.PI);
        const freq = Math.PI * 8;
        const squashX = Math.sin(p * freq) * 0.25 * wobbleEnvelope;
        const squashY = Math.cos(p * freq) * 0.25 * wobbleEnvelope;
        const scale = 1.0 - Math.pow(p, 2);

        const rx = vx * scale * (1.0 + squashX);
        const ry = vy * scale * (1.0 + squashY);

        const bend = Math.sin(p * Math.PI) * 0.15;
        let dx = 0, dy = 0;

        if (this._dockPos === 'BOTTOM') {
            dy = -Math.sin(v.ty * Math.PI) * wH * bend;
        } else if (this._dockPos === 'TOP') {
            dy = Math.sin(v.ty * Math.PI) * wH * bend;
        } else if (this._dockPos === 'LEFT') {
            dx = Math.sin(v.tx * Math.PI) * wW * bend;
        } else if (this._dockPos === 'RIGHT') {
            dx = -Math.sin(v.tx * Math.PI) * wW * bend;
        }

        const moveP = p * p * (3 - 2 * p);
        const currentCenterX = cx + ((this._tgt.x - this._win.x) - cx) * moveP;
        const currentCenterY = cy + ((this._tgt.y - this._win.y) - cy) * moveP;

        v.x = currentCenterX + rx + dx;
        v.y = currentCenterY + ry + dy;
    }

    vfunc_modify_paint_volume() { 
        return false; 
    }
}

export class JellyMinimize extends JellyBase {
    static { GObject.registerClass(this); }
    
    _onDone(actor) { 
        if (actor) {
            actor.hide();
            actor.remove_all_transitions();
            finishMinimizeEffect(actor);
        }
    }
}

export class JellyRestore extends JellyBase {
    static { GObject.registerClass(this); }
    
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
            actor.remove_all_transitions();
            finishRestoreEffect(actor);
        }
    }
}