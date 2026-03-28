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


import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const DRAG_THRESHOLD = 100;
const DOUBLE_CLICK_TIME = 300;

class DockPullEffect extends Clutter.DeformEffect {
    static { GObject.registerClass(this); }

    _init() {
        super._init();
        this.progress = 0;
        this.deltaX = 0;
        this.deltaY = 0;
        this.dockPos = 'BOTTOM';
    }

    vfunc_deform_vertex(w, h, v) {
        if (this.progress === 0) return;

        const p = this.progress;
        let distFromEdge = 0;
        if (this.dockPos === 'BOTTOM') distFromEdge = 1.0 - v.ty;
        else if (this.dockPos === 'TOP') distFromEdge = v.ty;
        else if (this.dockPos === 'LEFT') distFromEdge = v.tx;
        else if (this.dockPos === 'RIGHT') distFromEdge = 1.0 - v.tx;

        const t = distFromEdge;
        const smoothstep = t * t * (3.0 - 2.0 * t);
        const rubberCurve = smoothstep * smoothstep;
        const stretch = rubberCurve * p * 0.55;

        v.x += this.deltaX * stretch;
        v.y += this.deltaY * stretch;

        const belly = Math.sin(t * Math.PI) * Math.pow(p, 1.5);
        if (this.dockPos === 'BOTTOM' || this.dockPos === 'TOP') {
            const bulge = belly * 0.20 * w;
            if (v.tx < 0.5) v.x -= bulge; else v.x += bulge;
        } else {
            const bulge = belly * 0.20 * h;
            if (v.ty < 0.5) v.y -= bulge; else v.y += bulge;
        }

        const tipWeight = Math.pow(t, 3.0);
        const pinchAmount = tipWeight * p * p;
        if (this.dockPos === 'BOTTOM' || this.dockPos === 'TOP') {
            const pinch = pinchAmount * 0.22 * w;
            if (v.tx < 0.5) v.x += pinch; else v.x -= pinch;
        } else {
            const pinch = pinchAmount * 0.22 * h;
            if (v.ty < 0.5) v.y += pinch; else v.y -= pinch;
        }
    }

    vfunc_modify_paint_volume() { return false; }
}

