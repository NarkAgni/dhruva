import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { finishMinimizeEffect, finishRestoreEffect } from './WindowEffects.js';

class MagicLampBase extends Clutter.DeformEffect {
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
            h: actor.get_height(),
        };
        
        this._icon = {
            x: this._iconScreenPos.x - monitor.x, 
            y: this._iconScreenPos.y - monitor.y,
            w: this._iconScreenPos.w, 
            h: this._iconScreenPos.h,
        };

        this._buildTarget();
        this.set_n_tiles(42, 42);

        this._timeline = new Clutter.Timeline({ actor, duration: 480 });
        
        this._frameId = this._timeline.connect('new-frame', (tl) => {
            if (!this.get_actor()) { 
                this._finish(); 
                return; 
            }
            this._setProgress(tl.get_progress());
            actor.get_parent()?.queue_redraw();
            this.invalidate();
        });
        
        this._doneId = this._timeline.connect('completed', () => this._finish());
        this._destroyId = actor.connect('destroy', () => this._finish());
        
        this._timeline.start();
    }

    _buildTarget() {
        const tailPx = 8;
        const cx = this._icon.x + this._icon.w / 2;
        const cy = this._icon.y + this._icon.h / 2;
        const insetX = this._icon.w * 0.4;
        const insetY = this._icon.h * 0.4;

        if (this._dockPos === 'BOTTOM') {
            this._icon.x = cx - tailPx / 2;
            this._icon.y = this._icon.y + insetY;
            this._icon.w = tailPx;
            this._icon.h = 0;
        } else if (this._dockPos === 'TOP') {
            this._icon.x = cx - tailPx / 2;
            this._icon.y = this._icon.y + this._icon.h - insetY;
            this._icon.w = tailPx;
            this._icon.h = 0;
        } else if (this._dockPos === 'LEFT') {
            this._icon.x = this._icon.x + this._icon.w - insetX;
            this._icon.y = cy - tailPx / 2;
            this._icon.w = 0;
            this._icon.h = tailPx;
        } else {
            this._icon.x = this._icon.x + insetX;
            this._icon.y = cy - tailPx / 2;
            this._icon.w = 0;
            this._icon.h = tailPx;
        }
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
    
    _setProgress(p) { 
        this.progress = p; 
    }
    
    _onDone(_actor) {}

    vfunc_deform_vertex(w, h, v) {
        if (!this._ready || this.progress <= 0) return;

        const p = this.progress;
        const wW = this._win.w;
        const wH = this._win.h;
        const icX = this._icon.x + this._icon.w / 2 - this._win.x;
        const icY = this._icon.y + this._icon.h / 2 - this._win.y;
        const curX = v.tx * wW;
        const curY = v.ty * wH;

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

        const sweep = 0.7;
        const localP = Math.max(0, Math.min(1, (p - distFromDock * sweep) / (1 - sweep)));
        const eased = localP * localP * (3 - 2 * localP);

        let newX = curX + (icX - curX) * eased;
        let newY = curY + (icY - curY) * eased;

        const ripple = Math.sin(eased * Math.PI) * (1 - eased) * 0.20;
        
        if (this._dockPos === 'BOTTOM' || this._dockPos === 'TOP') {
            newX += (curX - icX) * ripple;
        } else {
            newY += (curY - icY) * ripple;
        }

        v.x = newX;
        v.y = newY;
    }

    vfunc_modify_paint_volume(_pv) { 
        return false; 
    }
}

export class MagicLampMinimize extends MagicLampBase {
    static { GObject.registerClass(this); }
    
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

export class MagicLampRestore extends MagicLampBase {
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