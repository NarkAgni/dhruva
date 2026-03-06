import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import AppGridUI from './AppGridUI.js';
import { buildModules } from './Modules.js';
import AppContextMenu from './ContextMenu.js';
import AppManager from '../core/AppManager.js';
import DockManager from '../core/DockManager.js';
import FloatManager from '../core/FloatManager.js';
import ScrollManager from '../core/ScrollManager.js';
import MonitorManager from '../core/MonitorManager.js';
import { debounce, hexToRgba } from '../core/Utils.js';
import AutoHideManager from '../core/AutoHideManager.js';
import WorkspaceFilter from '../core/WorkspaceFilter.js';
import { cleanupTrashEffects } from './effects/TrashEffect.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { animateIconClick } from './effects/IconClickEffect.js';
import { setupDragAndDrop, applyIconFilter } from './DragDrop.js';
import { applyDockTheme, extractWallpaperDominantColor, getChameleonAccentColor } from './Themes.js';
import { setupMagnification, teardownMagnification, applyRealtimeFrame, resetMagnification } from './Magnifier.js';
import { setupWindowEffects, teardownWindowEffects, animateMinimize, animateRestore, animateLaunch } from './effects/WindowEffects.js';

export default class DockUI {
    constructor(settings, openPrefsCallback, uuid) {
        this._isDestroyed = false;
        this.settings = settings;
        this.openPrefsCallback = openPrefsCallback;
        this.appManager = new AppManager(uuid);
        this.dockPosition = this.settings.get_string('dock-position') || 'BOTTOM';

        this.settingsSignals = [];
        this.appSystemSignals = [];
        this.displaySignals = [];
        this.wmSignals = [];
        this.workspaceSignals = [];
        this._activeContextMenu = null;
        this._ignoreAppTimers = [];

        this.actor = new Clutter.Actor({ name: 'DhruvaContainer', reactive: true });
        this.actor.clip_to_allocation = false;
        this.actor._isDestroyed = false;

        ScrollManager.setupDockScroll(this.actor, this.settings);

        this.actor.connect('button-release-event', (_actor, event) => {
            if (event.get_button() === 3 && !this._activeContextMenu) {
                const state = event.get_state();
                if ((state & Clutter.ModifierType.CONTROL_MASK) && this.openPrefsCallback) {
                    this.openPrefsCallback();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.bgActor = new St.Widget({ name: 'DhruvaBackground', style_class: 'plank-like-dock-bg' });
        this.bgActor.clip_to_allocation = false;
        this.bgActor.reactive = true;
        this.bgActor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                const state = event.get_state();
                if ((state & Clutter.ModifierType.CONTROL_MASK) && this.openPrefsCallback) {
                    this.openPrefsCallback();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.boxActor = new St.BoxLayout({
            name: 'Dhruva',
            style_class: 'plank-like-dock',
            reactive: true,
            track_hover: true,
        });
        this.boxActor.set_vertical(this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
        this.boxActor.clip_to_allocation = false;

        this.boxActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };

        this.actor.bgActor = this.bgActor;
        this.actor.boxActor = this.boxActor;
        this.actor.add_child(this.bgActor);
        this.actor.add_child(this.boxActor);

        this.monitorManager = new MonitorManager(this.settings);
        this.dockManager = new DockManager(this, settings);
        this.appGridUI = new AppGridUI(this);

        this.floatManager = new FloatManager(this);
        this._isFloating = false;

        this._setupLayoutUpdates();
        this._setupChameleonWatcher();
        this._applyDynamicStyles();

        this.queueRender = debounce(this._renderDock.bind(this), 5);

        this.appSystemSignals.push(this.appManager.appSystem.connect('installed-changed', () => this.queueRender()));
        this.appSystemSignals.push(this.appManager.appSystem.connect('app-state-changed', () => this.queueRender()));

        this.wmSignals.push(global.window_manager.connect('destroy', () => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender();
        }));

        this.wmSignals.push(global.window_manager.connect('map', (wm, actor) => {
            if (this.actor) this.actor._lastIconClickTime = 0;
            this.queueRender();

            if (this._isDestroyed || !this._pendingLaunches || this._pendingLaunches.length === 0) return;

            const win = actor.meta_window;
            if (!win || win.get_window_type() !== Meta.WindowType.NORMAL) return;

            const tracker = Shell.WindowTracker.get_default();
            const winApp = tracker.get_window_app(win);
            const winClass = win.get_wm_class() ? win.get_wm_class().toLowerCase() : '';

            let matchedIndex = -1;

            for (let i = 0; i < this._pendingLaunches.length; i++) {
                let p = this._pendingLaunches[i];
                if (p.appId && winApp && winApp.get_id() === p.appId) {
                    matchedIndex = i; break;
                } else if (p.isFolder && (winClass.includes('nautilus') || winClass.includes('files'))) {
                    matchedIndex = i; break;
                }
            }

            if (matchedIndex !== -1) {
                const pending = this._pendingLaunches.splice(matchedIndex, 1)[0];
                try {
                    animateLaunch(win, pending.btn, this.dockPosition);
                } catch (e) {
                    actor.opacity = 255;
                }
            }
        }));

        this.displaySignals.push(global.display.connect('notify::focus-window', () => {
            if (this._isDestroyed) return;
            const recentClick = this.actor._lastIconClickTime && (Date.now() - this.actor._lastIconClickTime < 1000);
            if (this.actor._launchingApp || recentClick) return;
            this.queueRender();
        }));

        this.workspaceSignals.push(global.workspace_manager.connect('active-workspace-changed', () => {
            if (this._isDestroyed) return;
            try {
                if (this.settings.get_boolean('isolate-workspaces')) {
                    this.actor._lastIconClickTime = 0;
                    this.queueRender();
                }
            } catch (e) { }
        }));

        const settingsToWatch = [
            'icon-size', 'show-grid-button', 'show-running-indicators', 'hover-zoom', 'hover-zoom-factor',
            'lock-icons', 'show-tooltips', 'tooltip-margin', 'click-effect', 'show-trash', 'show-clock',
            'clock-position', 'clock-font-size', 'show-desktop-button', 'show-home', 'show-downloads',
            'show-documents', 'show-pictures', 'show-videos', 'show-music', 'context-menu-size',
            'big-preview-size', 'minimize-effect', 'stroke-width', 'indicator-style', 'indicator-color',
            'indicator-size', 'indicator-spacing', 'indicator-glow', 'custom-folders', 'isolate-workspaces'
        ];

        settingsToWatch.forEach(key => {
            this.settingsSignals.push(this.settings.connect(`changed::${key}`, () => {
                if (this.actor) {
                    try { resetMagnification(this.actor); } catch (e) { }
                }
                this.queueRender();
                this._updateLayout();
            }));
        });

        [
            'background-color', 'background-opacity', 'border-radius', 'stroke-color', 'stroke-opacity',
            'dock-padding', 'dock-height', 'icon-spacing', 'dock-theme', 'use-gradient', 'background-gradient-color',
            'gradient-direction'
        ].forEach(key => {
            this.settingsSignals.push(this.settings.connect(`changed::${key}`, () => {
                if (this.actor) {
                    try { resetMagnification(this.actor); } catch (e) { }
                }
                this._applyDynamicStyles();
                this._updateLayout();
            }));
        });

        ['dock-position', 'full-width', 'icon-alignment', 'grid-button-position'].forEach(key => {
            this.settingsSignals.push(this.settings.connect(`changed::${key}`, () => {
                this.dockPosition = this.settings.get_string('dock-position');
                this.boxActor.set_vertical(this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT');
                this._renderDock();
            }));
        });

        this.settingsSignals.push(this.settings.connect('changed::dock-margin', () => {
            if (!this._isDestroyed && this.dockManager) this.dockManager.updatePosition();
        }));
        this.settingsSignals.push(this.settings.connect('changed::preferred-monitor', () => {
            if (this._isDestroyed) return;
            this.dockManager.updatePosition();
            this.queueRender();
        }));

        this.queueRender();
    }

    _setupLayoutUpdates() {
        this.boxActor.connect('notify::allocation', () => {
            if (this._allocIdleId) return;
            this._allocIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._allocIdleId = null;
                if (!this._isDestroyed && this.actor && this.actor.is_mapped()) {
                    this._updateLayout();
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    triggerPostDragSettle() {
        if (this._isDestroyed) return;
        if (this._postDragSettleId) {
            GLib.source_remove(this._postDragSettleId);
        }
        this._postDragSettleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._postDragSettleId = null;
            if (!this._isDestroyed) {
                this._pendingRender = false;
                this._renderDock();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupChameleonWatcher() {
        try {
            this._bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
            const onWallpaperChange = () => {
                if (this._isDestroyed) return;
                this._chameleonColor = null;
                this._chameleonAccent = null;
                const currentTheme = this.settings.get_string('dock-theme');
                if (currentTheme === 'chameleon') {
                    this._applyDynamicStyles();
                    this.queueRender();
                }
            };
            this._bgSignalId = this._bgSettings.connect('changed::picture-uri', onWallpaperChange);
            this._bgSignalId2 = this._bgSettings.connect('changed::picture-uri-dark', onWallpaperChange);
        } catch (e) { }
    }

    _updateLayout() {
        if (this._isDestroyed || !this.actor || !this.boxActor) return;
        if (!this.actor.is_mapped()) return;
        try {
            if (this._wasDragging && !this.actor._isDragging) {
                this._wasDragging = false;
                if (this.actor._wasRealDrag) {
                    this.actor._wasRealDrag = false;
                    this.triggerPostDragSettle();
                }
            }
            if (this.actor._isDragging) {
                this._wasDragging = true;
            }

            let isFullWidth = this.settings.get_boolean('full-width');

            const pos = this.settings.get_string('dock-position');
            const isVertical = pos === 'LEFT' || pos === 'RIGHT';
            const gridPos = this.settings.get_string('grid-button-position') || 'END';
            const alignment = this.settings.get_string('icon-alignment') || 'CENTER';
            const monitorResult = this.monitorManager.getCurrentMonitor();
            if (!monitorResult || !monitorResult.monitor) return;
            const { monitor } = monitorResult;

            let [, boxW] = this.boxActor.get_preferred_width(-1);
            let [, boxH] = this.boxActor.get_preferred_height(-1);
            boxW = boxW || 10;
            boxH = boxH || 10;

            let gridW = 0, gridH = 0;
            if (this.gridBtn && this.gridBtn.visible && isFullWidth) {
                [, gridW] = this.gridBtn.get_preferred_width(-1);
                [, gridH] = this.gridBtn.get_preferred_height(-1);
            }

            const sWidth = !isFullWidth ? this.settings.get_int('stroke-width') : 0;

            const hoverZoom = this.settings.get_boolean('hover-zoom');
            const maxZoom = hoverZoom ? this.settings.get_double('hover-zoom-factor') : 1.0;
            const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
            const iconSize = this.settings.get_int('icon-size');
            const maxExpansion = hoverZoom ? (iconSize * 3.5 * (actualMax - 1.0)) : 0;

            let actorW = isFullWidth ? (isVertical ? Math.max(boxW, gridW) + (sWidth * 2) : monitor.width) : boxW + (sWidth * 2);
            let actorH = isFullWidth ? (isVertical ? monitor.height : Math.max(boxH, gridH) + (sWidth * 2)) : boxH + (sWidth * 2);

            this.actor.set_size(actorW, actorH);

            let contentW = boxW;
            let contentH = boxH;
            if (isFullWidth && this.gridBtn && this.gridBtn.visible) {
                contentW += gridW + 80;
                contentH += gridH + 80;
            }

            const totalW = contentW + maxExpansion + (sWidth * 2);
            const totalH = contentH + maxExpansion + (sWidth * 2);

            let scale = 1.0;
            const paddingBuffer = 20;

            if (isVertical && totalH > monitor.height - paddingBuffer) {
                scale = (monitor.height - paddingBuffer) / totalH;
            } else if (!isVertical && totalW > monitor.width - paddingBuffer) {
                scale = (monitor.width - paddingBuffer) / totalW;
            }

            let pivotX = 0.5, pivotY = 0.5;
            if (pos === 'LEFT') pivotX = 0.0;
            else if (pos === 'RIGHT') pivotX = 1.0;
            else if (pos === 'TOP') pivotY = 0.0;
            else if (pos === 'BOTTOM') pivotY = 1.0;

            if (isFullWidth) {
                if (!isVertical) {
                    if (alignment === 'START') pivotX = 0.0;
                    else if (alignment === 'END') pivotX = 1.0;
                } else {
                    if (alignment === 'START') pivotY = 0.0;
                    else if (alignment === 'END') pivotY = 1.0;
                }
            }

            this.actor.set_pivot_point(pivotX, pivotY);
            this.actor.set_scale(scale, scale);

            let bgX, bgY, bgW, bgH;
            if (isFullWidth) {
                bgW = isVertical ? boxW + (sWidth * 2) : monitor.width / scale;
                bgH = isVertical ? monitor.height / scale : boxH + (sWidth * 2);

                if (!isVertical) {
                    bgX = -pivotX * monitor.width * ((1.0 / scale) - 1.0);
                    if (pos === 'BOTTOM') bgY = actorH - bgH;
                    else if (pos === 'TOP') bgY = 0;
                    else bgY = (actorH - bgH) / 2;
                } else {
                    bgY = -pivotY * monitor.height * ((1.0 / scale) - 1.0);
                    if (pos === 'RIGHT') bgX = actorW - bgW;
                    else if (pos === 'LEFT') bgX = 0;
                    else bgX = (actorW - bgW) / 2;
                }
            } else {
                bgW = actorW; bgH = actorH; bgX = 0; bgY = 0;
            }

            const padScale = 20 / scale;
            let gx = 0, gy = 0;
            let actualGridPos = gridPos;

            if (isFullWidth && this.gridBtn && this.gridBtn.visible) {
                if (alignment === 'START' && gridPos === 'START') actualGridPos = 'END';
                if (alignment === 'END' && gridPos === 'END') actualGridPos = 'START';

                if (actualGridPos === 'START') {
                    gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + padScale;
                    gy = isVertical ? bgY + padScale : bgY + (bgH - gridH) / 2;
                } else {
                    gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + bgW - gridW - padScale;
                    gy = isVertical ? bgY + bgH - gridH - padScale : bgY + (bgH - gridH) / 2;
                }
                this.gridBtn.set_position(gx, gy);
            }

            let contentX = sWidth, contentY = sWidth;
            const halfExp = maxExpansion / 2;
            const safetyGap = 40 / scale;

            if (!isVertical) {
                if (isFullWidth) {
                    if (alignment === 'START') contentX = bgX + padScale + halfExp;
                    else if (alignment === 'END') contentX = bgX + bgW - boxW - padScale - halfExp;
                    else contentX = bgX + (bgW - boxW) / 2;
                }
                contentY = bgY + (bgH - boxH) / 2;
            } else {
                if (isFullWidth) {
                    if (alignment === 'START') contentY = bgY + padScale + halfExp;
                    else if (alignment === 'END') contentY = bgY + bgH - boxH - padScale - halfExp;
                    else contentY = bgY + (bgH - boxH) / 2;
                }
                contentX = bgX + (bgW - boxW) / 2;
            }

            if (isFullWidth && this.gridBtn && this.gridBtn.visible) {
                if (!isVertical) {
                    if (actualGridPos === 'START') {
                        const gridRight = gx + gridW + safetyGap;
                        const boxLeft = contentX - halfExp;
                        if (boxLeft < gridRight) contentX += (gridRight - boxLeft);
                    } else {
                        const gridLeft = gx - safetyGap;
                        const boxRight = contentX + boxW + halfExp;
                        if (boxRight > gridLeft) contentX -= (boxRight - gridLeft);
                    }
                } else {
                    if (actualGridPos === 'START') {
                        const gridBottom = gy + gridH + safetyGap;
                        const boxTop = contentY - halfExp;
                        if (boxTop < gridBottom) contentY += (gridBottom - boxTop);
                    } else {
                        const gridTop = gy - safetyGap;
                        const boxBottom = contentY + boxH + halfExp;
                        if (boxBottom > gridTop) contentY -= (boxBottom - gridTop);
                    }
                }
            }

            this.boxActor.set_position(contentX, contentY);

            this.actor._isFullWidth = isFullWidth;
            this.bgActor._baseW = bgW;
            this.bgActor._baseH = bgH;

            this.bgActor.set_position(bgX, bgY);
            this.bgActor.set_size(bgW, bgH);

            if (this.actor._fixedSlots && !this.actor._isDragging) {
                this.actor._fixedSlots = null;
            }

            if (this.dockManager && this.actor.width > 0 && this.actor.height > 0) {
                if (!this._isFloating) {
                    this.dockManager.updatePosition();
                }
            }
        } catch (e) { }
    }

    _applyDynamicStyles() {
        if (this._isDestroyed) return;
        if (!this.actor || !this.actor.is_mapped()) return;
        try {
            const isFullWidth = this.settings.get_boolean('full-width');
            let radius = isFullWidth ? 0 : this.settings.get_int('border-radius');

            const sWidth = this.settings.get_int('stroke-width');
            const sColorHex = this.settings.get_string('stroke-color');
            const sOpacity = this.settings.get_int('stroke-opacity') / 100.0;

            let borderStyle = sWidth > 0 && !isFullWidth ? `border: ${sWidth}px solid ${hexToRgba(sColorHex, sOpacity)};` : '';
            let baseLayoutCss = `border-radius: ${radius}px; ${borderStyle}`;

            const opacity = this.settings.get_int('background-opacity') / 100.0;

            let currentTheme = 'default';
            try { currentTheme = this.settings.get_string('dock-theme'); } catch (e) { }

            if (currentTheme === 'chameleon' && !this._chameleonColor) {
                const extracted = extractWallpaperDominantColor();
                if (extracted) {
                    this._chameleonColor = extracted;
                    this._chameleonAccent = getChameleonAccentColor(extracted.raw.r, extracted.raw.g, extracted.raw.b);
                } else {
                    this._chameleonColor = { bg: { r: 30, g: 30, b: 45 }, raw: { r: 80, g: 90, b: 120 } };
                    this._chameleonAccent = '#a0c8ff';
                }
            } else if (currentTheme !== 'chameleon') {
                this._chameleonColor = null;
                this._chameleonAccent = null;
            }

            const customConfig = {
                opacity: opacity,
                color1: hexToRgba(this.settings.get_string('background-color'), opacity),
                color2: hexToRgba(this.settings.get_string('background-gradient-color'), opacity),
                useGradient: this.settings.get_boolean('use-gradient'),
                direction: this.settings.get_string('gradient-direction'),
                chameleonColor: this._chameleonColor,
            };

            applyDockTheme(this.bgActor, currentTheme, baseLayoutCss, customConfig);

            const isVertical = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';
            const sidePad = this.settings.get_int('dock-padding');

            let heightPad = 6;
            try { heightPad = this.settings.get_int('dock-height'); } catch (e) { }

            let safeSidePad = isFullWidth ? sidePad : Math.max(sidePad, Math.ceil(radius * 0.45));
            let safeHeightPad = Math.max(heightPad, 4);

            let boxPad;
            if (isFullWidth) {
                boxPad = isVertical ? `4px ${safeHeightPad}px` : `${safeHeightPad}px 4px`;
            } else {
                boxPad = isVertical ? `${safeSidePad}px ${safeHeightPad}px` : `${safeHeightPad}px ${safeSidePad}px`;
            }

            const gap = this.settings.get_int('icon-spacing');

            this.boxActor.set_style(`background-color: transparent; padding: ${boxPad}; spacing: ${gap}px;`);

            if (currentTheme === 'chameleon' && this._chameleonColor) {
                const bg = this._chameleonColor.bg;
                this.actor._tooltipBg = `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.95)`;
                this.actor._tooltipFg = this._chameleonAccent;
                this.actor._clockFg = this._chameleonAccent;
            } else {
                this.actor._tooltipBg = 'rgba(20, 20, 22, 0.92)';
                this.actor._tooltipFg = 'rgba(255, 255, 255, 0.95)';
                this.actor._clockFg = 'rgba(255, 255, 255, 0.9)';
            }

            this.boxActor.get_children().forEach(c => {
                if (c.has_style_class_name && c.has_style_class_name('clock-module')) {
                    const label = c.get_child();
                    if (label) {
                        let fontSize = 15;
                        try { fontSize = this.settings.get_int('clock-font-size'); } catch (e) { }
                        label.set_style(`color: ${this.actor._clockFg}; font-size: ${fontSize}px; font-weight: 700; text-shadow: 0px 1px 3px rgba(0,0,0,0.7); padding: 0 2px;`);
                    }
                }
            });
        } catch (e) { }
    }

    _getIndicatorProps() {
        const indStyle = this.settings.get_string('indicator-style') || 'dot';
        const indSize = this.settings.get_int('indicator-size') || 4;
        const indGap = this.settings.get_int('indicator-spacing') || 4;
        const indGlow = this.settings.get_boolean('indicator-glow');
        const isVert = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';
        const iconSize = this.settings.get_int('icon-size') || 48;

        let currentTheme = 'default';
        try { currentTheme = this.settings.get_string('dock-theme'); } catch (e) { }
        const indColor = (currentTheme === 'chameleon' && this._chameleonAccent)
            ? this._chameleonAccent
            : (this.settings.get_string('indicator-color') || '#ffffff');

        let dw = indSize, dh = indSize, br = '100px';

        if (indStyle === 'dash') {
            const len = Math.max(12, indSize * 2.5);
            const thick = Math.max(2, Math.floor(indSize / 1.2));
            dw = isVert ? thick : len; dh = isVert ? len : thick; br = '2px';
        } else if (indStyle === 'line') {
            const len = iconSize;
            const thick = Math.max(2, Math.floor(indSize / 1.5));
            dw = isVert ? thick : len; dh = isVert ? len : thick; br = '2px';
        } else if (indStyle === 'square') {
            dw = indSize; dh = indSize; br = '2px';
        }

        let marginStr = '';
        if (this.dockPosition === 'BOTTOM') marginStr = `margin-top: ${indGap}px; margin-bottom: 2px;`;
        else if (this.dockPosition === 'TOP') marginStr = `margin-bottom: ${indGap}px; margin-top: 2px;`;
        else if (this.dockPosition === 'LEFT') marginStr = `margin-right: ${indGap}px; margin-left: 2px;`;
        else if (this.dockPosition === 'RIGHT') marginStr = `margin-left: ${indGap}px; margin-right: 2px;`;

        const shadowStr = indGlow ? `box-shadow: 0px 0px 8px ${hexToRgba(indColor, 0.8)};` : '';
        const style = `width: ${dw}px; height: ${dh}px; background-color: ${indColor}; border-radius: ${br}; ${shadowStr}`;

        return { dw, dh, style, marginStr };
    }

    _renderDock() {
        if (this._isDestroyed) return;
        if (!this.actor || !this.actor.is_mapped()) {
            this._pendingRender = true;
            return;
        }
        try {
            if (this.actor._isDragging) { this._pendingRender = true; return; }

            if (this._dropSettling) { this._pendingRender = true; return; }

            if (this.actor._lastIconClickTime) {
                const elapsed = Date.now() - this.actor._lastIconClickTime;
                if (elapsed < 850) {
                    this._pendingRender = false;
                    if (!this._delayedRenderId) {
                        this._delayedRenderId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 850 - elapsed + 10, () => {
                            this._delayedRenderId = null;
                            this.queueRender();
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    return;
                }
            }

            this._pendingRender = false;

            const oldVisuals = new Map();
            const cacheActor = (c) => {
                try {
                    if (!c || (typeof c.is_destroyed === 'function' && c.is_destroyed())) return;
                    let id = null;
                    if (c._delegate?.app?.get_id) id = c._delegate.app.get_id();
                    else if (c.has_style_class_name?.('clock-module')) id = 'dhruva-clock';
                    else if (c.get_child?.()?.has_style_class_name?.('dock-grid-icon')) id = 'dhruva-grid-button';

                    if (id) {
                        oldVisuals.set(id, {
                            sx: c.scale_x, sy: c.scale_y,
                            tx: c.translation_x, ty: c.translation_y
                        });
                    }
                } catch (_e) { }
            };

            if (this.boxActor) {
                try { this.boxActor.get_children().forEach(cacheActor); } catch (_e) { }
            }
            if (this.gridBtn) {
                try { cacheActor(this.gridBtn); } catch (_e) { }
            }

            let _gridBtnOnActor = false;
            if (this.gridBtn) {
                try { _gridBtnOnActor = this.gridBtn.get_parent() === this.actor; } catch (_e) { }
            }

            this.boxActor.destroy_all_children();

            if (this.gridBtn) {
                const _btn = this.gridBtn;
                this.gridBtn = null;
                if (_gridBtnOnActor) {
                    try { _btn.destroy(); } catch (_e) { }
                }
            }

            const displayAppsRaw = this.appManager.getDisplayApps();
            let displayApps = displayAppsRaw;

            if (this._ignoringApps && this._ignoringApps.size > 0) {
                displayApps = displayAppsRaw.filter(app => {
                    if (typeof app.get_id !== 'function') return true;
                    if (this.appManager.hasApp(app)) return true;
                    return !this._ignoringApps.has(app.get_id());
                });
            }

            const iconSize = this.settings.get_int('icon-size');
            const showIndicators = this.settings.get_boolean('show-running-indicators');
            const hoverZoom = this.settings.get_boolean('hover-zoom');
            const showTooltips = this.settings.get_boolean('show-tooltips');
            const zoomFactor = this.settings.get_double('hover-zoom-factor');
            const isFullWidth = this.settings.get_boolean('full-width');
            const isVerticalDock = this.dockPosition === 'LEFT' || this.dockPosition === 'RIGHT';

            const appButtons = [];

            displayApps.forEach(app => {
                let isRunning = app.get_state() === Shell.AppState.RUNNING;

                const activeWindows = WorkspaceFilter.filterWindows(app.get_windows(), this.settings);
                if (this.settings.get_boolean('isolate-workspaces') && activeWindows.length === 0) {
                    isRunning = false;
                }

                if (this._ignoringApps && typeof app.get_id === 'function' && this._ignoringApps.has(app.get_id())) {
                    isRunning = false;
                }

                const appBox = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER
                });
                appBox.set_vertical(!isVerticalDock);
                appBox.set_pivot_point(0.5, 0.5);

                const actualMaxZoom = hoverZoom ? (1.0 + (zoomFactor - 1.0) * 2.0) : 1.0;
                const renderSize = Math.ceil(iconSize * actualMaxZoom);
                const icon = app.create_icon_texture(renderSize);
                icon.set_size(iconSize, iconSize);

                const iconBin = new St.Bin({
                    child: icon, width: iconSize, height: iconSize,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER
                });
                iconBin.set_pivot_point(0.5, 0.5);

                if (isRunning && showIndicators) {
                    const indProps = this._getIndicatorProps();
                    const indStyle = this.settings.get_string('indicator-style') || 'dot';
                    const numDots = (activeWindows.length > 1 && (indStyle === 'dot' || indStyle === 'square')) ? 2 : 1;

                    const dotBox = new St.BoxLayout({
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER
                    });
                    dotBox.set_vertical(isVerticalDock);
                    dotBox._isIndicator = true;
                    dotBox.set_style(`${indProps.marginStr} spacing: 4px;`);

                    for (let i = 0; i < numDots; i++) {
                        const dot = new St.Widget({
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER
                        });
                        dot.set_size(indProps.dw, indProps.dh);
                        dot.set_style(indProps.style);
                        dotBox.add_child(dot);
                    }

                    if (this.dockPosition === 'BOTTOM' || this.dockPosition === 'RIGHT') {
                        appBox.add_child(iconBin); appBox.add_child(dotBox);
                    } else {
                        appBox.add_child(dotBox); appBox.add_child(iconBin);
                    }
                } else {
                    appBox.add_child(iconBin);
                }

                const btn = new St.Bin({
                    child: appBox, style_class: 'dock-app-button',
                    reactive: true, track_hover: true, can_focus: false
                });
                btn.set_pivot_point(0.5, 0.5);

                btn._delegate = { app: app };

                setupDragAndDrop(btn, app, this);
                if (hoverZoom) applyIconFilter(btn);

                btn.connect('button-press-event', (_actor, event) => {
                    if (this._activeContextMenu) return Clutter.EVENT_STOP;

                    if (event.get_button() === 1) {
                        this.actor._lastIconClickTime = Date.now();
                    }
                    const [px, py] = event.get_coords();
                    btn._pressX = px; btn._pressY = py;
                    return Clutter.EVENT_PROPAGATE;
                });

                btn._activateCallback = (buttonNum, state = 0) => {
                    const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
                    if (buttonNum === 1) {
                        Main.overview.hide();
                        const windows = app.get_windows();
                        const focusWin = global.display.get_focus_window();
                        const activeWin = windows.find(w => w === focusWin);

                        animateIconClick(iconBin, this.settings.get_string('click-effect'));

                        if (activeWin) animateMinimize(activeWin, btn, this.dockPosition);
                        else if (windows[0]) animateRestore(windows[0], btn, this.dockPosition);
                        else {
                            this.actor._launchingApp = true;

                            if (this._launchTimeoutId) GLib.source_remove(this._launchTimeoutId);
                            this._launchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                                this.actor._launchingApp = false;
                                this._launchTimeoutId = null;
                                return GLib.SOURCE_REMOVE;
                            });

                            app.activate();

                            if (!this._pendingLaunches) this._pendingLaunches = [];
                            const pid = app.get_id();
                            this._pendingLaunches.push({ appId: pid, btn: btn });

                            if (!this._pendingLaunchTimeouts) this._pendingLaunchTimeouts = [];
                            const pidTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
                                if (this._pendingLaunches) {
                                    this._pendingLaunches = this._pendingLaunches.filter(p => p.appId !== pid);
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                            this._pendingLaunchTimeouts.push(pidTimeout);
                        }
                    } else if (buttonNum === 3) {
                        new AppContextMenu(this, app, btn, isCtrl, this.openPrefsCallback).show(this.dockPosition);
                    }
                };

                btn.connect('button-release-event', (_actor, event) => {
                    if (this._activeContextMenu) {
                        this._activeContextMenu.hide();
                        return Clutter.EVENT_STOP;
                    }

                    const button = event.get_button();
                    const state = event.get_state();

                    if (this.settings.get_boolean('lock-icons')) {
                        const [rx, ry] = event.get_coords();
                        const dx = Math.abs(rx - (btn._pressX || rx));
                        const dy = Math.abs(ry - (btn._pressY || ry));
                        if (dx > 10 || dy > 10) return Clutter.EVENT_STOP;
                    }

                    if (button === 1) {
                        if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
                        this.actor._lastIconClickTime = Date.now();
                        btn._activateCallback(1, state);
                        return Clutter.EVENT_STOP;
                    }
                    if (button === 3) { btn._activateCallback(3, state); return Clutter.EVENT_STOP; }
                    return Clutter.EVENT_PROPAGATE;
                });

                ScrollManager.setupAppScroll(btn, () => WorkspaceFilter.filterWindows(app.get_windows(), this.settings), this.settings);

                appButtons.push(btn);
            });

            const mods = buildModules(this, iconSize);
            const systemModules = mods.systemModules || [];
            const clockModule = mods.clockModule || null;

            let gridBtn = null;
            if (this.settings.get_boolean('show-grid-button')) {
                const gridIconSize = Math.floor(iconSize * 1.35);
                const gridIcon = new St.Icon({
                    icon_name: 'view-app-grid-symbolic',
                    icon_size: gridIconSize,
                    style_class: 'dock-grid-icon'
                });
                gridIcon.set_pivot_point(0.5, 0.5);

                const gridIconBin = new St.Bin({
                    child: gridIcon, width: iconSize, height: iconSize,
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER
                });
                gridIconBin.set_pivot_point(0.5, 0.5);

                gridBtn = new St.Bin({
                    child: gridIconBin, style_class: 'dock-app-button',
                    reactive: true, track_hover: true, can_focus: false
                });
                gridBtn.set_pivot_point(0.5, 0.5);
                if (hoverZoom) applyIconFilter(gridBtn);

                gridBtn._activateCallback = (buttonNum) => {
                    if (buttonNum === 1) {
                        animateIconClick(gridIconBin, this.settings.get_string('click-effect'));
                        this.appGridUI.toggle(this.dockPosition);
                        if (this.appGridUI.isOpen) {
                            resetMagnification(this.actor);

                            try {
                                gridBtn.remove_style_pseudo_class('hover');
                                gridBtn.track_hover = false;
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                                    if (gridBtn) {
                                        gridBtn.track_hover = true;
                                        gridBtn.sync_hover();
                                    }
                                    return GLib.SOURCE_REMOVE;
                                });
                            } catch (e) { }
                        }
                    }
                };

                gridBtn.connect('button-press-event', (_actor, event) => {
                    if (this._activeContextMenu) return Clutter.EVENT_STOP;
                    return Clutter.EVENT_PROPAGATE;
                });

                gridBtn.connect('button-release-event', (_actor, event) => {
                    if (this._activeContextMenu) {
                        this._activeContextMenu.hide();
                        return Clutter.EVENT_STOP;
                    }

                    if (event.get_button() === 1) {
                        if (this.actor._lastIconClickTime !== undefined) this.actor._lastIconClickTime = Date.now();
                        gridBtn._activateCallback(1);
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                });

                this.gridBtn = gridBtn;

                this.gridBtn._delegate = {
                    app: {
                        is_module: true,
                        get_id: () => 'dhruva-grid-button',
                        get_name: () => 'Applications',
                        get_state: () => 0,
                        get_windows: () => [],
                    }
                };
            }

            const createSeparator = (isFull = false) => {
                const sep = new St.Widget({ style_class: 'dock-separator' });

                if (isVerticalDock) {
                    sep.set_style(`height: 1px; background-color: rgba(255,255,255,0.25); border-radius: 1px; margin: 4px 0;`);
                    sep.set_x_align(Clutter.ActorAlign.FILL);
                    sep.set_x_expand(true);
                } else {
                    sep.set_style(`width: 1px; background-color: rgba(255,255,255,0.25); border-radius: 1px; margin: 0 4px;`);
                    sep.set_y_align(Clutter.ActorAlign.FILL);
                    sep.set_y_expand(true);
                }

                return sep;
            };

            const startComponents = [];
            const endComponents = [];

            let gridPos = 'END';
            try { gridPos = this.settings.get_string('grid-button-position'); } catch (e) { }

            let clockPos = 'END';
            try { clockPos = this.settings.get_string('clock-position'); } catch (e) { }

            if (clockModule && clockPos === 'START') {
                startComponents.push(clockModule);
                startComponents.push(createSeparator(true));
            }

            if (gridPos === 'START') {
                if (gridBtn && !isFullWidth) startComponents.push(gridBtn);
                systemModules.forEach(m => startComponents.push(m));
                if ((gridBtn && !isFullWidth) || systemModules.length > 0) {
                    startComponents.push(createSeparator(false));
                }
            }

            if (gridPos !== 'START') {
                if ((gridBtn && !isFullWidth) || systemModules.length > 0) {
                    endComponents.push(createSeparator(false));
                }
                systemModules.forEach(m => endComponents.push(m));
                if (gridBtn && !isFullWidth) endComponents.push(gridBtn);
            }

            if (clockModule && clockPos !== 'START') {
                endComponents.push(createSeparator(true));
                endComponents.push(clockModule);
            }

            const applyOldVisuals = (c) => {
                let cid = null;
                if (c._delegate?.app?.get_id) cid = c._delegate.app.get_id();
                else if (c.has_style_class_name?.('clock-module')) cid = 'dhruva-clock';
                else if (c.get_child?.()?.has_style_class_name?.('dock-grid-icon')) cid = 'dhruva-grid-button';

                if (cid && oldVisuals.has(cid)) {
                    let v = oldVisuals.get(cid);
                    c.scale_x = v.sx;
                    c.scale_y = v.sy;
                    c.translation_x = v.tx;
                    c.translation_y = v.ty;

                    const appBox = c.get_child?.();
                    if (appBox && typeof appBox.get_children === 'function') {
                        appBox.get_children().forEach(child => {
                            if (child._isIndicator) {
                                child.set_pivot_point(0.5, 0.5);
                                child.scale_x = 1.0 / v.sx;
                                child.scale_y = 1.0 / v.sy;
                            }
                        });
                    }
                }
            };

            startComponents.forEach(c => { applyOldVisuals(c); this.boxActor.add_child(c); });
            appButtons.forEach(c => { applyOldVisuals(c); this.boxActor.add_child(c); });
            endComponents.forEach(c => { applyOldVisuals(c); this.boxActor.add_child(c); });

            if (isFullWidth && this.gridBtn) {
                applyOldVisuals(this.gridBtn);
                this.actor.add_child(this.gridBtn);
            }

            if (hoverZoom || showTooltips) {
                setupMagnification(this.actor, this.settings, () => this.dockPosition);

                global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    if (this._isDestroyed || !this.actor || !this.boxActor) return false;
                    if (!this.actor.is_mapped()) return false;
                    try {
                        this.actor._fixedSlots = null;
                        const [cx, cy] = global.get_pointer();
                        const [ax, ay] = this.actor.get_transformed_position();

                        const hoverZoom = this.settings.get_boolean('hover-zoom');
                        const maxZoom = hoverZoom ? this.settings.get_double('hover-zoom-factor') : 1.0;
                        const actualMax = 1.0 + (maxZoom - 1.0) * 2.0;
                        const overflow = this.settings.get_int('icon-size') * actualMax;

                        const padX = isVerticalDock ? 25 : Math.max(25, overflow);
                        const padY = isVerticalDock ? Math.max(25, overflow) : 25;

                        if (cx >= ax - padX && cx <= ax + this.actor.width + padX &&
                            cy >= ay - padY && cy <= ay + this.actor.height + padY) {
                            applyRealtimeFrame(this.actor, cx, cy, isVerticalDock, this.settings, Date.now());
                        } else {
                            resetMagnification(this.actor);
                        }
                    } catch (e) { }
                    return false;
                });
            } else {
                teardownMagnification(this.actor);
            }

            this._applyDynamicStyles();
            this._updateLayout();

            if (this.appGridUI && this.appGridUI.isOpen) {
                this.appGridUI.updateButtonStates();
            }
        } catch (e) { }
    }

    show() {
        Main.layoutManager.addChrome(this.actor, { affectsStruts: false, trackFullscreen: true });

        this._mappedSignalId = this.actor.connect('notify::mapped', () => {
            if (!this.actor.is_mapped()) return;
            if (this._mappedSignalId) {
                this.actor.disconnect(this._mappedSignalId);
                this._mappedSignalId = null;
            }
            if (!this._isDestroyed) {
                this._renderDock();
                if (this.dockManager) this.dockManager.updatePosition();
            }
        });

        this._monitorId = global.display.connect('workareas-changed', () => {
            if (this._isDestroyed) return;
            if (this.dockManager) this.dockManager.updatePosition();
            if (this.autoHideManager) this.autoHideManager._updateEdgeTrigger();
        });

        this._overviewShowingId = Main.overview.connect('showing', () => {
            if (this.actor) this.actor.hide();
        });
        this._overviewHidingId = Main.overview.connect('hiding', () => {
            if (this.actor) this.actor.show();
        });

        setupWindowEffects(this.settings);
        this.autoHideManager = new AutoHideManager(this, this.settings);
    }

    destroy() {
        this._isDestroyed = true;
        if (this.actor) this.actor._isDestroyed = true;

        if (this.queueRender?.cancel) this.queueRender.cancel();

        try {
            this.settingsSignals.forEach(id => this.settings.disconnect(id));
            this.settingsSignals = [];

            this.appSystemSignals.forEach(id => this.appManager.appSystem.disconnect(id));
            this.appSystemSignals = [];

            this.displaySignals.forEach(id => global.display.disconnect(id));
            this.displaySignals = [];

            if (this.wmSignals) {
                this.wmSignals.forEach(id => global.window_manager.disconnect(id));
                this.wmSignals = [];
            }

            if (this.workspaceSignals) {
                this.workspaceSignals.forEach(id => global.workspace_manager.disconnect(id));
                this.workspaceSignals = [];
            }

            if (this._allocIdleId) { GLib.source_remove(this._allocIdleId); this._allocIdleId = null; }

            if (this._delayedRenderId) { GLib.source_remove(this._delayedRenderId); this._delayedRenderId = null; }
            if (this._launchGuardId) { GLib.source_remove(this._launchGuardId); this._launchGuardId = null; }
            if (this._pendingCleanupId) { GLib.source_remove(this._pendingCleanupId); this._pendingCleanupId = null; }
            if (this._folderLaunchTimerId) { GLib.source_remove(this._folderLaunchTimerId); this._folderLaunchTimerId = null; }
            if (this._postDragSettleId) { GLib.source_remove(this._postDragSettleId); this._postDragSettleId = null; }

            if (this._ignoreAppTimers) {
                this._ignoreAppTimers.forEach(id => GLib.source_remove(id));
                this._ignoreAppTimers = [];
            }

            try { if (this.floatManager) { this.floatManager.destroy(); this.floatManager = null; } } catch (e) { }

            cleanupTrashEffects();

            try { teardownWindowEffects(); } catch (e) { }
            try { teardownMagnification(this.actor); } catch (e) { }
            try { if (this.dockManager) this.dockManager.destroy(); } catch (e) { }

            if (this._launchTimeoutId) { GLib.source_remove(this._launchTimeoutId); this._launchTimeoutId = null; }

            if (this._pendingLaunchTimeouts) {
                this._pendingLaunchTimeouts.forEach(id => GLib.source_remove(id));
                this._pendingLaunchTimeouts = [];
            }

            if (this._folderTimeouts) {
                this._folderTimeouts.forEach(id => GLib.source_remove(id));
                this._folderTimeouts = [];
            }

            this._pendingRender = false;

            try { if (this.autoHideManager) { this.autoHideManager.destroy(); this.autoHideManager = null; } } catch (e) { }
            if (this._monitorId) global.display.disconnect(this._monitorId);
            if (this._overviewShowingId) { Main.overview.disconnect(this._overviewShowingId); this._overviewShowingId = null; }
            if (this._overviewHidingId) { Main.overview.disconnect(this._overviewHidingId); this._overviewHidingId = null; }
            try { if (this.appGridUI) this.appGridUI.destroy(); } catch (e) { }

            if (this._bgSettings && this._bgSignalId) {
                try { this._bgSettings.disconnect(this._bgSignalId); } catch (e) { }
                this._bgSettings = null;
                this._bgSignalId = null;
            }

            if (this._bgSettings && this._bgSignalId2) {
                try { this._bgSettings.disconnect(this._bgSignalId2); } catch (e) { }
                this._bgSignalId2 = null;
            }

            if (this.actor) {
                if (this._mappedSignalId) {
                    try { this.actor.disconnect(this._mappedSignalId); } catch (e) { }
                    this._mappedSignalId = null;
                }
                try { Main.layoutManager.removeChrome(this.actor); } catch (e) { }
                try { this.actor.destroy(); } catch (e) { }
            }
        } catch (e) { }
    }
}