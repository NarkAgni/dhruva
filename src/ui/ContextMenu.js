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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import PeekManager from '../core/PeekManager.js';
import {
    animateMinimize,
    animateRestore
} from './effects/WindowEffects.js';
import {
    resetMagnification,
    applyRealtimeFrame,
    setMagnifierPauseState
} from './Magnifier.js';


function traceMenuPath(cr, w, h, r, ah, aw, dockPos, ax, ay) {
    ax = Math.max(r + aw / 2, Math.min(ax, w - r - aw / 2));
    ay = Math.max(r + aw / 2, Math.min(ay, h - r - aw / 2));

    cr.newPath();
    if (dockPos === 'BOTTOM') {
        cr.moveTo(r, 0);
        cr.lineTo(w - r, 0);
        cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - ah - r);
        cr.arc(w - r, h - ah - r, r, 0, Math.PI / 2);
        cr.lineTo(ax + aw / 2, h - ah);
        cr.lineTo(ax + 2, h - 2);
        cr.curveTo(ax, h, ax, h, ax - 2, h - 2);
        cr.lineTo(ax - aw / 2, h - ah);
        cr.lineTo(r, h - ah);
        cr.arc(r, h - ah - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, r);
        cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'TOP') {
        cr.moveTo(r, ah);
        cr.lineTo(ax - aw / 2, ah);
        cr.lineTo(ax - 2, 2);
        cr.curveTo(ax, 0, ax, 0, ax + 2, 2);
        cr.lineTo(ax + aw / 2, ah);
        cr.lineTo(w - r, ah);
        cr.arc(w - r, ah + r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r);
        cr.arc(w - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(r, h);
        cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, ah + r);
        cr.arc(r, ah + r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'RIGHT') {
        cr.moveTo(r, 0);
        cr.lineTo(w - ah - r, 0);
        cr.arc(w - ah - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w - ah, ay - aw / 2);
        cr.lineTo(w - 2, ay - 2);
        cr.curveTo(w, ay, w, ay, w - 2, ay + 2);
        cr.lineTo(w - ah, ay + aw / 2);
        cr.lineTo(w - ah, h - r);
        cr.arc(w - ah - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(r, h);
        cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, r);
        cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'LEFT') {
        cr.moveTo(ah + r, 0);
        cr.lineTo(w - r, 0);
        cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r);
        cr.arc(w - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(ah + r, h);
        cr.arc(ah + r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(ah, ay + aw / 2);
        cr.lineTo(2, ay + 2);
        cr.curveTo(0, ay, 0, ay, 2, ay - 2);
        cr.lineTo(ah, ay - aw / 2);
        cr.lineTo(ah, r);
        cr.arc(ah + r, r, r, Math.PI, 3 * Math.PI / 2);
    }
    cr.closePath();
}

export default class AppContextMenu {
    constructor(dockUI, app, buttonActor, isCtrlPressed = false, openPrefsCallback = null, disablePeek = false) {
        this.dockUI = dockUI;
        this.appManager = dockUI.appManager;
        this.app = app;
        this.buttonActor = buttonActor;
        this.isCtrlPressed = isCtrlPressed;
        this.openPrefsCallback = openPrefsCallback;

        this._isHiding = false;
        this._dynamicPanelWidth = 280;
        this._previousFocus = global.stage.get_key_focus();

        this.actor = new St.Widget({
            style_class: 'context-menu-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true
        });

        global.stage.set_key_focus(null);

        this.actor.connect('button-release-event', () => {
            this.hide();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('touch-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.TOUCH_END) this.hide();
            return Clutter.EVENT_STOP;
        });

        if (!disablePeek) {
            this.peekManager = new PeekManager(this.dockUI, this.actor);
        }

        this.menuContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            style: 'background-color: transparent;'
        });
        this.bgDrawingArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            style: 'background-color: transparent;'
        });
        this.menuContainer.add_child(this.bgDrawingArea);

        this.panel = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style_class: 'context-menu-panel',
            style: 'background-color: transparent; border: none; box-shadow: none;'
        });
        this.panel.connect('button-release-event', () => Clutter.EVENT_STOP);
        this.panel.connect('touch-event', () => Clutter.EVENT_STOP);

        this.menuContainer.add_child(this.panel);

        this._applyThemeStyle(this.panel);
        this._buildMenu();
        this.actor.add_child(this.menuContainer);
    }

    _buildMenu() {

        if (!this.app && this.buttonActor && this.buttonActor._isFolder) {
            const fData = this.buttonActor._folderData;


            const titleBox = new St.BoxLayout({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'context-menu-header-box'
            });
            titleBox.add_child(new St.Label({
                text: fData.name,
                style_class: 'context-menu-header-title'
            }));
            this.panel.add_child(titleBox);
            this._addSeparator();

            this.panel.add_child(this._createIconMenuItem('Unpack Stack', () => {
                fData.apps.forEach(appId => this.dockUI.appManager.favManager.addFavorite(appId));
                this.dockUI.folderManager.deleteFolder(fData.id);
                this.dockUI.queueRender();
                this.hide();
            }));

            this.panel.add_child(this._createIconMenuItem('Close All Apps', () => {
                fData.apps.forEach(appId => {
                    const a = this.dockUI.appManager.appSystem.lookup_app(appId);
                    if (a) a.request_quit();
                });
                this.hide();
            }));

            this._addSeparator();

            this.panel.add_child(this._createIconMenuItem(`Delete ${fData.name}`, () => {
                this.dockUI.folderManager.deleteFolder(fData.id);
                this.dockUI.queueRender();
                this.hide();
            }, true));

            return;
        }


        if (!this.app) return;


        const titleBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'context-menu-header-box'
        });
        titleBox.add_child(new St.Label({
            text: this.app.get_name(),
            style_class: 'context-menu-header-title'
        }));
        this.panel.add_child(titleBox);
        this._addSeparator();

        let windows = this.app.get_windows();

        if (windows.length > 0) {
            const customSize = this.dockUI.settings.get_int('context-menu-size');
            const thumbSpacing = 12,
                panelPadding = 24;

            this._dynamicPanelWidth = Math.max(200, (windows.length === 1 ? customSize : (customSize * 2) + thumbSpacing) + panelPadding + 16);

            const thumbScroll = new St.ScrollView({
                vscrollbar_policy: St.PolicyType.NEVER,
                hscrollbar_policy: windows.length > 2 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
                enable_mouse_scrolling: true,
                overlay_scrollbars: true,
                style_class: 'context-menu-thumb-scroll'
            });

            thumbScroll.connect('scroll-event', (actor, event) => {
                let [dx, dy] = event.get_scroll_direction() === Clutter.ScrollDirection.SMOOTH ? event.get_scroll_delta() : [0, 0];
                const direction = event.get_scroll_direction();

                if (direction === Clutter.ScrollDirection.UP) dy = -1;
                else if (direction === Clutter.ScrollDirection.DOWN) dy = 1;
                else if (direction === Clutter.ScrollDirection.LEFT) dx = -1;
                else if (direction === Clutter.ScrollDirection.RIGHT) dx = 1;

                if (Math.abs(dy) > Math.abs(dx) && dy !== 0) {
                    dx = dy;
                    dy = 0;
                }

                if (dx !== 0) {
                    const adjustment = typeof thumbScroll.get_hadjustment === 'function' ? thumbScroll.get_hadjustment() : thumbScroll.get_hscroll_bar().get_adjustment();
                    if (adjustment) {
                        const step = direction === Clutter.ScrollDirection.SMOOTH ? dx * 40 : dx * 50;
                        let newVal = Math.min(Math.max(adjustment.get_value() + step, adjustment.get_lower()), adjustment.get_upper() - adjustment.get_page_size());
                        adjustment.set_value(newVal);
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            const thumbBox = new St.BoxLayout({
                vertical: false,
                reactive: true,
                style_class: 'context-menu-thumb-box',
                style: `spacing: ${thumbSpacing}px;`
            });
            if (windows.length <= 2) thumbBox.x_align = Clutter.ActorAlign.CENTER;

            windows.forEach(win => {
                const card = new St.Widget({
                    layout_manager: new Clutter.BinLayout(),
                    reactive: true
                });
                const thumbBtn = new St.Button({
                    reactive: true,
                    x_expand: true,
                    y_expand: true,
                    style_class: 'context-menu-thumb-btn'
                });

                const compPrivate = win.get_compositor_private();
                if (compPrivate) {
                    const clone = new Clutter.Clone({
                        source: compPrivate,
                        reactive: false
                    });
                    const rect = win.get_frame_rect();
                    const w = Math.max(1, rect.width || 1),
                        h = Math.max(1, rect.height || 1);

                    let thumbW = customSize,
                        thumbH = (h / w) * thumbW;
                    if (thumbH > customSize * 0.8) {
                        thumbH = customSize * 0.8;
                        thumbW = (w / h) * thumbH;
                    }

                    clone.set_size(thumbW, thumbH);
                    thumbBtn.set_child(new St.Bin({
                        child: clone,
                        style: 'border-radius: 6px; overflow: hidden;'
                    }));
                }

                let winTitleText = win.get_title() || 'Window';
                if (winTitleText.length > 20) winTitleText = winTitleText.substring(0, 18) + '...';

                const titleLbl = new St.Label({
                    text: winTitleText,
                    style_class: 'context-menu-thumb-title',
                    reactive: false
                });
                const labelBin = new St.Bin({
                    child: titleLbl,
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.END,
                    x_expand: true,
                    y_expand: true,
                    style_class: 'context-menu-thumb-title-bin'
                });
                const controlsBox = new St.BoxLayout({
                    vertical: false,
                    opacity: 0,
                    reactive: true,
                    style_class: 'context-menu-controls-box'
                });

                if (!win.minimized) {
                    controlsBox.add_child(this._createWindowControl('window-minimize-symbolic', '255, 189, 46', () => {
                        this.hide();
                        animateMinimize(win, this.buttonActor, this.dockUI.dockPosition);
                    }));
                }

                const isMaximized = typeof win.is_maximized === 'function' ? win.is_maximized() : false;
                controlsBox.add_child(this._createWindowControl(win.minimized ? 'view-fullscreen-symbolic' : (isMaximized ? 'window-restore-symbolic' : 'window-maximize-symbolic'), '40, 201, 64', () => {
                    this._previousFocus = null;
                    this.hide();
                    win.activate(global.get_current_time());

                    if (win.minimized) {
                        animateRestore(win, this.buttonActor, this.dockUI.dockPosition);
                        Main.activateWindow(win);
                    } else if (isMaximized) {
                        Main.activateWindow(win);
                        win.unmaximize();
                    } else {
                        Main.activateWindow(win);
                        win.maximize();
                    }
                }));

                controlsBox.add_child(this._createWindowControl('window-close-symbolic', '255, 59, 48', () => {
                    if (!windows.includes(win)) return;
                    win.delete(global.get_current_time());
                    card.ease({
                        scale_x: 0,
                        scale_y: 0,
                        opacity: 0,
                        duration: 200,
                        onComplete: () => {
                            if (card) card.destroy();
                        }
                    });
                    windows = windows.filter(w => w !== win);

                    if (this.peekManager) this.peekManager.stopPeek();

                    if (windows.length === 0) {
                        this._addAppToIgnoreList(this.app);
                        if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = 0;
                        this.dockUI._renderDock();
                        this.hide();
                    }
                }));

                const controlsBin = new St.Bin({
                    child: controlsBox,
                    x_align: Clutter.ActorAlign.END,
                    y_align: Clutter.ActorAlign.START,
                    x_expand: true,
                    y_expand: true
                });

                card.add_child(thumbBtn);
                card.add_child(labelBin);
                card.add_child(controlsBin);

                card.connect('enter-event', () => {
                    controlsBox.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK
                    });
                    titleLbl.ease({
                        opacity: 0,
                        duration: 150
                    });
                    thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.6); transition-duration: 150ms;');

                    if (this.peekManager) this.peekManager.startPeek(win);

                    return Clutter.EVENT_PROPAGATE;
                });

                card.connect('leave-event', () => {
                    controlsBox.ease({
                        opacity: 0,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD
                    });
                    titleLbl.ease({
                        opacity: 255,
                        duration: 150
                    });
                    thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms;');

                    if (this.peekManager) this.peekManager.stopPeek();

                    return Clutter.EVENT_PROPAGATE;
                });

                thumbBtn.connect('clicked', () => {
                    this._previousFocus = null;
                    if (win.minimized) animateRestore(win, this.buttonActor, this.dockUI.dockPosition);
                    win.activate(global.get_current_time());
                    Main.activateWindow(win);
                    this.hide();
                });

                thumbBox.add_child(card);
            });

            thumbScroll.add_child(thumbBox);
            this.panel.add_child(thumbScroll);
            this._addSeparator();
        } else {
            this._dynamicPanelWidth = 220;
        }

        if (this.buttonActor && !this.buttonActor._inFolder && this.dockUI.folderManager && !this.app.is_module) {
            const folders = this.dockUI.folderManager.getFolders();
            let addedFolder = false;
            folders.forEach(f => {
                if (!f.apps.includes(this.app.get_id())) {
                    let btn = this._createIconMenuItem(`Add to ${f.name}`, () => {
                        this.dockUI.folderManager.addAppToFolder(f.id, this.app.get_id());
                        this.dockUI.queueRender();
                        this.hide();
                    });

                    btn.set_style('transition-duration: 150ms; border-radius: 6px;');
                    let label = btn.get_child().get_first_child();
                    label.set_style('color: #0fb55e; font-weight: 700;');

                    btn.connect('notify::hover', () => {
                        btn.set_style(btn.hover ? 'background-color: rgba(15, 181, 94, 0.15); transition-duration: 150ms; border-radius: 6px;' : 'background-color: transparent; transition-duration: 150ms; border-radius: 6px;');
                    });

                    this.panel.add_child(btn);
                    addedFolder = true;
                }
            });
            if (addedFolder) this._addSeparator();
        }

        if (this.app.is_module && typeof this.app.open === 'function') {
            this.panel.add_child(this._createMenuItem(`Open ${this.app.get_name()}`, () => {
                this.app.open();
                this.hide();
            }));
            this._addSeparator();
        }

        if ((typeof this.app.get_id === 'function' ? this.app.get_id() : '') === 'dhruva-module-recycle-bin') {
            this._addTrashActions();
        }

        const appInfo = typeof this.app.get_app_info === 'function' ? this.app.get_app_info() : null;
        const actions = appInfo ? appInfo.list_actions() : [];
        let hasNewWindow = false;
        const quietContext = new Gio.AppLaunchContext();

        if (typeof this.app.can_open_new_window === 'function' && this.app.can_open_new_window()) {
            this.panel.add_child(this._createMenuItem('New Window', () => {
                if (appInfo) appInfo.launch([], quietContext);
                else this.app.open_new_window(-1);
                this.hide();
            }));
            hasNewWindow = true;
        }

        if (actions.length > 0) {
            actions.forEach(action => {
                if (action.toLowerCase().includes('new-window') && hasNewWindow) return;
                this.panel.add_child(this._createMenuItem(appInfo.get_action_name(action), () => {
                    appInfo.launch_action(action, quietContext);
                    this.hide();
                }));
            });
        }

        if (hasNewWindow || actions.length > 0) this._addSeparator();

        if (!this.app.is_module && typeof this.app.get_id === 'function' && (!this.buttonActor || !this.buttonActor._inFolder)) {
            const isPinned = this.appManager.hasApp(this.app);
            const pinLabel = isPinned ? 'Unpin from Dhruva' : 'Pin to Dhruva';
            this.panel.add_child(this._createMenuItem(pinLabel, () => {
                isPinned ? this.appManager.removeApp(this.app) : this.appManager.addApp(this.app);
                this.dockUI._renderDock();
                this.hide();
            }));
        }

        if (this.buttonActor && this.buttonActor._inFolder) {
            this.panel.add_child(this._createIconMenuItem(`Remove from ${this.buttonActor._folderName || 'Stack'}`, () => {
                this.dockUI.folderManager.removeAppFromFolder(this.buttonActor._folderId, this.app.get_id());
                if (this.buttonActor.get_parent()) this.buttonActor.destroy();
                this.dockUI.queueRender();
                this.hide();
            }, true));
        }

        if (this.app.get_state() === Shell.AppState.RUNNING) {
            this._addSeparator();
            this.panel.add_child(this._createMenuItem(windows.length > 1 ? 'Close All Windows' : (this.app.is_module ? 'Close Folder' : 'Quit'), () => {
                this._addAppToIgnoreList(this.app);
                if (typeof this.app.request_quit === 'function') this.app.request_quit();
                if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = 0;
                this.dockUI._renderDock();
                this.hide();
            }, true));
        }

        if (this.isCtrlPressed && this.openPrefsCallback) {
            this._addSeparator();
            this.panel.add_child(this._createMenuItem('Dhruva Settings', () => {
                this.hide();
                this.openPrefsCallback();
            }));
        }
    }

    _createIconMenuItem(text, onClick, isDestructive = false) {

        const btn = new St.Button({
            reactive: true,
            x_expand: true,
            style_class: isDestructive ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn'
        });


        const box = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 12px;',
            y_align: Clutter.ActorAlign.CENTER
        });
        box.add_child(new St.Label({
            text: text,
            style_class: isDestructive ? 'context-menu-action-label-destructive' : 'context-menu-action-label',
            y_align: Clutter.ActorAlign.CENTER
        }));

        btn.set_child(box);
        btn.connect('clicked', onClick);
        return btn;
    }

    _addAppToIgnoreList(app) {
        if (!this.dockUI || typeof app.get_id !== 'function') return;
        const appId = app.get_id();

        if (!this.dockUI._ignoringApps) this.dockUI._ignoringApps = new Set();
        this.dockUI._ignoringApps.add(appId);

        if (!this.dockUI._ignoreAppTimers) this.dockUI._ignoreAppTimers = [];

        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            if (this.dockUI?._ignoringApps) this.dockUI._ignoringApps.delete(appId);
            if (this.dockUI?._ignoreAppTimers) this.dockUI._ignoreAppTimers = this.dockUI._ignoreAppTimers.filter(id => id !== timerId);
            return GLib.SOURCE_REMOVE;
        });
        this.dockUI._ignoreAppTimers.push(timerId);
    }

    _applyThemeStyle(panel) {
        if (!this.dockUI?.settings) return;
        const settings = this.dockUI.settings;
        const themeId = settings.get_string('dock-theme') || 'default';
        const opacity = settings.get_int('background-opacity') / 100.0;
        const sWidth = settings.get_int('stroke-width');
        const sColor = settings.get_string('stroke-color') || '#ffffff';
        const sOpacity = settings.get_int('stroke-opacity') / 100.0;

        const _hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16),
                g = parseInt(hex.slice(3, 5), 16),
                b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        let bgRgba = _hexToRgba(settings.get_string('background-color') || '#000000', opacity);


        if (themeId === 'chameleon') {
            const {
                r,
                g,
                b
            } = this.dockUI._chameleonColor?.bg || {
                r: 30,
                g: 30,
                b: 45
            };
            bgRgba = `rgba(${r}, ${g}, ${b}, 0.88)`;
        } else if (this.dockUI.actor._tooltipBg) {
            let css = this.dockUI.actor._tooltipBg;

            let match = css.match(/background-gradient-start:\s*(rgba?\([^)]+\))/);
            if (!match) match = css.match(/background-color:\s*(rgba?\([^)]+\))/);

            if (match) {
                let color = match[1];
                if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {

                    let allColors = css.match(/rgba?\([^)]+\)/g);
                    if (allColors) {
                        bgRgba = allColors.find(c => c !== 'rgba(0, 0, 0, 0)' && c.replace(/\s/g, '') !== 'rgba(0,0,0,0)') || bgRgba;
                    }
                } else {
                    bgRgba = color;
                }
            }
        }

        panel.set_style(`background-color: transparent; border: none;`);
        this.bgDrawingArea._bgRgba = bgRgba;
        this.bgDrawingArea._strokeRgba = sWidth > 0 ? _hexToRgba(sColor, sOpacity) : 'transparent';
        this.bgDrawingArea._sWidth = sWidth;

        this.bgDrawingArea.connect('repaint', (area) => {
            if (!this._dockPos) return;
            const cr = area.get_context();
            const [fullW, fullH] = area.get_surface_size();
            const r = 18;
            const ah = 12;
            const aw = 24;
            const sw = area._sWidth || 0;
            const half = sw / 2;
            const w = fullW - sw;
            const h = fullH - sw;

            let ax = (area._arrowCenter || fullW / 2) - half;
            let ay = (area._arrowCenter || fullH / 2) - half;

            const parseRgba = (str) => {
                let m = (str || '').match(/[\d.]+/g);
                return m ? m.map(Number) : [0, 0, 0, 0];
            };

            cr.save();
            cr.setOperator(cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();
            cr.translate(half, half);
            traceMenuPath(cr, w, h, r, ah, aw, this._dockPos, ax, ay);

            const [br, bg, bb, ba] = parseRgba(area._bgRgba);
            cr.setSourceRGBA(br / 255, bg / 255, bb / 255, ba);
            cr.fillPreserve();

            if (sw > 0) {
                const [sr, sg, sb, sa] = parseRgba(area._strokeRgba);
                cr.setSourceRGBA(sr / 255, sg / 255, sb / 255, sa);
                cr.setLineWidth(sw);
                cr.setLineJoin(cairo.LineJoin.ROUND);
                cr.stroke();
            } else {
                cr.newPath();
            }
            cr.$dispose();
        });
    }

    _addTrashActions() {
        let trashHasItems = false;
        try {
            const trashDir = Gio.File.new_for_uri('trash:///');
            const iter = trashDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            trashHasItems = iter.next_file(null) !== null;
            iter.close(null);
        } catch (e) { }

        const emptyBtn = new St.Button({
            reactive: trashHasItems,
            x_expand: true,
            style_class: trashHasItems ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn'
        });
        const label = new St.Label({
            text: trashHasItems ? 'Empty Trash' : 'Trash is Empty',
            style_class: trashHasItems ? 'context-menu-action-label-destructive' : 'context-menu-action-label'
        });

        if (!trashHasItems) {
            emptyBtn.set_opacity(100);
            label.set_style('color: rgba(255,255,255,0.25);');
        }

        emptyBtn.set_child(label);

        if (trashHasItems) {
            emptyBtn.connect('clicked', () => {
                this.hide();
                try {
                    GLib.spawn_command_line_async('gio trash --empty');
                } catch (e) { }
            });
        }

        this.panel.add_child(emptyBtn);
        this._addSeparator();
    }

    _createWindowControl(iconName, rgbColor, onClick) {
        const btn = new St.Button({
            child: new St.Icon({
                icon_name: iconName,
                icon_size: 13,
                style: 'color: rgba(255,255,255,1.0);'
            }),
            style_class: 'context-menu-win-control-btn',
            style: `background-color: rgba(${rgbColor}, 0.40);`,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        btn.connect('clicked', onClick);
        btn.connect('enter-event', () => {
            btn.set_style(`background-color: rgba(${rgbColor}, 0.75); border-radius: 999px; width: 20px; height: 20px; border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 4px 10px rgba(0,0,0,0.45); transition-duration: 150ms;`);
            btn.ease({
                scale_x: 1.1,
                scale_y: 1.1,
                duration: 120
            });
            return Clutter.EVENT_PROPAGATE;
        });

        btn.connect('leave-event', () => {
            btn.set_style(`background-color: rgba(${rgbColor}, 0.40); border-radius: 999px; width: 20px; height: 20px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 2px 5px rgba(0,0,0,0.25); transition-duration: 150ms;`);
            btn.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 120
            });
            return Clutter.EVENT_PROPAGATE;
        });

        return btn;
    }

    _createMenuItem(text, onClick, isDestructive = false) {
        const btn = new St.Button({
            reactive: true,
            x_expand: true,
            style_class: isDestructive ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn'
        });
        btn.set_child(new St.Label({
            text,
            style_class: isDestructive ? 'context-menu-action-label-destructive' : 'context-menu-action-label'
        }));
        btn.connect('clicked', onClick);
        return btn;
    }

    _createCheckboxItem(text, isChecked, onClick) {
        const btn = new St.Button({
            reactive: true,
            x_expand: true,
            style_class: 'context-menu-action-btn'
        });
        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER
        });
        const checkbox = new St.Bin({
            style_class: isChecked ? 'context-menu-checkbox-box checked' : 'context-menu-checkbox-box'
        });

        if (isChecked) checkbox.set_child(new St.Icon({
            icon_name: 'object-select-symbolic',
            icon_size: 12,
            style: 'color: white; font-weight: bold;'
        }));

        box.add_child(checkbox);
        box.add_child(new St.Label({
            text,
            style_class: 'context-menu-action-label',
            y_align: Clutter.ActorAlign.CENTER
        }));
        btn.set_child(box);
        btn.connect('clicked', onClick);
        return btn;
    }

    _addSeparator() {
        this.panel.add_child(new St.Widget({
            style_class: 'context-menu-separator-line'
        }));
    }

    show(dockPosition) {
        this._dockPos = dockPosition;


        if (this.dockUI && this.dockUI.actor && typeof setMagnifierPauseState === 'function') {
            setMagnifierPauseState(this.dockUI.actor, 'context-menu', true);
        }


        if (this._showDelayId) GLib.source_remove(this._showDelayId);
        this._showDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._showDelayId = null;


            if (this._isHiding || !this.actor) return GLib.SOURCE_REMOVE;

            if (this.dockUI?._activeContextMenu && this.dockUI._activeContextMenu !== this) {
                this.dockUI._activeContextMenu._forceDestroy();
            }
            this.dockUI._activeContextMenu = this;

            Main.layoutManager.addChrome(this.actor, {
                affectsStruts: false
            });
            global.stage.set_key_focus(this.actor);
            this.actor.grab_key_focus();

            if (this.dockUI && this.dockUI.actor) {
                try {
                    const parent = this.actor.get_parent();

                    if (!this.peekManager) {
                        if (parent) parent.set_child_above_sibling(this.actor, null);
                    }
                    else {
                        const sibling = this.dockUI.actor;
                        const siblingParent = sibling?.get_parent?.();
                        if (parent && sibling && parent === siblingParent)
                            parent.set_child_below_sibling(this.actor, sibling);
                    }
                } catch (_e) { }
            }

            const {
                monitor
            } = this.dockUI.monitorManager.getCurrentMonitor();
            this.actor.set_position(0, 0);
            this.actor.set_size(global.stage.width, global.stage.height);

            const ah = 12;
            let padBottom = 12,
                padTop = 12,
                padLeft = 12,
                padRight = 12;
            if (dockPosition === 'BOTTOM') padBottom += ah;
            else if (dockPosition === 'TOP') padTop += ah;
            else if (dockPosition === 'LEFT') padLeft += ah;
            else if (dockPosition === 'RIGHT') padRight += ah;

            this.panel.set_style(`background-color: transparent; border: none; box-shadow: none; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`);
            this.panel.set_width(this._dynamicPanelWidth);

            const maxPanelHeight = monitor.height * 0.85;
            let [, panelH] = this.menuContainer.get_preferred_height(this._dynamicPanelWidth);
            if (panelH > maxPanelHeight) panelH = maxPanelHeight;


            const [btnX, btnY] = this.buttonActor.get_transformed_position();
            const [btnW, btnH] = this.buttonActor.get_transformed_size();

            let isInsideFolder = this.buttonActor && this.buttonActor._inFolder;
            let isAppGrid = !this.peekManager && !isInsideFolder;

            let gap = isInsideFolder ? -8 : (isAppGrid ? -8 : 22);

            let posX = btnX + (btnW / 2) - (this._dynamicPanelWidth / 2);
            let posY = btnY;

            if (dockPosition === 'BOTTOM') {
                posY = btnY - panelH - gap;
                this.menuContainer.set_pivot_point(0.5, 1.0);
            } else if (dockPosition === 'TOP') {
                posY = btnY + btnH + gap;
                this.menuContainer.set_pivot_point(0.5, 0.0);
            } else if (dockPosition === 'LEFT') {
                posX = btnX + btnW + gap;
                posY = btnY + (btnH / 2) - (panelH / 2);
                this.menuContainer.set_pivot_point(0.0, 0.5);
            } else if (dockPosition === 'RIGHT') {
                posX = btnX - this._dynamicPanelWidth - gap;
                posY = btnY + (btnH / 2) - (panelH / 2);
                this.menuContainer.set_pivot_point(1.0, 0.5);
            }

            if (posX < monitor.x + gap) posX = monitor.x + gap;
            if (posX + this._dynamicPanelWidth > monitor.x + monitor.width - gap) posX = monitor.x + monitor.width - this._dynamicPanelWidth - gap;
            if (dockPosition !== 'BOTTOM' && posY + panelH > monitor.y + monitor.height - gap) posY = monitor.y + monitor.height - panelH - gap;

            posX = Math.round(posX);
            posY = Math.round(posY);

            if (dockPosition === 'BOTTOM' || dockPosition === 'TOP') {
                this.bgDrawingArea._arrowCenter = Math.round((btnX + btnW / 2) - posX);
            } else {
                this.bgDrawingArea._arrowCenter = Math.round((btnY + btnH / 2) - posY);
            }
            this.bgDrawingArea.queue_repaint();

            this.menuContainer.set_position(posX, posY);
            
            this.menuContainer.opacity = 0;
            this.menuContainer.set_scale(0.95, 0.95);
            this.menuContainer.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    hide() {
        if (this._isHiding) return;
        this._isHiding = true;


        if (this._showDelayId) {
            GLib.source_remove(this._showDelayId);
            this._showDelayId = null;
        }

        if (this.dockUI && this.dockUI.actor && typeof setMagnifierPauseState === 'function') {
            setMagnifierPauseState(this.dockUI.actor, 'context-menu', false);
        }

        if (this.dockUI?._activeContextMenu === this) this.dockUI._activeContextMenu = null;
        if (this.peekManager) this.peekManager.stopPeek();

        if (this.dockUI?.actor) {
            const [px, py] = global.get_pointer();
            const [dx, dy] = this.dockUI.actor.get_transformed_position();
            const [dw, dh] = this.dockUI.actor.get_transformed_size();
            const pad = 15;
            const isInside = px >= dx - pad && px <= dx + dw + pad && py >= dy - pad && py <= dy + dh + pad;

            if (!isInside) resetMagnification(this.dockUI.actor);
            else {
                const isVertical = this.dockUI.dockPosition === 'LEFT' || this.dockUI.dockPosition === 'RIGHT';
                applyRealtimeFrame(this.dockUI.actor, px, py, isVertical, this.dockUI.settings, Date.now());
            }
        }

        if (this.menuContainer) {
            this.menuContainer.ease({
                opacity: 0,
                scale_x: 0.95,
                scale_y: 0.95,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this.actor && this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
                    if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null);
                    if (this.actor) this.actor.destroy();
                }
            });
        }
    }

    _forceDestroy() {
        if (this.dockUI && this.dockUI.actor && typeof setMagnifierPauseState === 'function') {
            setMagnifierPauseState(this.dockUI.actor, 'context-menu', false);
        }
        if (this.dockUI?._activeContextMenu === this) this.dockUI._activeContextMenu = null;
        if (this.peekManager) {
            this.peekManager.destroy();
            this.peekManager = null;
        }
        if (this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
        if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null);
        this.actor.destroy();
    }
}