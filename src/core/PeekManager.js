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
import Clutter from 'gi://Clutter';


export default class PeekManager {
    constructor(dockUI, overlayActor) {
        this.dockUI = dockUI;
        this.settings = dockUI.settings;
        this._peekTimer = null;
        this._isPeeking = false;
        this._currentTarget = null;
        this._hideTimer = null;
        this._pendingWrapBin = null;

        this.bigPreviewContainer = new St.Bin({
            reactive: false,
            opacity: 0,
            style_class: 'context-menu-big-preview-container'
        });

        overlayActor.add_child(this.bigPreviewContainer);

        if (this.dockUI && this.dockUI.actor) {
            try {
                const sibling = this.dockUI.actor;
                const dockParent = sibling.get_parent();
                if (dockParent && dockParent === overlayActor) {
                    overlayActor.set_child_below_sibling(this.bigPreviewContainer, sibling);
                } else {
                    overlayActor.set_child_at_index(this.bigPreviewContainer, 0);
                }
            } catch (_e) {
                try {
                    overlayActor.set_child_at_index(this.bigPreviewContainer, 0);
                } catch (__e) {}
            }
        }
    }

    startPeek(targetWin) {
        if (!targetWin) return;

        if (this._hideTimer) {
            GLib.source_remove(this._hideTimer);
            this._hideTimer = null;
        }

        if (this._currentTarget === targetWin) {
            if (this.bigPreviewContainer.opacity < 255) {
                this.bigPreviewContainer.remove_all_transitions();
                this.bigPreviewContainer.ease({
                    opacity: 255,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            }
            return;
        }

        this._currentTarget = targetWin;
        this._swapPreview(targetWin);

        let peekEnabled = true;
        try {
            peekEnabled = this.settings.get_boolean('peek-effect');
        } catch (e) {}
        if (!peekEnabled) return;

        if (this._peekTimer) {
            GLib.source_remove(this._peekTimer);
            this._peekTimer = null;
        }

        if (this._isPeeking) return;

        this._peekTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            this._peekTimer = null;
            this._isPeeking = true;
            this._ghostWindows(28, this._getPeekSpeed() * 0.52, Clutter.AnimationMode.EASE_IN_OUT_SINE);
            return GLib.SOURCE_REMOVE;
        });
    }

    stopPeek() {
        if (this._hideTimer) GLib.source_remove(this._hideTimer);

        this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._hideTimer = null;
            this._currentTarget = null;
            this._hideBigPreview();

            if (this._peekTimer) {
                GLib.source_remove(this._peekTimer);
                this._peekTimer = null;
            }

            if (this._isPeeking) {
                this._isPeeking = false;
                this._ghostWindows(255, this._getPeekSpeed() * 0.38, Clutter.AnimationMode.EASE_OUT_SINE);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _getPeekSpeed() {
        try {
            return this.settings.get_int('peek-animation-speed') || 1000;
        } catch {
            return 1000;
        }
    }

    _ghostWindows(targetOpacity, duration, mode) {
        global.get_window_actors().forEach(wa => {
            if (!wa.get_meta_window()) return;
            wa.ease({
                opacity: targetOpacity,
                duration,
                mode
            });
        });
    }

    _swapPreview(win) {
        const compPrivate = win.get_compositor_private();
        if (!compPrivate) return;

        const {
            monitor
        } = this.dockUI.monitorManager.getCurrentMonitor();
        const rect = win.get_frame_rect();
        const w = Math.max(1, rect.width || 1);
        const h = Math.max(1, rect.height || 1);

        let scalePercent = 70;
        try {
            scalePercent = this.settings.get_int('big-preview-size');
        } catch (e) {}

        const maxW = monitor.width * (scalePercent / 100);
        const maxH = monitor.height * (scalePercent / 100);

        let previewW = w,
            previewH = h;
        if (previewW > maxW) {
            previewW = maxW;
            previewH = (h / w) * previewW;
        }
        if (previewH > maxH) {
            previewH = maxH;
            previewW = (w / h) * previewH;
        }

        const clone = new Clutter.Clone({
            source: compPrivate,
            reactive: false
        });
        clone.set_size(previewW, previewH);

        const wrapBin = new St.Bin({
            child: clone,
            style: 'border-radius: 14px; overflow: hidden; box-shadow: none;'
        });

        if (this._pendingWrapBin) {
            this._pendingWrapBin.destroy();
        }
        this._pendingWrapBin = wrapBin;

        const targetX = monitor.x + (monitor.width / 2) - (previewW / 2);
        const targetY = monitor.y + (monitor.height / 2) - (previewH / 2);

        const alreadyVisible = this.bigPreviewContainer.opacity > 50;

        this.bigPreviewContainer.remove_all_transitions();

        if (alreadyVisible) {
            this.bigPreviewContainer.ease({
                opacity: 0,
                scale_x: 0.97,
                scale_y: 0.97,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this._currentTarget || this._pendingWrapBin !== wrapBin) {
                        wrapBin.destroy();
                        return;
                    }

                    this._pendingWrapBin = null;
                    this.bigPreviewContainer.destroy_all_children();
                    this.bigPreviewContainer.add_child(wrapBin);
                    this.bigPreviewContainer.set_size(previewW, previewH);
                    this.bigPreviewContainer.set_pivot_point(0.5, 0.5);
                    this.bigPreviewContainer.set_position(targetX, targetY + 10);
                    this.bigPreviewContainer.set_scale(0.96, 0.96);

                    this.bigPreviewContainer.ease({
                        opacity: 255,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        y: targetY,
                        duration: this._getPeekSpeed(),
                        mode: Clutter.AnimationMode.EASE_OUT_QUINT
                    });
                }
            });
        } else {
            this._pendingWrapBin = null;
            this.bigPreviewContainer.destroy_all_children();
            this.bigPreviewContainer.add_child(wrapBin);
            this.bigPreviewContainer.set_size(previewW, previewH);
            this.bigPreviewContainer.set_pivot_point(0.5, 0.5);
            this.bigPreviewContainer.set_position(targetX, targetY + 22);
            this.bigPreviewContainer.set_scale(0.94, 0.94);
            this.bigPreviewContainer.opacity = 0;

            this.bigPreviewContainer.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                y: targetY,
                duration: this._getPeekSpeed(),
                mode: Clutter.AnimationMode.EASE_OUT_QUINT
            });
        }
    }

    _hideBigPreview() {
        if (!this.bigPreviewContainer) return;
        this.bigPreviewContainer.remove_all_transitions();
        this.bigPreviewContainer.ease({
            opacity: 0,
            scale_x: 0.96,
            scale_y: 0.96,
            duration: this._getPeekSpeed() * 0.38,
            mode: Clutter.AnimationMode.EASE_IN_QUINT
        });
    }

    destroy() {
        if (this._hideTimer) {
            GLib.source_remove(this._hideTimer);
            this._hideTimer = null;
        }
        if (this._peekTimer) {
            GLib.source_remove(this._peekTimer);
            this._peekTimer = null;
        }

        if (this._isPeeking) {
            this._ghostWindows(255, 200, Clutter.AnimationMode.EASE_OUT_QUAD);
        }

        if (this._pendingWrapBin) {
            this._pendingWrapBin.destroy();
            this._pendingWrapBin = null;
        }

        if (this.bigPreviewContainer) {
            this.bigPreviewContainer.remove_all_transitions();
            this.bigPreviewContainer.destroy();
            this.bigPreviewContainer = null;
        }
    }
}