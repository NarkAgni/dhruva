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
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import PeekManager from '../../core/PeekManager.js';
import { applyThemeStyle } from './ContextMenuStyle.js';
import { createThumbnailScroll } from './WindowThumbnailBuilder.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { resetMagnification, applyRealtimeFrame } from '../magnifier/Magnifier.js';
import { createIconMenuItem, createMenuItem, addSeparator } from './ContextMenuItems.js';


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
        this._signals = new Map();

        this.actor = new St.Widget({ style_class: 'context-menu-overlay', reactive: true, x_expand: true, y_expand: true });
        global.stage.set_key_focus(null);

        this._addSignal(this.actor, 'button-release-event', () => { this.hide(); return Clutter.EVENT_STOP; });
        this._addSignal(this.actor, 'touch-event', (_a, event) => { if (event.type() === Clutter.EventType.TOUCH_END) this.hide(); return Clutter.EVENT_STOP; });

        if (!disablePeek) this.peekManager = new PeekManager(this.dockUI, this.actor);

        this.menuContainer = new St.Widget({ layout_manager: new Clutter.BinLayout(), reactive: true, style: 'background-color: transparent;' });
        this.bgDrawingArea = new St.DrawingArea({ x_expand: true, y_expand: true, style: 'background-color: transparent;' });
        this.menuContainer.add_child(this.bgDrawingArea);

        this.panel = new St.BoxLayout({ vertical: true, reactive: true, style_class: 'context-menu-panel', style: 'background-color: transparent; border: none; box-shadow: none;' });
        this._addSignal(this.panel, 'button-release-event', () => Clutter.EVENT_STOP);
        this._addSignal(this.panel, 'touch-event', () => Clutter.EVENT_STOP);

        this.menuContainer.add_child(this.panel);
        applyThemeStyle(this, this.panel);
        this._buildMenu();
        this.actor.add_child(this.menuContainer);
    }

    _addSignal(target, signal, callback) {
        if (!target) return;
        const id = target.connect(signal, callback);
        if (!this._signals.has(target)) this._signals.set(target, []);
        this._signals.get(target).push(id);
    }

    _clearSignals() {
        for (const [target, signalIds] of this._signals.entries()) {
            signalIds.forEach(id => { target.disconnect(id); });
        }
        this._signals.clear();
    }

    _buildMenu() {
        if (!this.app && this.buttonActor && this.buttonActor._isFolder) {
            const fData = this.buttonActor._folderData;
            const titleBox = new St.BoxLayout({ vertical: false, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'context-menu-header-box' });
            titleBox.add_child(new St.Label({ text: fData.name, style_class: 'context-menu-header-title' }));
            this.panel.add_child(titleBox); addSeparator(this.panel);

            this.panel.add_child(createIconMenuItem('Unpack Stack', () => {
                fData.apps.forEach(appId => this.dockUI.appManager.favManager.addFavorite(appId));
                this.dockUI.folderManager.deleteFolder(fData.id);
                this.dockUI.queueRender(); this.hide();
            }));
            this.panel.add_child(createIconMenuItem('Close All Apps', () => {
                fData.apps.forEach(appId => { const a = this.dockUI.appManager.appSystem.lookup_app(appId); if (a) a.request_quit(); });
                this.hide();
            }));
            addSeparator(this.panel);
            this.panel.add_child(createIconMenuItem(`Delete ${fData.name}`, () => {
                this.dockUI.folderManager.deleteFolder(fData.id);
                this.dockUI.queueRender(); this.hide();
            }, true));
            return;
        }

        if (!this.app) return;

        const titleBox = new St.BoxLayout({ vertical: false, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style_class: 'context-menu-header-box' });
        titleBox.add_child(new St.Label({ text: this.app.get_name(), style_class: 'context-menu-header-title' }));
        this.panel.add_child(titleBox); addSeparator(this.panel);

        const windows = this.app.get_windows();
        if (windows.length > 0) {
            const customSize = this.dockUI.settings.get_int('context-menu-size');
            this._dynamicPanelWidth = Math.max(200, (windows.length === 1 ? customSize : (customSize * 2) + 12) + 24 + 16);
            const thumbScroll = createThumbnailScroll(this, this.app, windows, customSize);
            this.panel.add_child(thumbScroll); addSeparator(this.panel);
        } else {
            this._dynamicPanelWidth = 220;
        }

        if (this.buttonActor && !this.buttonActor._inFolder && this.dockUI.folderManager && !this.app.is_module) {
            const folders = this.dockUI.folderManager.getFolders();
            let addedFolder = false;
            folders.forEach(f => {
                if (!f.apps.includes(this.app.get_id())) {
                    const btn = createIconMenuItem(`Add to ${f.name}`, () => {
                        this.dockUI.folderManager.addAppToFolder(f.id, this.app.get_id());
                        
                        if (this.dockUI.folderManager.saveFolders) this.dockUI.folderManager.saveFolders();
                        else if (this.dockUI.folderManager._saveFolders) this.dockUI.folderManager._saveFolders();
                        else this.dockUI.settings.set_string('app-folders', JSON.stringify(this.dockUI.folderManager.getFolders()));
                        
                        if (this.dockUI._activeFolderMenu && this.dockUI._activeFolderMenu.folderData.id === f.id) {
                            if (!this.dockUI._activeFolderMenu.folderData.apps.includes(this.app.get_id())) this.dockUI._activeFolderMenu.folderData.apps.push(this.app.get_id());
                            if (this.dockUI._activeFolderMenu.forceRefresh) this.dockUI._activeFolderMenu.forceRefresh();
                        }
                        this.dockUI.queueRender(); this.hide();
                    });
                    btn.set_style('transition-duration: 150ms; border-radius: 6px;');
                    const label = btn.get_child().get_first_child();
                    if (label) label.set_style('color: #0fb55e; font-weight: 700;');
                    btn.connect('notify::hover', () => { btn.set_style(btn.hover ? 'background-color: rgba(15, 181, 94, 0.15); transition-duration: 150ms; border-radius: 6px;' : 'background-color: transparent; transition-duration: 150ms; border-radius: 6px;'); });
                    this.panel.add_child(btn); addedFolder = true;
                }
            });
            if (addedFolder) addSeparator(this.panel);
        }

        if (this.app.is_module && this.app.open) {
            this.panel.add_child(createMenuItem(`Open ${this.app.get_name()}`, () => { this.app.open(); this.hide(); })); addSeparator(this.panel);
        }

        if ((this.app.get_id ? this.app.get_id() : '') === 'dhruva-module-recycle-bin') this._addTrashActions();

        const appInfo = this.app.get_app_info ? this.app.get_app_info() : null;
        const actions = appInfo ? appInfo.list_actions() : [];
        let hasNewWindow = false;
        const quietContext = new Gio.AppLaunchContext();

        if (this.app.can_open_new_window && this.app.can_open_new_window()) {
            this.panel.add_child(createMenuItem('New Window', () => { if (appInfo) appInfo.launch([], quietContext); else this.app.open_new_window(-1); this.hide(); }));
            hasNewWindow = true;
        }

        if (actions.length > 0) {
            actions.forEach(action => {
                if (action.toLowerCase().includes('new-window') && hasNewWindow) return;
                this.panel.add_child(createMenuItem(appInfo.get_action_name(action), () => { appInfo.launch_action(action, quietContext); this.hide(); }));
            });
        }

        if (hasNewWindow || actions.length > 0) addSeparator(this.panel);

        if (!this.app.is_module && this.app.get_id && (!this.buttonActor || !this.buttonActor._inFolder)) {
            const isPinned = this.appManager.hasApp(this.app);
            this.panel.add_child(createMenuItem(isPinned ? 'Unpin from Dhruva' : 'Pin to Dhruva', () => {
                if (isPinned) this.appManager.removeApp(this.app); else this.appManager.addApp(this.app);
                this.dockUI._renderDock(); this.hide();
            }));
        }

        if (this.buttonActor && this.buttonActor._inFolder) {
            this.panel.add_child(createIconMenuItem(`Remove from ${this.buttonActor._folderName || 'Stack'}`, () => {
                this.dockUI.folderManager.removeAppFromFolder(this.buttonActor._folderId, this.app.get_id());
                
                if (this.dockUI.folderManager.saveFolders) this.dockUI.folderManager.saveFolders();
                else if (this.dockUI.folderManager._saveFolders) this.dockUI.folderManager._saveFolders();
                else this.dockUI.settings.set_string('app-folders', JSON.stringify(this.dockUI.folderManager.getFolders()));
                
                if (this.buttonActor.get_parent()) this.buttonActor.destroy();
                this.dockUI.queueRender(); this.hide();
            }, true));
        }

        if (this.app.get_state() === Shell.AppState.RUNNING) {
            addSeparator(this.panel);
            this.panel.add_child(createMenuItem(windows.length > 1 ? 'Close All Windows' : (this.app.is_module ? 'Close Folder' : 'Quit'), () => {
                this._addAppToIgnoreList(this.app);
                if (this.app.request_quit) this.app.request_quit();
                if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = 0;
                this.dockUI._renderDock(); this.hide();
            }, true));
        }

        if (this.isCtrlPressed && this.openPrefsCallback) {
            addSeparator(this.panel);
            this.panel.add_child(createMenuItem('Dhruva Settings', () => { this.hide(); this.openPrefsCallback(); }));
        }
    }

    _addAppToIgnoreList(app) {
        if (!this.dockUI || !app.get_id) return;
        const appId = app.get_id();
        if (!this.dockUI._ignoringApps) this.dockUI._ignoringApps = new Set();
        this.dockUI._ignoringApps.add(appId);
        if (!this.dockUI._ignoreAppTimers) this.dockUI._ignoreAppTimers = [];
        
        const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            if (this.dockUI && this.dockUI._ignoringApps) this.dockUI._ignoringApps.delete(appId);
            if (this.dockUI && this.dockUI._ignoreAppTimers) this.dockUI._ignoreAppTimers = this.dockUI._ignoreAppTimers.filter(id => id !== timerId);
            return GLib.SOURCE_REMOVE;
        });
        this.dockUI._ignoreAppTimers.push(timerId);
    }

    _confirmEmptyTrash() {
        const dialog = new ModalDialog.ModalDialog({ styleClass: 'dhruva-modal-dialog', destroyOnClose: true });
        const content = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 12px; padding: 24px 20px 12px 20px; text-align: center;' });
        content.add_child(new St.Label({ text: 'Empty Trash?', style: 'font-weight: 800; font-size: 22px; color: #ffffff; text-align: center;' }));
        const descLabel = new St.Label({ text: 'Are you sure you want to permanently delete all items from the Trash?\nThis action cannot be undone.', style: 'font-size: 15px; color: rgba(255, 255, 255, 0.75); text-align: center; margin-top: 4px;' });
        descLabel.clutter_text.line_wrap = true; descLabel.clutter_text.justify = true;
        content.add_child(descLabel); dialog.contentLayout.add_child(content);
        dialog.addButton({ label: 'Cancel', action: () => dialog.close(), key: Clutter.KEY_Escape });
        dialog.addButton({ label: 'Empty Trash', action: () => { dialog.close(); GLib.spawn_command_line_async('gio trash --empty'); }, isDefault: true });
        dialog.open();
    }

    _addTrashActions() {
        let trashHasItems = false;
        const iter = Gio.File.new_for_uri('trash:///').enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        trashHasItems = iter.next_file(null) !== null; iter.close(null);
        
        const emptyBtn = new St.Button({ reactive: trashHasItems, x_expand: true, style_class: trashHasItems ? 'context-menu-action-btn-destructive' : 'context-menu-action-btn' });
        const label = new St.Label({ text: trashHasItems ? 'Empty Trash' : 'Trash is Empty', style_class: trashHasItems ? 'context-menu-action-label-destructive' : 'context-menu-action-label' });
        if (!trashHasItems) { emptyBtn.set_opacity(100); label.set_style('color: rgba(255,255,255,0.25);'); }
        emptyBtn.set_child(label);
        if (trashHasItems) emptyBtn.connect('clicked', () => { this.hide(); this._confirmEmptyTrash(); });
        this.panel.add_child(emptyBtn); addSeparator(this.panel);
    }

    _updatePosition() {
        if (this._isHiding || !this.actor || !this.menuContainer) return;
        
        const isDestroyed = !this.buttonActor || this.buttonActor.is_destroyed && this.buttonActor.is_destroyed() || !this.buttonActor.get_parent();
        if (isDestroyed) { 
            if (this.dockUI && this.dockUI.boxActor && this.app) {
                const newBtn = this.dockUI.boxActor.get_children().find(c => c._delegate && c._delegate.app && c._delegate.app.get_id() === this.app.get_id());
                if (newBtn) {
                    this.buttonActor = newBtn;
                } else {
                    this.hide(); return;
                }
            } else {
                this.hide(); return; 
            }
        }

        const [btnX, btnY] = this.buttonActor.get_transformed_position();
        const [btnW, btnH] = this.buttonActor.get_transformed_size();
        if (Number.isNaN(btnX) || Number.isNaN(btnY) || btnW <= 0 || (btnX === 0 && btnY === 0 && !this.buttonActor.get_parent())) return;

        let [, panelW] = this.menuContainer.get_preferred_width(-1);
        let [, panelH] = this.menuContainer.get_preferred_height(-1);

        const { monitor } = this.dockUI.monitorManager.getCurrentMonitor();
        const maxPanelHeight = monitor.height * 0.85;
        if (panelH > maxPanelHeight) panelH = maxPanelHeight;

        const stateStr = `${btnX},${btnY},${btnW},${panelW},${panelH}`;
        if (this._lastStateStr === stateStr) return;
        this._lastStateStr = stateStr;

        const isInsideFolder = this.buttonActor && this.buttonActor._inFolder;
        const isAppGrid = !this.peekManager && !isInsideFolder;
        const gap = isInsideFolder ? -8 : (isAppGrid ? -8 : 22);

        let posX = btnX + (btnW / 2) - (panelW / 2);
        let posY = btnY;
        const dockPos = this._dockPos;

        if (dockPos === 'BOTTOM') { posY = btnY - panelH - gap; this.menuContainer.set_pivot_point(0.5, 1.0); }
        else if (dockPos === 'TOP') { posY = btnY + btnH + gap; this.menuContainer.set_pivot_point(0.5, 0.0); }
        else if (dockPos === 'LEFT') { posX = btnX + btnW + gap; posY = btnY + (btnH / 2) - (panelH / 2); this.menuContainer.set_pivot_point(0.0, 0.5); }
        else if (dockPos === 'RIGHT') { posX = btnX - panelW - gap; posY = btnY + (btnH / 2) - (panelH / 2); this.menuContainer.set_pivot_point(1.0, 0.5); }

        if (posX < monitor.x + gap) posX = monitor.x + gap;
        if (posX + panelW > monitor.x + monitor.width - gap) posX = monitor.x + monitor.width - panelW - gap;
        if (dockPos !== 'BOTTOM' && posY + panelH > monitor.y + monitor.height - gap) posY = monitor.y + monitor.height - panelH - gap;

        posX = Math.round(posX); posY = Math.round(posY);

        if (dockPos === 'BOTTOM' || dockPos === 'TOP') this.bgDrawingArea._arrowCenter = Math.round((btnX + btnW / 2) - posX);
        else this.bgDrawingArea._arrowCenter = Math.round((btnY + btnH / 2) - posY);
        this.bgDrawingArea.queue_repaint();

        this.panel.ease({ width: panelW, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        if (this._isFirstPosition !== false) {
            this.menuContainer.set_position(posX, posY);
            this._isFirstPosition = false;
        } else {
            this.menuContainer.ease({ x: posX, y: posY, height: panelH, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    }

    show(dockPosition) {
        this._dockPos = dockPosition;
        this._isFirstPosition = true;
        
        if (this.dockUI && this.dockUI.actor && setMagnifierPauseState) setMagnifierPauseState(this.dockUI.actor, 'context-menu', true);

        if (this._showDelayId) GLib.source_remove(this._showDelayId);
        this._showDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._showDelayId = null;
            if (this._isHiding || !this.actor) return GLib.SOURCE_REMOVE;

            if (this.dockUI && this.dockUI._activeContextMenu && this.dockUI._activeContextMenu !== this) this.dockUI._activeContextMenu._forceDestroy();
            this.dockUI._activeContextMenu = this;

            Main.layoutManager.addChrome(this.actor, { affectsStruts: false });
            global.stage.set_key_focus(this.actor); this.actor.grab_key_focus();

            if (this.dockUI && this.dockUI.actor) {
                const parent = this.actor.get_parent();
                if (!this.peekManager) { 
                    if (parent) parent.set_child_above_sibling(this.actor, null); 
                } else { 
                    const sibling = this.dockUI.actor; 
                    const siblingParent = sibling && sibling.get_parent ? sibling.get_parent() : null; 
                    if (parent && sibling && parent === siblingParent) parent.set_child_below_sibling(this.actor, sibling); 
                }
            }

            this.actor.set_position(0, 0); this.actor.set_size(global.stage.width, global.stage.height);

            const ah = 12;
            let padBottom = 12, padTop = 12, padLeft = 12, padRight = 12;
            if (dockPosition === 'BOTTOM') padBottom += ah; else if (dockPosition === 'TOP') padTop += ah; else if (dockPosition === 'LEFT') padLeft += ah; else if (dockPosition === 'RIGHT') padRight += ah;
            this.panel.set_style(`background-color: transparent; border: none; box-shadow: none; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`);
            
            this.menuContainer.opacity = 0;
            this._updatePosition();

            this.menuContainer.ease({ opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

            if (this._posTrackerId) GLib.source_remove(this._posTrackerId);
            this._posTrackerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (this._isHiding || !this.actor) {
                    this._posTrackerId = null;
                    return GLib.SOURCE_REMOVE;
                }
                this._updatePosition();
                return GLib.SOURCE_CONTINUE;
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    hide() {
        if (this._isHiding) return;
        this._isHiding = true;

        if (this._showDelayId) { GLib.source_remove(this._showDelayId); this._showDelayId = null; }
        if (this._posTrackerId) { GLib.source_remove(this._posTrackerId); this._posTrackerId = null; }

        if (this.dockUI && this.dockUI.actor && setMagnifierPauseState) setMagnifierPauseState(this.dockUI.actor, 'context-menu', false);
        if (this.dockUI && this.dockUI._activeContextMenu === this) this.dockUI._activeContextMenu = null;
        if (this.peekManager) this.peekManager.stopPeek();

        if (this.dockUI && this.dockUI.actor) {
            const [px, py] = global.get_pointer(); const [dx, dy] = this.dockUI.actor.get_transformed_position(); const [dw, dh] = this.dockUI.actor.get_transformed_size();
            const pad = 15; const isInside = px >= dx - pad && px <= dx + dw + pad && py >= dy - pad && py <= dy + dh + pad;
            if (!isInside) resetMagnification(this.dockUI.actor);
            else { const isVertical = this.dockUI.dockPosition === 'LEFT' || this.dockUI.dockPosition === 'RIGHT'; applyRealtimeFrame(this.dockUI.actor, px, py, isVertical, this.dockUI.settings, Date.now()); }
        }

        if (this.menuContainer) {
            this.menuContainer.ease({
                opacity: 0, scale_x: 0.95, scale_y: 0.95, duration: 120, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => { 
                    this._clearSignals(); 
                    if (this.actor && this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor); 
                    if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null); 
                    if (this.actor) this.actor.destroy(); 
                }
            });
        }
    }

    _forceDestroy() {
        if (this._showDelayId) { GLib.source_remove(this._showDelayId); this._showDelayId = null; }
        if (this._posTrackerId) { GLib.source_remove(this._posTrackerId); this._posTrackerId = null; }
        if (this.dockUI && this.dockUI.actor && setMagnifierPauseState) setMagnifierPauseState(this.dockUI.actor, 'context-menu', false);
        if (this.dockUI && this.dockUI._activeContextMenu === this) this.dockUI._activeContextMenu = null;
        if (this.peekManager) { this.peekManager.destroy(); this.peekManager = null; }
        this._clearSignals();
        if (this.actor && this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
        if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null);
        if (this.actor) this.actor.destroy();
    }
}