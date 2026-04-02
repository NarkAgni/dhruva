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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import PeekManager from '../core/PeekManager.js';
import { resetMagnification, applyRealtimeFrame } from './Magnifier.js';
import { animateMinimize, animateRestore } from './effects/WindowEffects.js';


export default class AppContextMenu {
    constructor(dockUI, app, buttonActor, isCtrlPressed = false, openPrefsCallback = null) {
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

        this.peekManager = new PeekManager(this.dockUI, this.actor);

        this.panel = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style_class: 'context-menu-panel'
        });

        this.panel.connect('button-release-event', () => Clutter.EVENT_STOP);
        this.panel.connect('touch-event', () => Clutter.EVENT_STOP);

        this._applyChameleonPanelStyle(this.panel);
        this._buildMenu();
        this.actor.add_child(this.panel);
    }

    _buildMenu() {
        const titleBox = new St.BoxLayout({ 
            vertical: false, 
            x_align: Clutter.ActorAlign.CENTER, 
            y_align: Clutter.ActorAlign.CENTER, 
            style_class: 'context-menu-header-box' 
        });
        const titleLabel = new St.Label({ 
            text: this.app.get_name(), 
            style_class: 'context-menu-header-title' 
        });
        
        titleBox.add_child(titleLabel);
        this.panel.add_child(titleBox);
        this._addSeparator();

        let windows = this.app.get_windows();

        if (windows.length > 0) {
            let customSize = this.dockUI.settings.get_int('context-menu-size');

            const thumbSpacing = 12;
            const panelPadding = 24;

            if (windows.length === 1) {
                this._dynamicPanelWidth = customSize + panelPadding + 16;
            } else {
                this._dynamicPanelWidth = (customSize * 2) + thumbSpacing + panelPadding + 16;
            }

            if (this._dynamicPanelWidth < 200) this._dynamicPanelWidth = 200;

            const thumbScroll = new St.ScrollView({
                vscrollbar_policy: St.PolicyType.NEVER,
                hscrollbar_policy: windows.length > 2 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
                enable_mouse_scrolling: true,
                overlay_scrollbars: true,
                style_class: 'context-menu-thumb-scroll'
            });

            thumbScroll.connect('scroll-event', (actor, event) => {
                let dx = 0, dy = 0;
                const direction = event.get_scroll_direction();

                if (direction === Clutter.ScrollDirection.SMOOTH) {
                    [dx, dy] = event.get_scroll_delta();
                } else if (direction === Clutter.ScrollDirection.UP) dy = -1;
                else if (direction === Clutter.ScrollDirection.DOWN) dy = 1;
                else if (direction === Clutter.ScrollDirection.LEFT) dx = -1;
                else if (direction === Clutter.ScrollDirection.RIGHT) dx = 1;

                if (Math.abs(dy) > Math.abs(dx) && dy !== 0) { dx = dy; dy = 0; }

                if (dx !== 0) {
                    const adjustment = typeof thumbScroll.get_hadjustment === 'function'
                        ? thumbScroll.get_hadjustment()
                        : thumbScroll.get_hscroll_bar().get_adjustment();

                    if (adjustment) {
                        const step = direction === Clutter.ScrollDirection.SMOOTH ? dx * 40 : dx * 50;
                        let newVal = adjustment.get_value() + step;
                        const min = adjustment.get_lower();
                        const max = adjustment.get_upper() - adjustment.get_page_size();

                        if (newVal > max) newVal = max;
                        if (newVal < min) newVal = min;

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

            if (windows.length <= 2) {
                thumbBox.x_align = Clutter.ActorAlign.CENTER;
            }

            windows.forEach(win => {
                const card = new St.Widget({ layout_manager: new Clutter.BinLayout(), reactive: true });
                const thumbBtn = new St.Button({ reactive: true, x_expand: true, y_expand: true, style_class: 'context-menu-thumb-btn' });

                const compPrivate = win.get_compositor_private();
                if (compPrivate) {
                    const clone = new Clutter.Clone({ source: compPrivate, reactive: false });
                    const rect = win.get_frame_rect();
                    const w = Math.max(1, rect.width || 1);
                    const h = Math.max(1, rect.height || 1);

                    let thumbW = customSize;
                    let thumbH = (h / w) * thumbW;
                    if (thumbH > customSize * 0.8) { 
                        thumbH = customSize * 0.8; 
                        thumbW = (w / h) * thumbH; 
                    }

                    clone.set_size(thumbW, thumbH);
                    const padBin = new St.Bin({ child: clone, style: 'border-radius: 6px; overflow: hidden;' });
                    thumbBtn.set_child(padBin);
                }

                let winTitleText = win.get_title() || 'Window';
                if (winTitleText.length > 20) winTitleText = winTitleText.substring(0, 18) + '...';

                const titleLbl = new St.Label({ text: winTitleText, style_class: 'context-menu-thumb-title', reactive: false });
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
                    const minBtn = this._createWindowControl('window-minimize-symbolic', '255, 189, 46', () => {
                        this.hide();
                        animateMinimize(win, this.buttonActor, this.dockUI.dockPosition);
                    });
                    controlsBox.add_child(minBtn);
                }

                const isMaximized = typeof win.is_maximized === 'function' ? win.is_maximized() : false;
                let maxIcon = isMaximized ? 'window-restore-symbolic' : 'window-maximize-symbolic';
                if (win.minimized) maxIcon = 'view-fullscreen-symbolic';

                const maxBtn = this._createWindowControl(maxIcon, '40, 201, 64', () => {
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
                });
                controlsBox.add_child(maxBtn);

                const closeBtn = this._createWindowControl('window-close-symbolic', '255, 59, 48', () => {
                    if (!windows.includes(win)) return;

                    win.delete(global.get_current_time());
                    card.ease({
                        scale_x: 0, scale_y: 0, opacity: 0, duration: 200,
                        onComplete: () => { if (card) card.destroy(); }
                    });
                    windows = windows.filter(w => w !== win);

                    this.peekManager.stopPeek();

                    if (windows.length === 0) {
                        this._addAppToIgnoreList(this.app);
                        if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = 0;
                        this.dockUI._renderDock();
                        this.hide();
                    }
                });

                controlsBox.add_child(closeBtn);

                const controlsBin = new St.Bin({
                    child: controlsBox,
                    x_align: Clutter.ActorAlign.END, 
                    y_align: Clutter.ActorAlign.START,
                    x_expand: true, 
                    y_expand: true,
                });

                card.add_child(thumbBtn);
                card.add_child(labelBin);
                card.add_child(controlsBin);

                card.connect('enter-event', () => {
                    controlsBox.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_BACK });
                    titleLbl.ease({ opacity: 0, duration: 150 });
                    thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.6); box-shadow: 0 4px 16px rgba(0,0,0,0.6); transition-duration: 150ms;');
                    this.peekManager.startPeek(win);
                    return Clutter.EVENT_PROPAGATE;
                });

                card.connect('leave-event', () => {
                    controlsBox.ease({ opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_IN_QUAD });
                    titleLbl.ease({ opacity: 255, duration: 150 });
                    thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms; box-shadow: 0 4px 12px rgba(0,0,0,0.2);');
                    this.peekManager.stopPeek();
                    return Clutter.EVENT_PROPAGATE;
                });

                thumbBtn.connect('clicked', () => {
                    this._previousFocus = null; 
                    
                    if (win.minimized) { 
                        animateRestore(win, this.buttonActor, this.dockUI.dockPosition);
                    }
                    
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

        if (this.app.is_module && typeof this.app.open === 'function') {
            this.panel.add_child(this._createMenuItem(`Open ${this.app.get_name()}`, () => {
                this.app.open();
                this.hide();
            }));
            this._addSeparator();
        }

        const appId = typeof this.app.get_id === 'function' ? this.app.get_id() : '';
        if (appId === 'dhruva-module-recycle-bin') {
            this._addTrashActions();
        }

        let appInfo = null;
        if (typeof this.app.get_app_info === 'function') appInfo = this.app.get_app_info();

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
                const actionName = appInfo.get_action_name(action);
                this.panel.add_child(this._createMenuItem(actionName, () => {
                    appInfo.launch_action(action, quietContext);
                    this.hide();
                }));
            });
        }

        if (hasNewWindow || actions.length > 0) this._addSeparator();

        let isPinned = false;
        if (typeof this.app.get_id === 'function') {
            isPinned = this.appManager.hasApp(this.app);
        }

        if (!this.app.is_module && typeof this.app.get_id === 'function') {
            this.panel.add_child(this._createCheckboxItem('Keep in Dock', isPinned, () => {
                isPinned ? this.appManager.removeApp(this.app) : this.appManager.addApp(this.app);
                this.dockUI._renderDock();
                this.hide();
            }));
        }

        if (this.app.get_state() === Shell.AppState.RUNNING) {
            this._addSeparator();
            const quitText = windows.length > 1 ? 'Close All Windows' : (this.app.is_module ? 'Close Folder' : 'Quit');
            
            this.panel.add_child(this._createMenuItem(quitText, () => {
                this._addAppToIgnoreList(this.app);
                if (typeof this.app.request_quit === 'function') this.app.request_quit();
                if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = 0;
                this.dockUI._renderDock();
                this.hide();
            }, true));
        }

        if (this.isCtrlPressed && this.openPrefsCallback) {
            this._addSeparator();
            this.panel.add_child(this._createMenuItem('⚙️  Dhruva Settings', () => {
                this.hide();
                this.openPrefsCallback();
            }));
        }
    }

    _addAppToIgnoreList(app) {
        if (!this.dockUI || typeof app.get_id !== 'function') return;
        const appId = app.get_id();
        if (!this.dockUI._ignoringApps) this.dockUI._ignoringApps = new Set();
        this.dockUI._ignoringApps.add(appId);
        if (!this.dockUI._ignoreAppTimers) this.dockUI._ignoreAppTimers = [];

        let timerId = 0;
        timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            if (this.dockUI && this.dockUI._ignoringApps) this.dockUI._ignoringApps.delete(appId);
            if (this.dockUI && this.dockUI._ignoreAppTimers) {
                this.dockUI._ignoreAppTimers = this.dockUI._ignoreAppTimers.filter(id => id !== timerId);
            }
            return GLib.SOURCE_REMOVE;
        });
        this.dockUI._ignoreAppTimers.push(timerId);
    }

    _applyChameleonPanelStyle(panel) {
        if (this.dockUI.settings.get_string('dock-theme') !== 'chameleon') return;
        const c = this.dockUI._chameleonColor?.bg;
        const accent = this.dockUI._chameleonAccent || '#ffffff';
        if (!c) return;

        const hex = accent.replace('#', '');
        const ar = parseInt(hex.substring(0, 2), 16);
        const ag = parseInt(hex.substring(2, 4), 16);
        const ab = parseInt(hex.substring(4, 6), 16);

        panel.set_style(`
            background-color: rgba(${c.r}, ${c.g}, ${c.b}, 0.88);
            border: 1px solid rgba(${ar}, ${ag}, ${ab}, 0.35);
            padding: 12px;
            border-radius: 18px;
            box-shadow: 0 12px 40px rgba(${c.r}, ${c.g}, ${c.b}, 0.6);
        `);
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
            text: trashHasItems ? '🗑️  Empty Trash' : '✅  Trash is Empty',
            style_class: trashHasItems ? 'context-menu-action-label-destructive' : 'context-menu-action-label'
        });

        if (!trashHasItems) {
            emptyBtn.set_opacity(100);
            label.set_style('color: rgba(255,255,255,0.35);');
        }

        emptyBtn.set_child(label);

        if (trashHasItems) {
            emptyBtn.connect('clicked', () => {
                this.hide();
                try { GLib.spawn_command_line_async('gio trash --empty'); } catch (e) {}
            });
        }

        this.panel.add_child(emptyBtn);
        this._addSeparator();
    }

    _createWindowControl(iconName, rgbColor, onClick) {
        const btn = new St.Button({
            child: new St.Icon({ icon_name: iconName, icon_size: 13, style: 'color: rgba(255,255,255,1.0);' }),
            style_class: 'context-menu-win-control-btn',
            style: `background-color: rgba(${rgbColor}, 0.40);`,
            reactive: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER
        });
        btn.connect('clicked', onClick);

        btn.connect('enter-event', () => {
            btn.set_style(`background-color: rgba(${rgbColor}, 0.75); border-radius: 999px; width: 20px; height: 20px; border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 4px 10px rgba(0,0,0,0.45); transition-duration: 150ms;`);
            btn.ease({ scale_x: 1.1, scale_y: 1.1, duration: 120 });
            return Clutter.EVENT_PROPAGATE;
        });

        btn.connect('leave-event', () => {
            btn.set_style(`background-color: rgba(${rgbColor}, 0.40); border-radius: 999px; width: 20px; height: 20px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 2px 5px rgba(0,0,0,0.25); transition-duration: 150ms;`);
            btn.ease({ scale_x: 1.0, scale_y: 1.0, duration: 120 });
            return Clutter.EVENT_PROPAGATE;
        });

        return btn;
    }

    _createMenuItem(text, onClick, isDestructive = false) {
        const btn = new St.Button({ reactive: true, x_expand: true, style_class: isDestructive ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn' });
        const label = new St.Label({ text, style_class: isDestructive ? 'context-menu-action-label-destructive' : 'context-menu-action-label' });
        btn.set_child(label);
        btn.connect('clicked', onClick);
        return btn;
    }

    _createCheckboxItem(text, isChecked, onClick) {
        const btn = new St.Button({ reactive: true, x_expand: true, style_class: 'context-menu-action-btn' });
        const box = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER });
        const checkbox = new St.Bin({ style_class: isChecked ? 'context-menu-checkbox-box checked' : 'context-menu-checkbox-box' });
        if (isChecked) checkbox.set_child(new St.Icon({ icon_name: 'object-select-symbolic', icon_size: 12, style: 'color: white; font-weight: bold;' }));
        const label = new St.Label({ text, style_class: 'context-menu-action-label', y_align: Clutter.ActorAlign.CENTER });
        box.add_child(checkbox);
        box.add_child(label);
        btn.set_child(box);
        btn.connect('clicked', onClick);
        return btn;
    }

    _addSeparator() {
        this.panel.add_child(new St.Widget({ style_class: 'context-menu-separator-line' }));
    }

    show(dockPosition) {
        this._dockPos = dockPosition;

        if (this.dockUI?._activeContextMenu && this.dockUI._activeContextMenu !== this) {
            this.dockUI._activeContextMenu._forceDestroy();
        }
        this.dockUI._activeContextMenu = this;

        Main.layoutManager.addChrome(this.actor, { affectsStruts: false });
        global.stage.set_key_focus(this.actor);
        this.actor.grab_key_focus();

        if (this.dockUI?.actor) {
            const parent = this.actor.get_parent();
            if (parent && parent === this.dockUI.actor.get_parent()) {
                parent.set_child_below_sibling(this.actor, this.dockUI.actor);
            }
        }

        const { monitor } = this.dockUI.monitorManager.getCurrentMonitor();
        
        this.actor.set_position(0, 0);
        this.actor.set_size(global.stage.width, global.stage.height);
        
        this.panel.set_width(this._dynamicPanelWidth);

        const maxPanelHeight = monitor.height * 0.85;
        let [, panelH] = this.panel.get_preferred_height(this._dynamicPanelWidth);
        if (panelH > maxPanelHeight) panelH = maxPanelHeight;

        const [btnX, btnY] = this.buttonActor.get_transformed_position();
        const [btnW, btnH] = this.buttonActor.get_transformed_size();
        const gap = 14;

        let posX = btnX + (btnW / 2) - (this._dynamicPanelWidth / 2);
        let posY = dockPosition === 'BOTTOM' ? btnY - panelH - gap : btnY + btnH + gap;

        if (dockPosition === 'LEFT') { posX = btnX + btnW + gap; posY = btnY + (btnH / 2) - (panelH / 2); }
        if (dockPosition === 'RIGHT') { posX = btnX - this._dynamicPanelWidth - gap; posY = btnY + (btnH / 2) - (panelH / 2); }

        if (posX < monitor.x + gap) posX = monitor.x + gap;
        if (posX + this._dynamicPanelWidth > monitor.x + monitor.width - gap) posX = monitor.x + monitor.width - this._dynamicPanelWidth - gap;
        if (posY < monitor.y + gap) posY = monitor.y + gap;

        this.panel.set_position(posX, posY);
        this.panel.opacity = 0;
        this.panel.set_scale(0.95, 0.95);
        this.panel.set_pivot_point(0.5, dockPosition === 'BOTTOM' ? 1.0 : 0.0);

        this.panel.ease({ opacity: 255, scale_x: 1.0, scale_y: 1.0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

   _forceDestroy() {
        if (this.dockUI && this.dockUI._activeContextMenu === this)
            this.dockUI._activeContextMenu = null;
        if (this.peekManager) { this.peekManager.destroy(); this.peekManager = null; }
        if (this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
        if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null);
        this.actor.destroy();
    }

    hide() {
        if (this._isHiding) return;
        this._isHiding = true;

        if (this.dockUI && this.dockUI._activeContextMenu === this)
            this.dockUI._activeContextMenu = null;
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

        this.panel.ease({
            opacity: 0, scale_x: 0.95, scale_y: 0.95,
            duration: 120, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
                if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null);
                this.actor.destroy();
            }
        });
    }
}
