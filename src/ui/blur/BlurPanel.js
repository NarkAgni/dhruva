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
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { BlurEffect } from './BlurEffect.js';
import { Settings } from '../../core/SettingsManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { isActorAlive, markActorDisposed } from '../../core/Utils.js';


const KERNEL_REACH = 1.5;
const PAD_SLACK = 32;
const CANVAS_BUCKET = 64;
const CANVAS_SHRINK_SLACK = 192;
const INITIAL_SYNC_DELAY_MS = 350;
const UNLOCK_SYNC_DELAY_MS = 120;

const TRANSFORM_SIGNALS = [
    'notify::scale-x', 'notify::scale-y',
    'notify::translation-x', 'notify::translation-y',
];

function getIconsDir() {
    return Gio.File.new_for_uri(import.meta.url)
        .get_parent()
        .get_parent()
        .get_parent()
        .get_parent()
        .get_child('icons');
}

function fitCanvas(current, needed) {
    if (current >= needed && current - needed <= CANVAS_SHRINK_SLACK) return current;
    return Math.ceil(needed / CANVAS_BUCKET) * CANVAS_BUCKET;
}

function hexToRgb(str) {
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
    constructor(targetActor, settings, cornerRadius = 20.0, rootContainer = null, customInsets = null, isPopup = false) {
        this.targetActor = targetActor;
        this.rootContainer = rootContainer || targetActor;
        this.settings = settings;
        this.cornerRadius = cornerRadius;
        this.customInsets = customInsets;
        this.isPopup = isPopup;

        this._hasContent = false;
        this._lastKey = '';
        this._pad = PAD_SLACK;
        this._arrow = null;
        this._targetRect = null;
        this._canvasW = 0;
        this._canvasH = 0;
        this._initialSyncId = 0;
        this._unlockDelayId = 0;
        this._showLaterId = 0;
        this._timeouts = new TimeoutTracker();

        this._effect = new BlurEffect();
        this._bgClone = new Clutter.Clone();
        this._winClone = new Clutter.Clone();

        this.blurActor = new Clutter.Actor({ reactive: false, clip_to_allocation: true, visible: false });
        this.blurActor.set_position(0, 0);
        this._bgClone.set_position(0, 0);
        this._winClone.set_position(0, 0);
        this.blurActor.add_child(this._bgClone);
        this.blurActor.add_child(this._winClone);
        this.blurActor.add_effect(this._effect);
        this.blurActor.connectObject('notify::visible', () => this._syncCloneSources(), this);

        this._ensureHierarchy();
        this._setupListeners();
        this.syncSettings();

        if (this._initialSyncId) {
            this._timeouts.remove(this._initialSyncId);
            this._initialSyncId = 0;
        }
        this._initialSyncId = this._timeouts.addTimeout(GLib.PRIORITY_LOW, INITIAL_SYNC_DELAY_MS, () => {
            this._initialSyncId = 0;
            this.syncGeometry();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncCloneSources() {
        if (!this.blurActor) return;
        const isLive = this.blurActor.visible && !this._isStaticMode() && global.window_group.visible;
        this._bgClone.source = isLive ? Main.layoutManager._backgroundGroup : null;
        this._winClone.source = isLive ? global.window_group : null;
    }

    _isStaticMode() {
        return Settings.blurMode === 'static';
    }

    _isLocked() {
        return Main.sessionMode.isLocked ||
            Main.sessionMode.currentMode === 'lock-screen' ||
            Main.sessionMode.currentMode === 'unlock-dialog';
    }

    _isShowable() {
        if (!this.blurActor || !Settings.blurEnabled || this._isLocked()) return false;
        if (!isActorAlive(this.targetActor) || !isActorAlive(this.rootContainer)) return false;
        if (!this.targetActor.get_stage() || !this.targetActor.mapped || !this.targetActor.visible) return false;
        if (!this.rootContainer.get_stage() || !this.rootContainer.visible || this.rootContainer.opacity < 10) return false;
        if (this.rootContainer._isAutohiding) return false;

        const dockUI = this.rootContainer._dockUI;
        if (dockUI && dockUI.autoHideManager && dockUI.autoHideManager.isHidden) return false;
        return this.targetActor.opacity >= 10;
    }

    _ensureHierarchy() {
        if (!this.blurActor || !this.rootContainer) return false;
        const parent = this.rootContainer.get_parent();
        if (!parent) return false;

        const current = this.blurActor.get_parent();
        if (current !== parent) {
            if (current) current.remove_child(this.blurActor);
            parent.insert_child_below(this.blurActor, this.rootContainer);
            this._canvasW = 0;
            this._canvasH = 0;
            this._lastKey = '';
        } else if (this.rootContainer.get_previous_sibling() !== this.blurActor) {
            parent.set_child_below_sibling(this.blurActor, this.rootContainer);
        }
        return true;
    }

    _setupListeners() {
        const onTransform = () => {
            if (this._isShowable()) this._updateGeometry();
        };
        const onVisibility = () => {
            if (this._isShowable()) this.syncGeometry();
            else this._hideBlur();
        };
        const transformHandlers = TRANSFORM_SIGNALS.flatMap(signal => [signal, onTransform]);

        this.targetActor.connectObject(
            'notify::allocation', onTransform,
            'notify::visible', onVisibility,
            'notify::mapped', onVisibility,
            'notify::opacity', onVisibility,
            'destroy', () => this.destroy(),
            ...transformHandlers,
            this);

        this.rootContainer.connectObject(
            'parent-set', () => this._onRootParentChanged(),
            'notify::visible', onVisibility,
            'notify::opacity', onVisibility,
            'destroy', () => this.destroy(),
            this);

        if (this.rootContainer !== this.targetActor) {
            this.rootContainer.connectObject(
                'notify::x', onTransform,
                'notify::y', onTransform,
                ...transformHandlers,
                this);
        }

        const onLockChanged = () => {
            if (this._unlockDelayId) {
                this._timeouts.remove(this._unlockDelayId);
                this._unlockDelayId = 0;
            }

            if (this._isLocked()) {
                this._hideBlur();
                return;
            }
            this._unlockDelayId = this._timeouts.addTimeout(GLib.PRIORITY_DEFAULT, UNLOCK_SYNC_DELAY_MS, () => {
                this._unlockDelayId = 0;
                this.syncGeometry();
                return GLib.SOURCE_REMOVE;
            });
        };

        global.window_group.connectObject('notify::visible', () => this._syncCloneSources(), this);

        Main.sessionMode.connectObject('updated', onLockChanged, this);
        if (Main.screenShield) Main.screenShield.connectObject('locked-changed', onLockChanged, this);
    }

    _onRootParentChanged() {
        if (!this.blurActor || !this.rootContainer) return;
        if (this.rootContainer.get_parent()) {
            if (this._ensureHierarchy()) this.syncGeometry();
            return;
        }

        this._hideBlur();
        const current = this.blurActor.get_parent();
        if (current) current.remove_child(this.blurActor);
    }

    _hideBlur() {
        if (!this.blurActor) return;
        this.blurActor.hide();
        this._lastKey = '';
        if (this._isStaticMode()) {
            this.blurActor.set_content(null);
            this._hasContent = false;
        }
    }

    setCornerRadius(radius) {
        if (this.cornerRadius === radius) return;
        this.cornerRadius = radius;
        this.syncSettings();
    }

    setCustomInsets(insets) {
        this.customInsets = insets;
        this._lastKey = '';
        this._pushArrow();
        this.syncGeometry();
    }

    setArrow(arrow) {
        this._arrow = arrow;
        this._pushArrow();
    }

    setTargetRect(rect) {
        this._targetRect = rect;
        this._lastKey = '';
        this.syncGeometry();
    }

    _pushArrow() {
        if (!this._effect) return;
        const arrow = this._arrow;
        if (!arrow) {
            this._effect.setArrow(0, 0, 0, 0);
            return;
        }

        const insets = this.customInsets || { top: 0, bottom: 0, left: 0, right: 0 };
        const sideIndex = { BOTTOM: 1, TOP: 2, LEFT: 3, RIGHT: 4 }[arrow.side];
        const isHorizontalEdge = arrow.side === 'BOTTOM' || arrow.side === 'TOP';
        const edgeInset = { BOTTOM: insets.bottom, TOP: insets.top, LEFT: insets.left, RIGHT: insets.right }[arrow.side];

        this._effect.setArrow(
            sideIndex,
            arrow.center - (isHorizontalEdge ? insets.left : insets.top),
            arrow.width,
            Math.max(0, arrow.height - edgeInset)
        );
    }

    syncSettings() {
        if (!this.blurActor) return;

        if (!Settings.blurEnabled) {
            this._hideBlur();
            return;
        }

        const isStatic = this._isStaticMode();
        this._bgClone.visible = !isStatic;
        this._winClone.visible = !isStatic;
        this._syncCloneSources();
        this.blurActor.set_content(null);
        this._hasContent = !isStatic;

        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._pad = Math.ceil(Settings.blurIntensity * scaleFactor * KERNEL_REACH) + PAD_SLACK;
        this._lastKey = '';

        this._effect.setParams({
            radius: this.cornerRadius,
            blurIntensity: Settings.blurIntensity,
            vibrancy: Settings.blurVibrancy,
            blurBrightness: this.isPopup ? Math.max(0.12, Settings.blurBrightness) : Settings.blurBrightness,
            borderGlow: this.isPopup ? Math.max(0.40, Settings.blurBorderGlow) : Settings.blurBorderGlow,
            highlightAngle: Settings.blurHighlightAngle,
            tintColor: hexToRgb(Settings.blurTintColor),
            colorTintOpacity: this.isPopup
                ? Math.min(1.0, Math.max(0.45, Settings.blurTintOpacity + 0.15))
                : Settings.blurTintOpacity,
        });

        this.syncGeometry();
    }

    _updateGeometry() {
        if (!this._ensureHierarchy()) return false;

        let [rawX, rawY] = this._targetRect ? [this._targetRect.x, this._targetRect.y] : this.targetActor.get_transformed_position();
        let [rawW, rawH] = this._targetRect ? [this._targetRect.width, this._targetRect.height] : this.targetActor.get_transformed_size();

        if ((Settings.dockPosition || 'BOTTOM') === 'BOTTOM' && rawY <= 5 && !this.isPopup) {
            this._hideBlur();
            return false;
        }

        if (this.customInsets) {
            const { top = 0, bottom = 0, left = 0, right = 0 } = this.customInsets;
            rawX += left;
            rawY += top;
            rawW -= left + right;
            rawH -= top + bottom;
        }

        const x = Math.round(rawX);
        const y = Math.round(rawY);
        const w = Math.round(rawW);
        const h = Math.round(rawH);
        if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 1 || h <= 1) return false;

        const key = `${x},${y},${w},${h},${this._pad}`;
        if (key === this._lastKey) return false;
        this._lastKey = key;

        const pad = this._pad;
        const areaX = x - pad;
        const areaY = y - pad;
        const areaW = w + pad * 2;
        const areaH = h + pad * 2;

        const parent = this.blurActor.get_parent();
        const [, left, top] = parent.transform_stage_point(areaX, areaY);

        const canvasW = fitCanvas(this._canvasW, areaW);
        const canvasH = fitCanvas(this._canvasH, areaH);
        if (canvasW !== this._canvasW || canvasH !== this._canvasH) {
            this._canvasW = canvasW;
            this._canvasH = canvasH;
            const [, right, bottom] = parent.transform_stage_point(areaX + canvasW, areaY + canvasH);
            this.blurActor.set_size(Math.round(right - left), Math.round(bottom - top));
        }

        this.blurActor.translation_x = Math.round(left);
        this.blurActor.translation_y = Math.round(top);
        this._bgClone.translation_x = -areaX;
        this._bgClone.translation_y = -areaY;
        this._winClone.translation_x = -areaX;
        this._winClone.translation_y = -areaY;

        this._effect.updateDimensions(canvasW, canvasH, w, h, pad, pad);
        return true;
    }

    syncGeometry() {
        if (!this._isShowable()) return;

        this._updateGeometry();
        if (!this._lastKey) return;

        if (this._isStaticMode() && !this._hasContent) {
            this._loadStaticPreset(this.blurActor.width, this.blurActor.height);
            return;
        }
        this._queueShow();
    }

    _queueShow() {
        if (!this.blurActor || this.blurActor.visible || this._showLaterId) return;
        this._showLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._showLaterId = 0;
            if (this._lastKey && this._isShowable()) this.blurActor.show();
            return GLib.SOURCE_REMOVE;
        });
    }

    queueCapture(force = false) {
        if (force && this._isStaticMode()) this._hasContent = false;
        this.syncGeometry();
    }

    _loadStaticPreset(w, h) {
        if (!this.settings) return;
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

            const iconsDir = getIconsDir();
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
            if (content && this.blurActor) {
                this.blurActor.set_content(content);
                this._hasContent = true;
                this._queueShow();
            }
        };

        if (this._loaderActor) {
            this._loaderActor.disconnectObject(this);
            this._loaderActor = null;
        }

        if (loaderActor.get_content()) {
            applyContent();
        } else {
            this._loaderActor = loaderActor;
            loaderActor.connectObject('notify::content', () => {
                this._loaderActor = null;
                applyContent();
                loaderActor.disconnectObject(this);
            }, this);
        }
    }

    destroy() {
        if (this.blurActor) {
            Main.sessionMode.disconnectObject(this);
            global.window_group.disconnectObject(this);
            if (Main.screenShield) Main.screenShield.disconnectObject(this);
            if (this._loaderActor) {
                this._loaderActor.disconnectObject(this);
                this._loaderActor = null;
            }
            if (this._initialSyncId) {
                this._timeouts.remove(this._initialSyncId);
                this._initialSyncId = 0;
            }
            if (this._unlockDelayId) {
                this._timeouts.remove(this._unlockDelayId);
                this._unlockDelayId = 0;
            }
            if (this._timeouts) {
                this._timeouts.destroy();
                this._timeouts = null;
            }
            if (this._showLaterId) {
                global.compositor.get_laters().remove(this._showLaterId);
                this._showLaterId = 0;
            }

            if (isActorAlive(this.targetActor)) this.targetActor.disconnectObject(this);
            if (isActorAlive(this.rootContainer)) this.rootContainer.disconnectObject(this);
            if (isActorAlive(this.blurActor)) this.blurActor.disconnectObject(this);

            const blur = this.blurActor;
            this.blurActor = null;

            if (isActorAlive(blur)) {
                blur.remove_effect(this._effect);
                blur.destroy();
                markActorDisposed(blur);
            }

            this._effect = null;
            this._bgClone = null;
            this._winClone = null;
            this.targetActor = null;
            this.rootContainer = null;
            this.settings = null;
        }
    }
}