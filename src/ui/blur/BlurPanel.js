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
import Gio from 'gi://Gio';
import Mtk from 'gi://Mtk';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { BlurEffect } from './BlurEffect.js';
import { Settings } from '../../core/SettingsManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { isActorAlive, markActorDisposed } from '../../core/Utils.js';


const DRAG_TICK_MS = 16;
const LIVE_TICK_MS = 25;

const TRANSFORM_SIGNALS = [
    'notify::scale-x', 'notify::scale-y',
    'notify::translation-x', 'notify::translation-y',
];

export function hexToRgb(str) {
    if (!str) return [1.0, 1.0, 1.0];
    let clean = str.trim();
    if (clean.startsWith('#')) clean = clean.slice(1);
    if (clean.length === 3) {
        clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (clean.length >= 6) {
        const num = parseInt(clean.slice(0, 6), 16);
        if (!Number.isNaN(num)) {
            return [
                ((num >> 16) & 255) / 255.0,
                ((num >> 8) & 255) / 255.0,
                (num & 255) / 255.0,
            ];
        }
    }
    return [1.0, 1.0, 1.0];
}

export class BlurPanel {
    static allPanels = new Set();

    constructor(targetActor, settings, cornerRadius = 20.0, rootContainer = null, customInsets = null, isPopup = false) {
        this.targetActor = targetActor;
        this.rootContainer = rootContainer || targetActor;
        this.settings = settings;
        this.cornerRadius = cornerRadius;
        this.customInsets = customInsets;
        this.isPopup = isPopup;

        this._destroyed = false;
        this._isCapturing = false;
        this._capturePending = false;
        this._suppressAllocation = false;
        this._hasContent = false;

        this._dragWindow = null;
        this._dragTickId = 0;
        this._liveLaterId = 0;
        this._liveTimerId = 0;
        this._unlockDelayId = 0;

        this._lastX = -1;
        this._lastY = -1;
        this._lastW = 0;
        this._lastH = 0;

        this._timeouts = new TimeoutTracker();

        this._effect = new BlurEffect();

        this.blurActor = new Clutter.Actor({ reactive: false });
        this.blurActor.set_pivot_point(0.0, 0.0);
        this.blurActor.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this.blurActor.add_effect(this._effect);
        this.blurActor.hide();

        this._ensureHierarchy();
        BlurPanel.allPanels.add(this);

        this._setupListeners();
        this.syncSettings();

        this._timeouts.addTimeout(GLib.PRIORITY_LOW, 350, () => {
            if (!this._destroyed && this._isShowable()) {
                this.syncGeometry();
                this._startLiveTracking();
                this.queueCapture(true);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _isEnabled() {
        return Settings.blurEnabled;
    }

    _isStaticMode() {
        return Settings.blurMode === 'static';
    }

    _hasBlur() {
        return !this._destroyed && this.blurActor !== null;
    }

    _isLocked() {
        return Main.sessionMode.isLocked ||
            Main.sessionMode.currentMode === 'lock-screen' ||
            Main.sessionMode.currentMode === 'unlock-dialog';
    }

    _isShowable() {
        if (!this._hasBlur() || !this._isEnabled()) return false;
        if (this._isLocked()) return false;
        if (!isActorAlive(this.targetActor)) return false;
        if (!this.targetActor.get_stage() || !this.targetActor.mapped || !this.targetActor.visible) return false;
        if (!this.rootContainer.get_stage() || this.rootContainer.opacity === 0) return false;
        return this.targetActor.opacity !== 0;
    }

    _startLiveTracking() {
        if (this._isStaticMode()) return;
        this._stopLiveTracking();

        const laters = global.compositor.get_laters();
        const frameTick = () => {
            if (this._destroyed || this._isStaticMode()) {
                this._liveLaterId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._liveTick();
            this._liveLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, frameTick);
            return GLib.SOURCE_REMOVE;
        };
        this._liveLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, frameTick);

        this._liveTimerId = this._timeouts.addTimeout(GLib.PRIORITY_DEFAULT, LIVE_TICK_MS, () => {
            if (this._destroyed || this._isStaticMode()) {
                this._liveTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._liveTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _liveTick() {
        if (!this._isShowable() || this._isCapturing) return;

        this._updateGeometry();
        this._captureBackdrop();
        if (this.blurActor && this.blurActor.visible) {
            this.blurActor.queue_redraw();
        }
    }

    _stopLiveTracking() {
        if (this._liveLaterId) {
            global.compositor.get_laters().remove(this._liveLaterId);
            this._liveLaterId = 0;
        }
        if (this._liveTimerId) {
            this._timeouts.remove(this._liveTimerId);
            this._liveTimerId = 0;
        }
    }

    _ensureHierarchy() {
        if (!this._hasBlur()) return false;
        const parent = this.rootContainer.get_parent();
        if (!parent) return false;

        const current = this.blurActor.get_parent();
        if (current !== parent) {
            if (current) current.remove_child(this.blurActor);
            parent.insert_child_below(this.blurActor, this.rootContainer);
        } else if (this.rootContainer.get_previous_sibling() !== this.blurActor) {
            parent.set_child_below_sibling(this.blurActor, this.rootContainer);
        }
        return true;
    }

    _setupListeners() {
        const onTransform = () => this._onTransformChanged();
        const transformHandlers = TRANSFORM_SIGNALS.flatMap(signal => [signal, onTransform]);

        this.targetActor.connectObject(
            'notify::allocation', onTransform,
            'notify::visible', () => this._onVisibilityChanged(),
            'notify::mapped', () => this._onVisibilityChanged(),
            'destroy', () => this.destroy(),
            ...transformHandlers,
            this);

        this.rootContainer.connectObject(
            'parent-set', () => this._onRootParentChanged(),
            'destroy', () => this.destroy(),
            this);

        if (this.rootContainer !== this.targetActor) {
            this.rootContainer.connectObject(
                'notify::x', onTransform,
                'notify::y', onTransform,
                ...transformHandlers,
                this);
        }

        const handleUnlockResume = () => {
            if (this._unlockDelayId) {
                this._timeouts.remove(this._unlockDelayId);
                this._unlockDelayId = 0;
            }
            this._unlockDelayId = this._timeouts.addTimeout(GLib.PRIORITY_DEFAULT, 120, () => {
                this._unlockDelayId = 0;
                if (this._destroyed || !this._hasBlur()) return GLib.SOURCE_REMOVE;
                if (this._isShowable()) {
                    this.syncGeometry();
                    this._startLiveTracking();
                    this.queueCapture();
                }
                return GLib.SOURCE_REMOVE;
            });
        };

        Main.sessionMode.connectObject('updated', () => {
            if (this._isLocked()) {
                this._hideBlur();
                this._stopLiveTracking();
            } else {
                this._hasContent = false;
                handleUnlockResume();
            }
        }, this);

        if (Main.screenShield) {
            Main.screenShield.connectObject('locked-changed', () => {
                if (this._isLocked()) {
                    this._hideBlur();
                    this._stopLiveTracking();
                } else {
                    this._hasContent = false;
                    handleUnlockResume();
                }
            }, this);
        }
    }

    _onTransformChanged() {
        if (this._suppressAllocation || !this._isShowable()) return;
        if (!this._updateGeometry()) return;

        if (this._isStaticMode()) {
            if (!this._hasContent) this._captureBackdrop();
        } else {
            this.queueCapture();
        }
    }

    _onRootParentChanged() {
        const parent = this.rootContainer ? this.rootContainer.get_parent() : null;
        if (!parent) {
            this._hideBlur();
            if (this.blurActor) {
                const currentParent = this.blurActor.get_parent();
                if (currentParent) {
                    currentParent.remove_child(this.blurActor);
                }
            }
            return;
        }

        if (this._ensureHierarchy() && this._isShowable()) {
            this.syncGeometry();
        }
    }

    _onVisibilityChanged() {
        if (this._isShowable()) {
            this.syncGeometry();
            this._startLiveTracking();
        } else {
            this._hideBlur();
            this._stopLiveTracking();
        }
    }

    _hideBlur() {
        this.endDragTracking();
        if (this._unlockDelayId) {
            this._timeouts.remove(this._unlockDelayId);
            this._unlockDelayId = 0;
        }
        if (!this._hasBlur()) return;
        this.blurActor.hide();
        this.blurActor.set_content(null);
        this._hasContent = false;
        this._lastX = -1;
        this._lastY = -1;
        this._lastW = 0;
        this._lastH = 0;
    }

    setCornerRadius(radius) {
        if (this.cornerRadius === radius) return;
        this.cornerRadius = radius;
        this.syncSettings();
    }

    setCustomInsets(insets) {
        this.customInsets = insets;
        this._lastW = 0;
        this._lastH = 0;
        this.syncGeometry();
    }

    syncSettings() {
        if (!this._hasBlur()) return;

        if (!this._isEnabled()) {
            this._stopLiveTracking();
            this._hideBlur();
            return;
        }

        if (this._isStaticMode()) {
            this._stopLiveTracking();
            this._hasContent = false;
            this._captureBackdrop();
        } else {
            this._startLiveTracking();
        }

        const borderGlowVal = this.isPopup
            ? Math.max(0.40, Settings.blurBorderGlow)
            : Settings.blurBorderGlow;

        const brightnessVal = this.isPopup
            ? Math.max(0.12, Settings.blurBrightness)
            : Settings.blurBrightness;

        const tintOpacityVal = this.isPopup
            ? Math.min(1.0, Math.max(0.45, Settings.blurTintOpacity + 0.15))
            : Settings.blurTintOpacity;

        this._effect.setParams({
            radius: this.cornerRadius,
            blurIntensity: Settings.blurIntensity,
            vibrancy: Settings.blurVibrancy,
            blurBrightness: brightnessVal,
            borderGlow: borderGlowVal,
            highlightAngle: Settings.blurHighlightAngle,
            tintColor: hexToRgb(Settings.blurTintColor),
            colorTintOpacity: tintOpacityVal,
        });

        if (this._hasContent) {
            this._captureBackdrop();
        }

        if (!this.blurActor.visible && this._isShowable()) {
            this.syncGeometry();
        } else if (this.blurActor.visible) {
            this.blurActor.queue_redraw();
        }
    }

    _updateGeometry() {
        if (!this._isShowable() || !this._ensureHierarchy()) return false;

        let [rawX, rawY] = this.targetActor.get_transformed_position();
        let [rawW, rawH] = this.targetActor.get_transformed_size();

        const currentPos = Settings.dockPosition || 'BOTTOM';
        if (currentPos === 'BOTTOM' && rawY <= 5 && !this.isPopup) {
            this.blurActor.hide();
            return false;
        }

        if (this.customInsets) {
            rawX += (this.customInsets.left || 0);
            rawY += (this.customInsets.top || 0);
            rawW -= ((this.customInsets.left || 0) + (this.customInsets.right || 0));
            rawH -= ((this.customInsets.top || 0) + (this.customInsets.bottom || 0));
        }

        const x = Math.round(rawX);
        const y = Math.round(rawY);
        const w = Math.round(rawW);
        const h = Math.round(rawH);

        if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 1 || h <= 1) return false;
        if (x === this._lastX && y === this._lastY && w === this._lastW && h === this._lastH) return false;

        this._lastX = x;
        this._lastY = y;
        this._lastW = w;
        this._lastH = h;

        const parent = this.blurActor.get_parent();
        const [, left, top] = parent.transform_stage_point(x, y);
        const [, right, bottom] = parent.transform_stage_point(x + w, y + h);

        this.blurActor.remove_all_transitions();
        this.blurActor.set_position(Math.round(left), Math.round(top));
        this.blurActor.set_size(Math.round(right - left), Math.round(bottom - top));

        this._effect.updateDimensions(w, h, w, h);

        return true;
    }

    syncGeometry() {
        if (!this._isShowable()) return;

        const updated = this._updateGeometry();
        if (this._lastX < 0 || this._lastY < 0) return;

        if (updated || !this._hasContent) {
            this._captureBackdrop();
        }
        if (this._hasContent) {
            this.blurActor.remove_all_transitions();
            this.blurActor.show();
        }
    }

    queueCapture(force = false) {
        if (this._isStaticMode() && this._hasContent && !force) return;
        if (this._capturePending || !this._isShowable()) return;

        this._capturePending = true;
        this._timeouts.addIdle(GLib.PRIORITY_HIGH, () => {
            this._capturePending = false;
            this._updateGeometry();
            this._captureBackdrop();
            return GLib.SOURCE_REMOVE;
        });
    }

    beginDragTracking(window) {
        if (this._isStaticMode()) return;
        this.endDragTracking();
        if (!window || !this._isShowable()) return;

        this._dragWindow = window;
        this._dragTickId = this._timeouts.addTimeout(GLib.PRIORITY_HIGH, DRAG_TICK_MS, () => {
            if (!this._isShowable()) {
                this._dragTickId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (this._windowOverlapsBlur(this._dragWindow)) {
                this._updateGeometry();
                this._captureBackdrop();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    endDragTracking() {
        if (this._dragTickId) {
            this._timeouts.remove(this._dragTickId);
            this._dragTickId = 0;
        }
        this._dragWindow = null;
        if (!this._isStaticMode()) {
            this.queueCapture();
        }
    }

    _windowOverlapsBlur(win) {
        const r = win.get_frame_rect();
        return r.x < this._lastX + this._lastW &&
            r.x + r.width > this._lastX &&
            r.y < this._lastY + this._lastH &&
            r.y + r.height > this._lastY;
    }

    _paintLiveBackdrop(rect) {
        const wasBlurVisible = this.blurActor.visible;
        this.blurActor.visible = false;

        const hidden = [];
        for (const panel of BlurPanel.allPanels) {
            const target = panel.rootContainer;
            if (!isActorAlive(target)) continue;

            if (target.name === 'DhruvaContainer' || target.name === 'DhruvaBackground') {
                hidden.push({ actor: target, opacity: target.opacity });
                target.opacity = 0;
            } else if (panel.contentActor && isActorAlive(panel.contentActor)) {
                hidden.push({ actor: panel.contentActor, opacity: panel.contentActor.opacity });
                panel.contentActor.opacity = 0;
            } else if (panel.folderMenuRef && panel.folderMenuRef.panel && isActorAlive(panel.folderMenuRef.panel)) {
                const contentPanel = panel.folderMenuRef.panel;
                hidden.push({ actor: contentPanel, opacity: contentPanel.opacity });
                contentPanel.opacity = 0;
            }
        }

        const paintFlags = 1 | 2;
        const content = global.stage.paint_to_content.length === 4
            ? global.stage.paint_to_content(rect, 1, null, paintFlags)
            : global.stage.paint_to_content(rect, 1, paintFlags);

        for (const { actor, opacity } of hidden) {
            if (isActorAlive(actor)) {
                actor.opacity = opacity;
            }
        }
        this.blurActor.visible = wasBlurVisible;

        return content;
    }

    _loadStaticPreset(w, h) {
        const sourceMode = this.settings.get_string('blur-static-source') || 'preset';
        let file = null;

        if (sourceMode === 'custom') {
            const customPath = this.settings.get_string('blur-custom-photo');
            if (customPath && customPath.trim() !== '') {
                const customFile = Gio.File.new_for_path(customPath.trim());
                if (customFile.query_exists(null)) {
                    file = customFile;
                }
            }
        }

        if (!file) {
            const presetName = this.settings.get_string('blur-static-preset') || 'abstract-dark';

            const uuid = 'dhruva@narkagni';
            const homeDir = GLib.get_home_dir();
            const extDir = Gio.File.new_for_path(
                GLib.build_filenamev([homeDir, '.local', 'share', 'gnome-shell', 'extensions', uuid])
            );

            const iconsDir = extDir.get_child('icons');
            const candidate1 = iconsDir.get_child(`blur-preset-${presetName}.svg`);
            const candidate2 = iconsDir.get_child(`glass-preset-${presetName}.svg`);

            if (candidate1.query_exists(null)) {
                file = candidate1;
            } else if (candidate2.query_exists(null)) {
                file = candidate2;
            }
        }

        if (!file) return;

        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const targetW = Math.max(800, Math.round((w || 800) * scaleFactor));
        const targetH = Math.max(200, Math.round((h || 80) * scaleFactor));

        const textureCache = St.TextureCache.get_default();
        const loaderActor = textureCache.load_file_async(file, targetW, targetH, scaleFactor, 1.0);

        if (!loaderActor) return;

        const applyContent = () => {
            const content = loaderActor.get_content();
            if (content && !this._destroyed && this._hasBlur()) {
                this.blurActor.set_content(content);
                this._hasContent = true;
                this.blurActor.show();
                this.blurActor.queue_redraw();
            }
        };

        if (loaderActor.get_content()) {
            applyContent();
        } else {
            loaderActor.connectObject('notify::content', () => {
                applyContent();
                loaderActor.disconnectObject(this);
            }, this);
        }
    }

    _captureBackdrop() {
        if (this._isCapturing || !this._isShowable() || !this._ensureHierarchy()) return;

        if (this._lastW <= 1 || this._lastH <= 1) {
            this._updateGeometry();
            if (this._lastW <= 1 || this._lastH <= 1) return;
        }

        if (this._isStaticMode()) {
            this._loadStaticPreset(this._lastW, this._lastH);
            return;
        }

        this._isCapturing = true;
        this._suppressAllocation = true;

        const rect = new Mtk.Rectangle({
            x: Math.max(0, this._lastX),
            y: Math.max(0, this._lastY),
            width: this._lastW,
            height: this._lastH,
        });

        const content = this._paintLiveBackdrop(rect);

        this._suppressAllocation = false;
        this._isCapturing = false;

        if (content) {
            this.blurActor.set_content(content);
            this._hasContent = true;
            if (!this.blurActor.visible) {
                this.blurActor.show();
            }
        } else {
            this._hasContent = false;
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        BlurPanel.allPanels.delete(this);

        Main.sessionMode.disconnectObject(this);
        if (Main.screenShield) {
            Main.screenShield.disconnectObject(this);
        }

        this._stopLiveTracking();
        this.endDragTracking();
        this._timeouts.destroy();

        if (isActorAlive(this.targetActor)) {
            this.targetActor.disconnectObject(this);
        }
        if (this.rootContainer !== this.targetActor && isActorAlive(this.rootContainer)) {
            this.rootContainer.disconnectObject(this);
        }

        const blur = this.blurActor;
        this.blurActor = null;
        if (blur) {
            blur.hide();
            blur.set_content(null);

            const parent = blur.get_parent();
            if (parent) {
                parent.remove_child(blur);
            }

            if (this._effect) {
                blur.remove_effect(this._effect);
            }

            blur.destroy();
            markActorDisposed(blur);
        }

        this._effect = null;
        this.targetActor = null;
        this.rootContainer = null;
        this.settings = null;
    }
}