export default class FloatingManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.actor = dockUI.actor;
        this.settings = dockUI.settings;

        this.isFloating = false;
        this.isDragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._initialActorX = 0;
        this._initialActorY = 0;
        this._lastClickTime = 0;

        this._handleStart = null;
        this._handleEnd = null;
        this._handlesVisible = false;
        this._previewMode = false;
        this._previewTimeout = null;
        this._dragShield = null;
        this._isSimpleClick = false;
        this._suppressLeave = false;

        this._enableSignal = this.settings.connect('changed::enable-floating-dock', () => {
            if (!this.settings.get_boolean('enable-floating-dock')) {
                if (this._handleStart) { this._handleStart.destroy(); this._handleStart = null; }
                if (this._handleEnd) { this._handleEnd.destroy(); this._handleEnd = null; }
                this._handlesVisible = false;
                
                if (this.isFloating) {
                    this._snapBack();
                }
            } else {
                if (this.dockUI?.queueRender) this.dockUI.queueRender();
            }
        });

        this._floatSignals = [];
        const floatSettings = [
            'floating-side-line-opacity', 'floating-d-length', 'floating-d-thickness',
            'floating-d-curve', 'floating-d-offset', 'floating-d-gap',
            'floating-dock-opacity', 'floating-dock-hover-full-opacity'
        ];

        floatSettings.forEach(key => {
            this._floatSignals.push(this.settings.connect(`changed::${key}`, () => {
                this._previewMode = true;
                
                if (this._previewTimeout) GLib.source_remove(this._previewTimeout);
                this._previewTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    this._previewMode = false;
                    this._previewTimeout = null;
                    this._refreshLiveHandles();
                    return GLib.SOURCE_REMOVE;
                });
                
                this._refreshLiveHandles();
            }));
        });

        this._origUpdatePosition = this.dockUI.dockManager.updatePosition;
        this.dockUI.dockManager.updatePosition = () => {
            if (this.isFloating) return;
            this._origUpdatePosition.call(this.dockUI.dockManager);
        };

        if (this.dockUI.autoHideManager) {
            this._patchAutoHideManager(this.dockUI.autoHideManager);
        }

        this._autoHidePatchPending = !this.dockUI.autoHideManager;

        const isAlive = actor => actor && !actor.is_destroyed?.();

        this._origRenderDock = this.dockUI._renderDock;
        this.dockUI._renderDock = () => {
            if (this._isSimpleClick || this.isDragging) return;

            if (this._handleStart && isAlive(this._handleStart)) {
                const p = this._handleStart.get_parent();
                if (p) p.remove_child(this._handleStart);
            } else {
                this._handleStart = null;
            }

            if (this._handleEnd && isAlive(this._handleEnd)) {
                const p = this._handleEnd.get_parent();
                if (p) p.remove_child(this._handleEnd);
            } else {
                this._handleEnd = null;
            }

            if (!this.dockUI || !this._origRenderDock) return;
            this._origRenderDock.call(this.dockUI);

            if (!this.settings.get_boolean('enable-floating-dock')) {
                this._handlesVisible = false;
                return;
            }

            if (!this.actor || !isAlive(this.actor)) return;

            this._ensureHandles();
            this._updateHandleStyles();

            const [px, py] = global.get_pointer();
            const [ax, ay] = this.actor.get_transformed_position();
            const [aw, ah] = this.actor.get_transformed_size();
            const isHovered = px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;

            if (isAlive(this.dockUI.boxActor)) {
                if (this._handleStart && !this._handleStart.get_parent())
                    this.dockUI.boxActor.insert_child_at_index(this._handleStart, 0);
                if (this._handleEnd && !this._handleEnd.get_parent())
                    this.dockUI.boxActor.add_child(this._handleEnd);
            }

            const dThick = this.settings.get_int('floating-d-thickness') || 36;
            const handleGap = this.settings.get_int('floating-d-gap') ?? 6;
            const activeSize = dThick + handleGap;

            const floatOpacityVal = this.settings.get_int('floating-dock-opacity') ?? 100;
            const floatOpacity = Math.max(35, floatOpacityVal);
            const hoverFullOpacity = this.settings.get_boolean('floating-dock-hover-full-opacity');

            if (this.settings.get_boolean('enable-floating-dock')) {
                this._animateFloatOpacity(isHovered);

                if (isAlive(this.dockUI.bgActor)) this.dockUI.bgActor.opacity = 255;
                if (isAlive(this.dockUI.boxActor)) this.dockUI.boxActor.opacity = 255;
            } else {
                if (isAlive(this.actor)) this.actor.opacity = 255;
                if (isAlive(this.dockUI.bgActor)) this.dockUI.bgActor.opacity = 255;
                if (isAlive(this.dockUI.boxActor)) this.dockUI.boxActor.opacity = 255;
            }

            if (isHovered || this._previewMode || this.isDragging) {
                this._handlesVisible = true;
                if (this._handleStart?._line) this._handleStart._line.opacity = 255;
                if (this._handleEnd?._line) this._handleEnd._line.opacity = 255;
                this._applyHandleSizes(activeSize);
            } else {
                this._handlesVisible = false;
                if (this._handleStart?._line) this._handleStart._line.opacity = 0;
                if (this._handleEnd?._line) this._handleEnd._line.opacity = 0;
                this._applyHandleSizes(0);
            }
        };

        this._initHandlers();
    }

    _patchAutoHideManager(ahm) {
        if (!ahm || this._origHide) return;
        this._origHide = ahm._hide;
        ahm._hide = (...args) => {
            if (this.isFloating) return;
            this._origHide.apply(ahm, args);
        };
        this._origShow = ahm._show;
        ahm._show = (...args) => {
            if (this.isFloating) return;
            this._origShow.apply(ahm, args);
        };
    }

    applyPendingPatch() {
        if (this._autoHidePatchPending && this.dockUI?.autoHideManager) {
            this._patchAutoHideManager(this.dockUI.autoHideManager);
            this._autoHidePatchPending = false;
        }
    }

    _applyHandleSizes(currentSize, isAnimated = true) {
        if (!this._handleStart || !this._handleEnd) return;

        try {
            this._handleStart.get_parent();
            this._handleEnd.get_parent();
        } catch(e) {
            this._handleStart = null;
            this._handleEnd = null;
            return;
        }

        const dockPos = this.settings.get_string('dock-position') || 'BOTTOM';
        const isVertical = dockPos === 'LEFT' || dockPos === 'RIGHT';

        let dLen = this.settings.get_int('floating-d-length') || 42;
        const dThick = this.settings.get_int('floating-d-thickness') || 36;

        if (this.dockUI && this.dockUI.bgActor) {
            try {
                const [bgW, bgH] = this.dockUI.bgActor.get_size();
                const crossSize = isVertical ? bgW : bgH;
                if (crossSize > 10) {
                    dLen = Math.min(dLen, crossSize - 4);
                }
            } catch (e) {}
        }

        const targetW = isVertical ? dLen : currentSize;
        const targetH = isVertical ? currentSize : dLen;
        
        const duration = isAnimated ? 200 : 0;
        const mode = Clutter.AnimationMode.EASE_OUT_QUAD;

        try {
            this._handleStart.ease({ width: targetW, height: targetH, duration, mode });
            this._handleEnd.ease({ width: targetW, height: targetH, duration, mode });

            if (this._handleStart._line) this._handleStart._line.set_size(isVertical ? dLen : dThick, isVertical ? dThick : dLen);
            if (this._handleEnd._line) this._handleEnd._line.set_size(isVertical ? dLen : dThick, isVertical ? dThick : dLen);
        } catch (e) {
        }
    }

    _updateHandleStyles() {
        if (!this._handleStart || !this._handleEnd) return;

        const dockPos = this.settings.get_string('dock-position') || 'BOTTOM';
        const isVertical = dockPos === 'LEFT' || dockPos === 'RIGHT';

        const opcVal = this.settings.get_int('floating-side-line-opacity') ?? 35;
        const bgStr = `rgba(255,255,255,${opcVal / 100.0})`;
        const dRad = this.settings.get_int('floating-d-curve') ?? 24;
        const dOffset = this.settings.get_int('floating-d-offset') || 0;

        const styleStart = isVertical
            ? `background-color: ${bgStr}; border-radius: ${dRad}px ${dRad}px 0px 0px;`
            : `background-color: ${bgStr}; border-radius: ${dRad}px 0px 0px ${dRad}px;`;

        const styleEnd = isVertical
            ? `background-color: ${bgStr}; border-radius: 0px 0px ${dRad}px ${dRad}px;`
            : `background-color: ${bgStr}; border-radius: 0px ${dRad}px ${dRad}px 0px;`;

        if (this._handleStart._line) {
            this._handleStart._line.set_style(styleStart);
            this._handleStart._line.translation_x = isVertical ? 0 : -dOffset;
            this._handleStart._line.translation_y = isVertical ? -dOffset : 0;
            this._handleStart.set_x_align(isVertical ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END);
            this._handleStart.set_y_align(isVertical ? Clutter.ActorAlign.END : Clutter.ActorAlign.CENTER);
        }

        if (this._handleEnd._line) {
            this._handleEnd._line.set_style(styleEnd);
            this._handleEnd._line.translation_x = isVertical ? 0 : dOffset;
            this._handleEnd._line.translation_y = isVertical ? dOffset : 0;
            this._handleEnd.set_x_align(isVertical ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START);
            this._handleEnd.set_y_align(isVertical ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER);
        }
    }

    _refreshLiveHandles() {
        if (!this.settings.get_boolean('enable-floating-dock') || !this.actor || this.actor.is_destroyed?.()) return;

        this._ensureHandles();
        this._updateHandleStyles();

        const [px, py] = global.get_pointer();
        const [ax, ay] = this.actor.get_transformed_position();
        const [aw, ah] = this.actor.get_transformed_size();
        const isHovered = px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;

        const dThick = this.settings.get_int('floating-d-thickness') || 36;
        const handleGap = this.settings.get_int('floating-d-gap') ?? 6;
        const activeSize = dThick + handleGap;

        if (isHovered || this._previewMode || this.isDragging) {
            this._handlesVisible = true;
            if (this._handleStart?._line) this._handleStart._line.opacity = 255;
            if (this._handleEnd?._line) this._handleEnd._line.opacity = 255;
            this._applyHandleSizes(activeSize);
        } else {
            this._handlesVisible = false;
            if (this._handleStart?._line) this._handleStart._line.opacity = 0;
            if (this._handleEnd?._line) this._handleEnd._line.opacity = 0;
            this._applyHandleSizes(0);
        }

        this._animateFloatOpacity(isHovered);

        if (this.dockUI && typeof this.dockUI._updateLayout === 'function') {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (!this.actor?.is_destroyed?.() && !this.dockUI._isDestroyed) {
                    this.dockUI._updateLayout();
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _animateFloatOpacity(isHovered) {
        if (!this.settings.get_boolean('enable-floating-dock')) return;
        const isAlive = actor => actor && !actor.is_destroyed?.();

        let floatOpacity = this.settings.get_int('floating-dock-opacity') ?? 100;
        floatOpacity = Math.max(10, floatOpacity);

        const hoverFullOpacity = this.settings.get_boolean('floating-dock-hover-full-opacity');
        
        const forceSliderValue = this._previewMode;
        const applyHoverFull = isHovered && hoverFullOpacity && !forceSliderValue;
        
        const targetOpacity = applyHoverFull ? 255 : Math.round((floatOpacity / 100.0) * 255);
        const duration = applyHoverFull ? 100 : 300;

        if (this.actor && isAlive(this.actor)) {
            this.actor.remove_transition('opacity');
            this.actor.ease({ opacity: targetOpacity, duration: duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    }

    _ensureHandles() {
        if (!this.dockUI?.boxActor) return;

        const isAlive = (handle) => {
            if (!handle) return false;
            try {
                handle.get_parent();
                return true;
            } catch (e) {
                return false;
            }
        };

        if (!isAlive(this._handleStart)) this._handleStart = null;
        if (!isAlive(this._handleEnd)) this._handleEnd = null;

        if (this._handleStart && this._handleEnd) return;

        const createHandle = () => {
            const handle = new St.Bin({
                style_class: 'dock-drag-handle dock-separator',
                opacity: 255,
                reactive: true,
                clip_to_allocation: false
            });

            const sep = new St.Widget({ opacity: 0 });
            handle.set_child(sep);
            handle._line = sep;
            handle.connect('button-press-event', this._onHandlePress.bind(this));
            return handle;
        };

        if (!this._handleStart) this._handleStart = createHandle();
        if (!this._handleEnd) this._handleEnd = createHandle();
    }

    _onHandlePress(actor, event) {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        if (!this.settings.get_boolean('enable-floating-dock') || this.settings.get_boolean('full-width'))
            return Clutter.EVENT_PROPAGATE;


        const now = Date.now();
        if (now - this._lastClickTime < DOUBLE_CLICK_TIME && this.isFloating) {
            this._snapBack();
            return Clutter.EVENT_STOP;
        }
        this._lastClickTime = now;
        this._startDrag(event);
        return Clutter.EVENT_STOP;
    }

    _animateHandles(show) {
        if (!this.settings.get_boolean('enable-floating-dock') || this.settings.get_boolean('full-width')) show = false;
        if (this.dockUI?._activeContextMenu) show = false;

        if (this._handlesVisible === show) return;
        this._handlesVisible = show;

        if (show) this._ensureHandles();
        if (!this._handleStart || !this._handleEnd) return;

        const targetOpacity = show ? 255 : 0;

        const dThick = this.settings.get_int('floating-d-thickness') || 36;
        const handleGap = this.settings.get_int('floating-d-gap') ?? 6;
        const activeSize = dThick + handleGap;

        this._applyHandleSizes(show ? activeSize : 0, true);

        try {
            if (this._handleStart._line) {
                this._handleStart._line.remove_transition('opacity');
                this._handleStart._line.ease({ opacity: targetOpacity, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            }
            if (this._handleEnd._line) {
                this._handleEnd._line.remove_transition('opacity');
                this._handleEnd._line.ease({ opacity: targetOpacity, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            }
        } catch (e) {
        }
    }

    _startHoverTracker() {
        if (this._hoverTrackerId) return;
        this._hoverTrackerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this.actor || this.actor.is_destroyed?.() || !this.settings.get_boolean('enable-floating-dock')) {
                this._hoverTrackerId = null;
                return GLib.SOURCE_REMOVE;
            }

            if (this.isDragging || this._isSimpleClick || this._suppressLeave) {
                return GLib.SOURCE_CONTINUE;
            }

            const [px, py] = global.get_pointer();
            const [ax, ay] = this.actor.get_transformed_position();
            const [aw, ah] = this.actor.get_transformed_size();

            const pad = 30; 
            const isHovered = px >= ax - pad && px <= ax + aw + pad && py >= ay - pad && py <= ay + ah + pad;

            if (isHovered !== this._wasHovered) {
                this._wasHovered = isHovered;
                if (!this._previewMode) {
                    this._animateHandles(isHovered);
                    this._animateFloatOpacity(isHovered);
                }
            }

            if (!isHovered && !this._previewMode) {
                this._hoverTrackerId = null;
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    _initHandlers() {
        if (!this.actor) return;
        this.actor.reactive = true;

        this._motionIdHover = this.actor.connect('motion-event', () => {
            if (!this.isDragging) this._startHoverTracker();
            return Clutter.EVENT_PROPAGATE;
        });

        this._leaveId = this.actor.connect('leave-event', () => {
            this._startHoverTracker();
            return Clutter.EVENT_PROPAGATE;
        });

        this._globalPressId = global.stage.connect('button-press-event', () => {
            if (!this._handlesVisible) return Clutter.EVENT_PROPAGATE;
            this._suppressLeave = true;
            if (this._suppressLeaveTimeout) GLib.source_remove(this._suppressLeaveTimeout);
            this._suppressLeaveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                this._suppressLeaveTimeout = null;
                this._suppressLeave = false;
                this._checkHoverAfterDrop();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_PROPAGATE;
        });

        this._pressId = this.actor.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            if (!this.settings.get_boolean('enable-floating-dock') || this.settings.get_boolean('full-width'))
                return Clutter.EVENT_PROPAGATE;

            this.actor._lastIconClickTime = Date.now();

            let curr = event.get_source();
            while (curr && curr !== this.actor) {
                if (curr.has_style_class_name?.('dock-app-button') || curr.has_style_class_name?.('clock-module'))
                    return Clutter.EVENT_PROPAGATE;
                curr = curr.get_parent();
            }

            const [px, py] = event.get_coords();
            const dockPos = this.settings.get_string('dock-position') || 'BOTTOM';
            const isVertical = dockPos === 'LEFT' || dockPos === 'RIGHT';
            let isDragZone = false;

            if (this.dockUI?.boxActor) {
                const items = this.dockUI.boxActor.get_children().filter(c =>
                    c.has_style_class_name?.('dock-app-button') || c.has_style_class_name?.('clock-module')
                );
                if (items.length > 0) {
                    const [fx, fy] = items[0].get_transformed_position();
                    const last = items[items.length - 1];
                    const [lx, ly] = last.get_transformed_position();
                    const [lw, lh] = last.get_transformed_size();
                    isDragZone = isVertical ? (py < fy || py > ly + lh) : (px < fx || px > lx + lw);
                } else {
                    isDragZone = true;
                }
            }

            if (!isDragZone) return Clutter.EVENT_PROPAGATE;

            const now = Date.now();
            if (now - this._lastClickTime < DOUBLE_CLICK_TIME && this.isFloating) {
                this._snapBack();
                return Clutter.EVENT_STOP;
            }
            this._lastClickTime = now;
            this._startDrag(event);
            return Clutter.EVENT_STOP;
        });
    }

    _startDrag(event) {
        const [px, py] = event.get_coords();
        const dockPos = this.settings.get_string('dock-position') || 'BOTTOM';

        this._dragStartX = px;
        this._dragStartY = py;
        this._initialActorX = this.actor.x;
        this._initialActorY = this.actor.y;

        this.isDragging = true;
        if (this.actor) this.actor._isDragging = true;

        this._createDragShield();

        if (!this.isFloating) {
            this._resetDockState();
            this._pullEffect = new DockPullEffect();
            this._pullEffect.dockPos = dockPos;
            this._pullEffect.set_n_tiles(48, 48);
            this.actor.add_effect(this._pullEffect);
        }

        if (!this._motionId) this._motionId = global.stage.connect('motion-event', this._onMotion.bind(this));
        if (!this._releaseId) this._releaseId = global.stage.connect('button-release-event', this._onRelease.bind(this));
    }

    _onMotion(stage, event) {
        if (!this.isDragging || !this.actor) return Clutter.EVENT_PROPAGATE;

        const [px, py] = event.get_coords();
        const deltaX = px - this._dragStartX;
        const deltaY = py - this._dragStartY;

        if (!this.isFloating) {
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distance > DRAG_THRESHOLD) {
                this.isFloating = true;
                if (this.dockUI) this.dockUI._isFloating = true;
                if (this.actor) this.actor._wasRealDrag = true;

                if (this._pullEffect) {
                    this.actor.remove_effect(this._pullEffect);
                    this._pullEffect = null;
                }

                this.actor.set_position(this._initialActorX + deltaX, this._initialActorY + deltaY);
                this.actor.set_scale(0.85, 0.85);
                this.actor.ease({ scale_x: 1.0, scale_y: 1.0, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC });

                if (this.dockUI?.autoHideManager) {
                    this.dockUI.autoHideManager.isHidden = false;
                    this.dockUI.autoHideManager._cancelTimers();
                    this.dockUI.autoHideManager._show(true);
                }
            } else if (this._pullEffect) {
                this._pullEffect.progress = distance / DRAG_THRESHOLD;
                this._pullEffect.deltaX = deltaX;
                this._pullEffect.deltaY = deltaY;
                this._pullEffect.invalidate();
            }
        }

        if (this.isFloating)
            this.actor.set_position(this._initialActorX + deltaX, this._initialActorY + deltaY);

        return Clutter.EVENT_STOP;
    }

    _onRelease(stage, event) {
        if (!this.isDragging) return Clutter.EVENT_PROPAGATE;
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

        this._removeDragShield();

        if (this._motionId) { global.stage.disconnect(this._motionId); this._motionId = null; }
        if (this._releaseId) { global.stage.disconnect(this._releaseId); this._releaseId = null; }

        const [px, py] = event.get_coords();
        const deltaX = px - this._dragStartX;
        const deltaY = py - this._dragStartY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (this.actor) { this.actor._wasRealDrag = false; }

        if (!this.isFloating && distance <= 10) {
            this.isDragging = false;
            if (this.actor) { this.actor._isDragging = false; }

            this._isSimpleClick = true;
            if (this._simpleClickGuardId) GLib.source_remove(this._simpleClickGuardId);
            this._simpleClickGuardId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._simpleClickGuardId = null;
                this._isSimpleClick = false;
                return GLib.SOURCE_REMOVE;
            });

            if (this._pullEffect) {
                this.actor.remove_effect(this._pullEffect);
                this._pullEffect = null;
            }
            return Clutter.EVENT_STOP;
        }

        if (!this.isFloating) {
            if (this._pullEffect) {
                const startProgress = this._pullEffect.progress;
                if (this.dockUI) this.dockUI._dropSettling = true;
                this._isSimpleClick = true;

                this._snapTimeline = new Clutter.Timeline({ duration: 350 });
                this._snapTimeline.connect('new-frame', (tl) => {
                    if (!this._pullEffect || !this.actor) { tl.stop(); return; }
                    const t = tl.get_progress();
                    const easeT = 1 - Math.pow(1 - t, 3);
                    this._pullEffect.progress = startProgress * (1 - easeT);
                    this._pullEffect.invalidate();
                    this.actor.scale_x = 1.0;
                    this.actor.scale_y = 1.0;
                    this.actor.translation_x = 0;
                    this.actor.translation_y = 0;
                    this.actor.queue_redraw();
                });
                this._snapTimeline.connect('completed', () => {
                    this._snapTimeline = null;
                    this.isDragging = false;
                    if (this.actor) this.actor._isDragging = false;
                    this._resetDockState();
                    this._isSimpleClick = false;
                    this._checkHoverAfterDrop();
                    if (this.dockUI) this.dockUI._dropSettling = false;
                });
                this._snapTimeline.start();
            } else {
                this.isDragging = false;
                if (this.actor) this.actor._isDragging = false;
                this._resetDockState();
            }
            return Clutter.EVENT_STOP;
        }

        this.isDragging = false;
        if (this.actor) { this.actor._isDragging = false; }
        
        return Clutter.EVENT_STOP;
    }

    _createDragShield() {
        if (this._dragShield) return;
        this._dragShield = new Clutter.Actor({ reactive: true, width: 30000, height: 30000, x: -10000, y: -10000, opacity: 0 });
        Main.uiGroup.add_child(this._dragShield);
        Main.uiGroup.set_child_above_sibling(this._dragShield, null);
    }

    _removeDragShield() {
        if (this._dragShield) { this._dragShield.destroy(); this._dragShield = null; }
    }

    _checkHoverAfterDrop() {
        if (this.isDragging || this._isSimpleClick || !this.actor || this.actor.is_destroyed?.()) return;

        const [px, py] = global.get_pointer();
        const [ax, ay] = this.actor.get_transformed_position();
        const [aw, ah] = this.actor.get_transformed_size();

        if (px < ax || px > ax + aw || py < ay || py > ay + ah)
            this._animateHandles(false);
    }

    _resetDockState() {
        if (this._snapTimeline) { this._snapTimeline.stop(); this._snapTimeline = null; }
        if (this._pullEffect && this.actor && !this.actor.is_destroyed?.())
            this.actor.remove_effect(this._pullEffect);
        this._pullEffect = null;

        if (this.actor && !this.actor.is_destroyed?.() && !this.isFloating) {
            this.actor.remove_transition('scale_x');
            this.actor.remove_transition('scale_y');
            this.actor.remove_transition('translation_x');
            this.actor.remove_transition('translation_y');
        }
    }

    _snapBack() {
        this.isFloating = false;
        if (this.dockUI) this.dockUI._isFloating = false;

        if (this.dockUI?.autoHideManager)
            this.dockUI.autoHideManager._scheduleUpdate();

        if (this.dockUI?.dockManager && this.actor && !this.actor.is_destroyed?.()) {
            const currentX = this.actor.x;
            const currentY = this.actor.y;

            this.dockUI.dockManager.updatePosition();

            const targetX = this.actor.x;
            const targetY = this.actor.y;

            this.actor.set_position(currentX, currentY);
            this.actor.ease({ x: targetX, y: targetY, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUINT });
        }
    }

    destroy() {
        this._removeDragShield();

        const ahm = this.dockUI?.autoHideManager;
        if (this._origHide && ahm) {
            ahm._hide = this._origHide;
        }
        this._origHide = null;

        if (this._origShow && ahm) {
            ahm._show = this._origShow;
        }
        this._origShow = null;

        if (this._enableSignal) { this.settings.disconnect(this._enableSignal); this._enableSignal = null; }
        if (this._previewTimeout) { GLib.source_remove(this._previewTimeout); this._previewTimeout = null; }
        
        if (this._hoverTrackerId) { GLib.source_remove(this._hoverTrackerId); this._hoverTrackerId = null; }
        
        if (this._suppressLeaveTimeout) { GLib.source_remove(this._suppressLeaveTimeout); this._suppressLeaveTimeout = null; }
        if (this._simpleClickGuardId) { GLib.source_remove(this._simpleClickGuardId); this._simpleClickGuardId = null; }
        if (this._dropSettleTimeout) { GLib.source_remove(this._dropSettleTimeout); this._dropSettleTimeout = null; }

        this._isSimpleClick = false;
        this._suppressLeave = false;

        if (this._floatSignals) {
            this._floatSignals.forEach(id => this.settings.disconnect(id));
            this._floatSignals = [];
        }

        if (this._origRenderDock && this.dockUI) {
            this.dockUI._renderDock = this._origRenderDock;
            this._origRenderDock = null;
        }

        if (this._origUpdatePosition && this.dockUI?.dockManager) {
            this.dockUI.dockManager.updatePosition = this._origUpdatePosition;
            this._origUpdatePosition = null;
        }

        if (this._globalPressId) { global.stage.disconnect(this._globalPressId); this._globalPressId = null; }

        const isAlive = act => act && !act.is_destroyed?.();

        if (this._motionIdHover && isAlive(this.actor)) { this.actor.disconnect(this._motionIdHover); this._motionIdHover = null; }
        if (this._leaveId && isAlive(this.actor)) { this.actor.disconnect(this._leaveId); this._leaveId = null; }
        if (this._pressId && isAlive(this.actor)) { this.actor.disconnect(this._pressId); this._pressId = null; }
        if (this._motionId) { global.stage.disconnect(this._motionId); this._motionId = null; }
        if (this._releaseId) { global.stage.disconnect(this._releaseId); this._releaseId = null; }

        this._resetDockState();

        if (this._handleStart) { this._handleStart.destroy(); this._handleStart = null; }
        if (this._handleEnd) { this._handleEnd.destroy(); this._handleEnd = null; }

        this.dockUI = null;
        this.actor = null;
        this.settings = null;
    }
}