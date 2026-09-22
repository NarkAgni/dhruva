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
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import PeekManager from '../../core/PeekManager.js';
import { applyThemeStyle } from './ContextMenuStyle.js';
import { Settings } from '../../core/SettingsManager.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { attachTrashActions } from './TrashActionsHandler.js';
import { setBoxVertical, isActorAlive } from '../../core/Utils.js';
import { createThumbnailScroll } from './WindowThumbnailBuilder.js';
import { resetMagnification } from '../magnifier/MagnifierReset.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { createIconMenuItem, createMenuItem, addSeparator } from './ContextMenuItems.js';


const DEFAULT_PANEL_WIDTH = 280;
const POS_TRACKER_INTERVAL_MS = 16;
const IGNORE_EXPIRY_MS = 2000;

export default class AppContextMenu {
    constructor(dockUI, app, buttonActor, isCtrlPressed = false, openPrefsCallback = null, disablePeek = false) {
        this.dockUI = dockUI;
        this.appManager = dockUI.appManager;
        this.app = app;
        this.buttonActor = buttonActor;

        if (this.buttonActor && isActorAlive(this.buttonActor)) {
            this.buttonActor.connectObject('destroy', () => { this.buttonActor = null; }, this);
        }

        this.isCtrlPressed = isCtrlPressed;
        this.openPrefsCallback = openPrefsCallback;
        this.timers = new TimeoutTracker();

        this._isHiding = false;
        this._dynamicPanelWidth = DEFAULT_PANEL_WIDTH;
        this._previousFocus = global.stage.get_key_focus();

        this.actor = new St.Widget({
            style_class: 'context-menu-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true
        });
        global.stage.set_key_focus(null);

        this.actor.connectObject(
            'button-release-event', () => { this.hide(); return Clutter.EVENT_STOP; },
            'touch-event', (_a, event) => {
                if (event.type() === Clutter.EventType.TOUCH_END) this.hide();
                return Clutter.EVENT_STOP;
            },
            'destroy', () => this._cleanup(),
            this
        );

        Main.sessionMode.connectObject('updated', () => {
            this.hide();
        }, this);

        if (!disablePeek) this.peekManager = new PeekManager(this.dockUI, this.actor);

        this.menuContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            style: 'background-color: transparent;'
        });
        this.bgDrawingArea = new St.DrawingArea({ x_expand: true, y_expand: true, style: 'background-color: transparent;' });
        this.menuContainer.add_child(this.bgDrawingArea);

        this.panel = new St.BoxLayout({
            reactive: true,
            style_class: 'context-menu-panel',
            style: 'background-color: transparent; border: none; box-shadow: none;'
        });
        setBoxVertical(this.panel, true);

        this.panel.connectObject(
            'button-release-event', () => Clutter.EVENT_STOP,
            'touch-event', () => Clutter.EVENT_STOP,
            this
        );

        this.menuContainer.add_child(this.panel);
        applyThemeStyle(this, this.panel);
        this._buildMenu();
        this.actor.add_child(this.menuContainer);
    }

    _cleanup() {
        Main.sessionMode.disconnectObject(this);
        this.timers.destroy();

        if (this.dockUI && isActorAlive(this.dockUI.actor) && setMagnifierPauseState) {
            setMagnifierPauseState(this.dockUI.actor, 'context-menu', false);
        }
        if (this.dockUI && this.dockUI._activeContextMenu === this) {
            this.dockUI._activeContextMenu = null;
        }
        if (this.peekManager) {
            this.peekManager.destroy();
            this.peekManager = null;
        }

        if (this.actor) this.actor.disconnectObject(this);
        if (this.panel) this.panel.disconnectObject(this);
        if (this.buttonActor) this.buttonActor.disconnectObject(this);
    }

    _buildMenu() {
        if (!this.app && this.buttonActor && this.buttonActor._isFolder) {
            const fData = this.buttonActor._folderData;
            const folderDisplayName = (fData.name === 'New Folder' || fData.name === 'Новая папка') ? _('New Folder') : fData.name;
            const titleBox = new St.BoxLayout({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'context-menu-header-box'
            });
            setBoxVertical(titleBox, false);
            titleBox.add_child(new St.Label({ text: folderDisplayName, style_class: 'context-menu-header-title' }));
            this.panel.add_child(titleBox);
            addSeparator(this.panel);

            this.panel.add_child(createIconMenuItem(_('Unpack Stack'), () => {
                fData.apps.forEach(appId => this.dockUI.appManager.addApp(appId));
                this.dockUI.folderManager.deleteFolder(fData.id);
                this.dockUI.queueRender('incremental');
                this.hide();
            }, false, this));

            this.panel.add_child(createIconMenuItem(_('Close All Apps'), () => {
                fData.apps.forEach(appId => {
                    const a = this.dockUI.appManager.appSystem.lookup_app(appId);
                    if (a) a.request_quit();
                });
                this.hide();
            }, false, this));

            addSeparator(this.panel);
            const deleteLabel = _('Delete %s').format(folderDisplayName);
            this.panel.add_child(createIconMenuItem(deleteLabel, () => {
                this.dockUI.folderManager.deleteFolder(fData.id);
                this.dockUI.queueRender('incremental');
                this.hide();
            }, true, this));
            return;
        }

        if (!this.app) return;

        const titleBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'context-menu-header-box'
        });
        setBoxVertical(titleBox, false);
        titleBox.add_child(new St.Label({ text: this.app.get_name(), style_class: 'context-menu-header-title' }));
        this.panel.add_child(titleBox);
        addSeparator(this.panel);

        const windows = this.app.get_windows();
        if (windows.length > 0) {
            const customSize = Settings.contextMenuSize;
            this._dynamicPanelWidth = Math.max(200, (windows.length === 1 ? customSize : (customSize * 2) + 12) + 24 + 16);
            const thumbScroll = createThumbnailScroll(this, this.app, windows, customSize);
            this.panel.add_child(thumbScroll);
            addSeparator(this.panel);
        } else {
            this._dynamicPanelWidth = 220;
        }

        if (this.buttonActor && !this.buttonActor._inFolder && this.dockUI.folderManager && !this.app.is_module) {
            const folders = this.dockUI.folderManager.getFolders();
            let addedFolder = false;
            folders.forEach(f => {
                if (!f.apps.includes(this.app.get_id())) {
                    const targetFolderName = (f.name === 'New Folder' || f.name === 'Новая папка') ? _('New Folder') : f.name;
                    const addLabel = _('Add to %s').format(targetFolderName);
                    const btn = createIconMenuItem(addLabel, () => {
                        const appId = this.app.get_id();
                        const targetBtn = this.buttonActor;

                        if (targetBtn && isActorAlive(targetBtn)) {
                            targetBtn.remove_all_transitions();
                            targetBtn.set_pivot_point(0.5, 0.5);
                            targetBtn.ease({
                                opacity: 0,
                                scale_x: 0.1,
                                scale_y: 0.1,
                                duration: 150,
                                mode: Clutter.AnimationMode.EASE_IN_CUBIC
                            });
                        }

                        const activeFMenu = this.dockUI._activeFolderMenu;
                        const isFolderMenuOpen = Boolean(activeFMenu && activeFMenu.folderData && activeFMenu.folderData.id === f.id);

                        if (isFolderMenuOpen) {
                            activeFMenu._suppressSync = true;
                        }

                        this.dockUI.folderManager.addAppToFolder(f.id, appId);
                        if (this.dockUI.folderManager.saveFolders) this.dockUI.folderManager.saveFolders();
                        else if (this.dockUI.folderManager._saveFolders) this.dockUI.folderManager._saveFolders();
                        else this.dockUI.settings.set_string('app-folders', JSON.stringify(this.dockUI.folderManager.getFolders()));

                        this.dockUI.queueRender('incremental');

                        if (isFolderMenuOpen) {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
                                if (activeFMenu && isActorAlive(activeFMenu.actor) && activeFMenu.folderData && activeFMenu.folderData.id === f.id) {
                                    activeFMenu._suppressSync = false;
                                    if (!activeFMenu.folderData.apps.includes(appId)) {
                                        activeFMenu.folderData.apps.push(appId);
                                    }
                                    activeFMenu.forceRefresh(false, appId);
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        }

                        this.hide();
                    }, false, this);

                    btn.set_style('transition-duration: 150ms; border-radius: 6px;');
                    const label = btn.get_child().get_first_child();
                    if (label) label.set_style('color: #0fb55e; font-weight: 700;');

                    btn.connectObject('notify::hover', () => {
                        btn.set_style(btn.hover ? 'background-color: rgba(15, 181, 94, 0.15); transition-duration: 150ms; border-radius: 6px;' : 'background-color: transparent; transition-duration: 150ms; border-radius: 6px;');
                    }, btn);

                    this.panel.add_child(btn);
                    addedFolder = true;
                }
            });
            if (addedFolder) addSeparator(this.panel);
        }

        if (this.app.is_module && this.app.open) {
            const openModuleLabel = _('Open %s').format(this.app.get_name());
            this.panel.add_child(createMenuItem(openModuleLabel, () => {
                this.app.open();
                this.hide();
            }, false, this));
            addSeparator(this.panel);
        }

        if ((this.app.get_id ? this.app.get_id() : '') === 'dhruva-module-recycle-bin') {
            attachTrashActions(this);
        }

        const appInfo = this.app.get_app_info ? this.app.get_app_info() : null;
        const actions = appInfo ? appInfo.list_actions() : [];
        let hasNewWindow = false;
        const quietContext = new Gio.AppLaunchContext();

        if (this.app.can_open_new_window && this.app.can_open_new_window()) {
            this.panel.add_child(createMenuItem(_('New Window'), () => {
                if (appInfo) appInfo.launch([], quietContext);
                else this.app.open_new_window(-1);
                this.hide();
            }, false, this));
            hasNewWindow = true;
        }

        if (actions.length > 0) {
            actions.forEach(action => {
                if (action.toLowerCase().includes('new-window') && hasNewWindow) return;
                this.panel.add_child(createMenuItem(appInfo.get_action_name(action), () => {
                    appInfo.launch_action(action, quietContext);
                    this.hide();
                }, false, this));
            });
        }

        if (hasNewWindow || actions.length > 0) addSeparator(this.panel);

        if (!this.app.is_module && this.app.get_id && (!this.buttonActor || !this.buttonActor._inFolder)) {
            const isPinned = this.appManager.hasApp(this.app);
            this.panel.add_child(createMenuItem(isPinned ? _('Unpin from Dhruva') : _('Pin to Dhruva'), () => {
                if (isPinned) this.appManager.removeApp(this.app);
                else this.appManager.addApp(this.app);
                this.dockUI.queueRender('incremental');
                this.hide();
            }, false, this));
        }

        if (this.buttonActor && this.buttonActor._inFolder) {
            const folderId = this.buttonActor._folderId;
            const rawName = this.buttonActor._folderName || 'Stack';
            const folderDisplayName = (rawName === 'New Folder' || rawName === 'Новая папка') ? _('New Folder') : (rawName === 'Stack' ? _('Stack') : rawName);
            const targetBtn = this.buttonActor;

            const removeLabel = _('Remove from %s').format(folderDisplayName);
            this.panel.add_child(createIconMenuItem(removeLabel, () => {
                const appId = this.app.get_id();

                this.dockUI.folderManager.removeAppFromFolder(folderId, appId);

                if (this.dockUI.folderManager.saveFolders) this.dockUI.folderManager.saveFolders();
                else if (this.dockUI.folderManager._saveFolders) this.dockUI.folderManager._saveFolders();
                else this.dockUI.settings.set_string('app-folders', JSON.stringify(this.dockUI.folderManager.getFolders()));

                if (targetBtn && isActorAlive(targetBtn)) {
                    targetBtn.remove_all_transitions();
                    targetBtn.set_pivot_point(0.5, 0.5);
                    targetBtn.ease({
                        opacity: 0,
                        scale_x: 0.1,
                        scale_y: 0.1,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                        onComplete: () => {
                            if (isActorAlive(targetBtn)) {
                                const parent = targetBtn.get_parent ? targetBtn.get_parent() : null;
                                if (parent) parent.remove_child(targetBtn);
                                targetBtn.destroy();
                            }
                            if (this.dockUI._activeFolderMenu && this.dockUI._activeFolderMenu.folderData && this.dockUI._activeFolderMenu.folderData.id === folderId) {
                                this.dockUI._activeFolderMenu.forceRefresh(true);
                            }
                        }
                    });
                }
                this.buttonActor = null;

                this.dockUI.queueRender('incremental');
                this.hide();
            }, true, this));
        }

        if (this.app.get_state() === Shell.AppState.RUNNING) {
            addSeparator(this.panel);
            this.panel.add_child(createMenuItem(windows.length > 1 ? _('Close All Windows') : (this.app.is_module ? _('Close Folder') : _('Quit')), () => {
                this._addAppToIgnoreList(this.app);
                if (this.app.request_quit) this.app.request_quit();
                if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = 0;
                this.dockUI.queueRender('incremental');
                this.hide();
            }, true, this));
        }

        const isAppGrid = (this.app.get_id ? this.app.get_id() : '') === 'dhruva-grid-button';
        const shouldShowSettings = (this.isCtrlPressed || isAppGrid) && Boolean(this.openPrefsCallback);

        if (shouldShowSettings) {
            if (!isAppGrid) addSeparator(this.panel);
            this.panel.add_child(createMenuItem(_('Dhruva Settings'), () => {
                this.hide();
                const res = this.openPrefsCallback();
                if (res instanceof Promise) res.catch(e => console.warn('[Dhruva]', e.message));
            }, false, this));
        }
    }

    _addAppToIgnoreList(app) {
        if (!this.dockUI || !app.get_id) return;
        const appId = app.get_id();
        if (!this.dockUI._ignoringApps) this.dockUI._ignoringApps = new Set();
        this.dockUI._ignoringApps.add(appId);

        this.timers.addTimeout(GLib.PRIORITY_DEFAULT, IGNORE_EXPIRY_MS, () => {
            if (this.dockUI && this.dockUI._ignoringApps) this.dockUI._ignoringApps.delete(appId);
            return GLib.SOURCE_REMOVE;
        });
    }

    _updatePosition() {
        if (this._isHiding || !this.actor || !isActorAlive(this.actor) || !this.menuContainer || !isActorAlive(this.menuContainer)) return;

        if (!this.buttonActor || !isActorAlive(this.buttonActor) || !this.buttonActor.get_parent()) {
            if (this.dockUI && this.dockUI.boxActor && isActorAlive(this.dockUI.boxActor) && this.app) {
                const newBtn = this.dockUI.boxActor.get_children().find(c => c._delegate && c._delegate.app && c._delegate.app.get_id() === this.app.get_id());
                if (newBtn && isActorAlive(newBtn)) {
                    if (this.buttonActor) this.buttonActor.disconnectObject(this);
                    this.buttonActor = newBtn;
                    this.buttonActor.connectObject('destroy', () => { this.buttonActor = null; }, this);
                } else {
                    this.hide();
                    return;
                }
            } else {
                this.hide();
                return;
            }
        }

        const [btnX, btnY] = this.buttonActor.get_transformed_position();
        const [btnW, btnH] = this.buttonActor.get_transformed_size();
        if (Number.isNaN(btnX) || Number.isNaN(btnY) || btnW <= 0 || (btnX === 0 && btnY === 0 && !this.buttonActor.get_parent())) return;

        let [, panelW] = this.menuContainer.get_preferred_width(-1);
        let [, panelH] = this.menuContainer.get_preferred_height(-1);

        const currentMonData = this.dockUI.monitorManager ? this.dockUI.monitorManager.getCurrentMonitor() : null;
        const monitor = (currentMonData && currentMonData.monitor) 
            ? currentMonData.monitor 
            : Main.layoutManager.primaryMonitor || { x: 0, y: 0, width: global.stage.width, height: global.stage.height };

        if (!monitor) {
            this.hide();
            return;
        }

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

        if (dockPos === 'BOTTOM') {
            posY = btnY - panelH - gap;
            this.menuContainer.set_pivot_point(0.5, 1.0);
        } else if (dockPos === 'TOP') {
            posY = btnY + btnH + gap;
            this.menuContainer.set_pivot_point(0.5, 0.0);
        } else if (dockPos === 'LEFT') {
            posX = btnX + btnW + gap;
            posY = btnY + (btnH / 2) - (panelH / 2);
            this.menuContainer.set_pivot_point(0.0, 0.5);
        } else if (dockPos === 'RIGHT') {
            posX = btnX - panelW - gap;
            posY = btnY + (btnH / 2) - (panelH / 2);
            this.menuContainer.set_pivot_point(1.0, 0.5);
        }

        if (posX < monitor.x + gap) posX = monitor.x + gap;
        if (posX + panelW > monitor.x + monitor.width - gap) posX = monitor.x + monitor.width - panelW - gap;
        if (dockPos !== 'BOTTOM' && posY + panelH > monitor.y + monitor.height - gap) posY = monitor.y + monitor.height - panelH - gap;

        posX = Math.round(posX);
        posY = Math.round(posY);

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

        if (this.dockUI && isActorAlive(this.dockUI.actor) && setMagnifierPauseState) {
            setMagnifierPauseState(this.dockUI.actor, 'context-menu', true);
        }

        this.timers.remove(this._showDelayId);

        const setupUI = () => {
            this._showDelayId = null;
            if (this._isHiding || !this.actor) return GLib.SOURCE_REMOVE;

            if (this.dockUI && this.dockUI._activeContextMenu && this.dockUI._activeContextMenu !== this) {
                this.dockUI._activeContextMenu.hide();
            }
            this.dockUI._activeContextMenu = this;

            Main.layoutManager.addChrome(this.actor, { affectsStruts: false });
            global.stage.set_key_focus(this.actor);
            this.actor.grab_key_focus();

            if (this.dockUI && isActorAlive(this.dockUI.actor)) {
                const parent = this.actor.get_parent();
                if (!this.peekManager) {
                    if (parent) parent.set_child_above_sibling(this.actor, null);
                } else {
                    const sibling = this.dockUI.actor;
                    const siblingParent = sibling && sibling.get_parent ? sibling.get_parent() : null;
                    if (parent && sibling && parent === siblingParent) parent.set_child_below_sibling(this.actor, sibling);
                }
            }

            this.actor.set_position(0, 0);
            this.actor.set_size(global.stage.width, global.stage.height);

            const ah = 12;
            let padBottom = 12, padTop = 12, padLeft = 12, padRight = 12;
            if (dockPosition === 'BOTTOM') padBottom += ah;
            else if (dockPosition === 'TOP') padTop += ah;
            else if (dockPosition === 'LEFT') padLeft += ah;
            else if (dockPosition === 'RIGHT') padRight += ah;

            this.panel.set_style(`background-color: transparent; border: none; box-shadow: none; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`);
            this.menuContainer.opacity = 0;
            this._updatePosition();

            this.menuContainer.ease({ opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

            this.timers.remove(this._posTrackerId);
            this._posTrackerId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, POS_TRACKER_INTERVAL_MS, () => {
                if (this._isHiding || !this.actor || !isActorAlive(this.actor)) {
                    this._posTrackerId = null;
                    return GLib.SOURCE_REMOVE;
                }
                this._updatePosition();
                return GLib.SOURCE_CONTINUE;
            });

            return GLib.SOURCE_REMOVE;
        };

        this._showDelayId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 150, setupUI);
    }

    hide() {
        if (this._isHiding) return;
        this._isHiding = true;

        this.timers.remove(this._showDelayId);
        this._showDelayId = null;

        this.timers.remove(this._posTrackerId);
        this._posTrackerId = null;

        if (this.dockUI && isActorAlive(this.dockUI.actor) && setMagnifierPauseState) {
            setMagnifierPauseState(this.dockUI.actor, 'context-menu', false);
        }
        if (this.dockUI && this.dockUI._activeContextMenu === this) {
            this.dockUI._activeContextMenu = null;
        }
        if (this.peekManager) this.peekManager.stopPeek();

        if (this.dockUI && isActorAlive(this.dockUI.actor)) {
            const [px, py] = global.get_pointer();
            const [dx, dy] = this.dockUI.actor.get_transformed_position();
            const [dw, dh] = this.dockUI.actor.get_transformed_size();
            const pad = 15;
            const isInside = px >= dx - pad && px <= dx + dw + pad && py >= dy - pad && py <= dy + dh + pad;

            if (!isInside) {
                resetMagnification(this.dockUI.actor, 180, false);
            }
        }

        if (this.actor && isActorAlive(this.actor) && this.actor.get_parent()) {
            Main.layoutManager.removeChrome(this.actor);
        }

        if (this.menuContainer && isActorAlive(this.menuContainer)) {
            this.menuContainer.ease({
                opacity: 0,
                scale_x: 0.95,
                scale_y: 0.95,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (global.stage.get_key_focus() === this.actor) global.stage.set_key_focus(this._previousFocus || null);
                    if (this.actor && isActorAlive(this.actor)) this.actor.destroy();
                }
            });
        } else if (this.actor && isActorAlive(this.actor)) {
            this.actor.destroy();
        }
    }
}