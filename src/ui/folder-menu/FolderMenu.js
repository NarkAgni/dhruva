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
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { FolderMenuBuilder } from './FolderMenuBuilder.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { isActorAlive, setBoxVertical } from '../../core/Utils.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { dropDelegate, dropButton, dropAppId, applyThemeStyle } from './FolderMenuStyle.js';


const POSITION_GAP = 20;
const POSITION_TRACKER_INTERVAL_MS = 16;
const SHOW_MENU_DELAY_MS = 120;

export default class FolderMenu {
    constructor(dockUI, folderData, buttonActor) {
        this.dockUI = dockUI;
        this.folderData = folderData;
        this.buttonActor = buttonActor;
        this._emojiOverlay = null;
        this.timers = new TimeoutTracker();

        if (this.buttonActor && isActorAlive(this.buttonActor)) {
            this.buttonActor.connectObject('destroy', () => { this.buttonActor = null; }, this);
        }

        this.actor = new St.Widget({
            style_class: 'context-menu-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true
        });

        this.actor.connectObject('button-release-event', () => {
            this.hide();
            return Clutter.EVENT_STOP;
        }, this);

        Main.sessionMode.connectObject('updated', () => {
            this.hide();
        }, this);

        this.actor.connectObject('destroy', () => {
            Main.sessionMode.disconnectObject(this);
            this.timers.destroy();
            if (this.buttonActor) this.buttonActor.disconnectObject(this);
            if (this.panel) this.panel.disconnectObject(this);
            if (this._folderChangeHandler && this.dockUI && this.dockUI.folderManager) {
                this.dockUI.folderManager.removeStateListener(this._folderChangeHandler);
            }
        }, this);

        this.menuContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            style: 'background-color: transparent;'
        });
        this.menuContainer.connectObject('button-release-event', () => Clutter.EVENT_STOP, this);

        this.bgDrawingArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            style: 'background-color: transparent;'
        });
        this.menuContainer.add_child(this.bgDrawingArea);

        this.panel = new St.BoxLayout({
            reactive: true,
            style_class: 'context-menu-panel',
            style: 'background-color: transparent; border: none; box-shadow: none;'
        });
        setBoxVertical(this.panel, true);
        this.panel.connectObject('button-release-event', () => Clutter.EVENT_STOP, this);

        const handleExternalAppDrop = (source) => {
            const delegate = dropDelegate(source);
            if (delegate.isFolderItem) return false;

            const draggedId = dropAppId(source);
            const srcBtn = dropButton(source);
            const draggedApp = delegate.app || (source && source.app) || (srcBtn && srcBtn._delegate && srcBtn._delegate.app);
            
            if (draggedApp && draggedId && !this.folderData.apps.includes(draggedId)) {
                this.folderData.apps.push(draggedId); 
                this.dockUI.folderManager.addAppToFolder(this.folderData.id, draggedId);
                
                if (srcBtn) srcBtn._wasMerged = true;
                
                this._saveFolderState();
                if (this.builder) this.builder.refreshGrid(false, draggedId);
                
                this._lastStateStr = null; 
                this.dockUI.queueRender('incremental');
                return true;
            }

            return false;
        };

        this.panel._delegate = {
            acceptDrop: (source) => Boolean(source && !dropDelegate(source).isFolderItem && dropAppId(source)),
            handleDragOver: (source) => (source && !dropDelegate(source).isFolderItem && dropAppId(source) ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE),
            handleDragDrop: handleExternalAppDrop
        };
        this._handleExternalAppDrop = handleExternalAppDrop;

        this.menuContainer.add_child(this.panel);
        applyThemeStyle(this, this.panel);
        
        this.builder = new FolderMenuBuilder(this);
        this.builder.buildMenu();

        this.actor.add_child(this.menuContainer);

        if (this.dockUI && this.dockUI.folderManager) {
            this._folderChangeHandler = () => {
                if (this._isInternalSave || this._suppressSync) return;
                const updatedFolder = this.dockUI.folderManager.getFolders().find(f => f.id === this.folderData.id);
                if (updatedFolder) {
                    this.folderData = updatedFolder;
                    this.forceRefresh();
                } else {
                    this.hide();
                }
            };
            this.dockUI.folderManager.addStateListener(this._folderChangeHandler);
        }

        if (this.dockUI.appManager && this.dockUI.appManager.appSystem) {
            this.dockUI.appManager.appSystem.connectObject('installed-changed', () => {
                this.forceRefresh();
            }, this.actor);
        }
    }

    forceRefresh(skipEntryAnimation = false, animatedAppId = null) {
        if (this.builder) this.builder.refreshGrid(skipEntryAnimation, animatedAppId);
        this._lastStateStr = null;
    }

    _updatePosition() {
        if (!this.actor || !isActorAlive(this.actor) || !this.menuContainer || !isActorAlive(this.menuContainer)) return;

        const isDestroyed = !this.buttonActor || !isActorAlive(this.buttonActor) || !this.buttonActor.get_parent();

        if (isDestroyed) {
            if (this.dockUI && this.dockUI.boxActor && isActorAlive(this.dockUI.boxActor)) {
                const newBtn = this.dockUI.boxActor.get_children().find(c => c._isFolder && c._folderData && c._folderData.id === this.folderData.id);
                if (newBtn && isActorAlive(newBtn)) {
                    if (this.buttonActor) this.buttonActor.disconnectObject(this);
                    this.buttonActor = newBtn;
                    this.buttonActor.connectObject('destroy', () => { this.buttonActor = null; }, this);
                    this._isFirstPosition = true; 
                } else {
                    this.hide();
                    return;
                }
            } else {
                return;
            }
        }

        const [btnX, btnY] = this.buttonActor.get_transformed_position();
        const [btnW, btnH] = this.buttonActor.get_transformed_size();

        if (Number.isNaN(btnX) || Number.isNaN(btnY) || btnW <= 0 || btnH <= 0) return;

        const [, panelW] = this.menuContainer.get_preferred_width(-1);
        const [, panelH] = this.menuContainer.get_preferred_height(-1);

        const stateStr = `${btnX},${btnY},${btnW},${panelW},${panelH}`;
        if (this._lastStateStr === stateStr) return;
        this._lastStateStr = stateStr;

        const dockPosition = this._dockPos || this.dockUI.dockPosition;
        let posX = btnX + (btnW / 2) - (panelW / 2);
        let posY = btnY;

        if (dockPosition === 'BOTTOM') {
            posY = btnY - panelH - POSITION_GAP;
            this.menuContainer.set_pivot_point(0.5, 1.0);
        } else if (dockPosition === 'TOP') {
            posY = btnY + btnH + POSITION_GAP;
            this.menuContainer.set_pivot_point(0.5, 0.0);
        } else if (dockPosition === 'LEFT') {
            posX = btnX + btnW + POSITION_GAP;
            posY = btnY + (btnH / 2) - (panelH / 2);
            this.menuContainer.set_pivot_point(0.0, 0.5);
        } else if (dockPosition === 'RIGHT') {
            posX = btnX - panelW - POSITION_GAP;
            posY = btnY + (btnH / 2) - (panelH / 2);
            this.menuContainer.set_pivot_point(1.0, 0.5);
        }

        if (posX < 10) posX = 10;
        if (posX + panelW > global.stage.width - 10) posX = global.stage.width - panelW - 10;
        if (dockPosition !== 'BOTTOM' && posY + panelH > global.stage.height - POSITION_GAP) {
            posY = global.stage.height - panelH - POSITION_GAP;
        }

        if (dockPosition === 'BOTTOM' || dockPosition === 'TOP') {
            this.bgDrawingArea._arrowCenter = (btnX + btnW / 2) - posX;
        } else {
            this.bgDrawingArea._arrowCenter = (btnY + btnH / 2) - posY;
        }
        this.bgDrawingArea.queue_repaint();

        if (this._isFirstPosition !== false) {
            this.menuContainer.set_position(posX, posY);
            this._isFirstPosition = false;
        } else {
            this.menuContainer.ease({
                x: posX,
                y: posY,
                duration: 80, 
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        }
    }

    _saveFolderState() {
        this._isInternalSave = true;
        if (this.dockUI.folderManager) {
            this.dockUI.folderManager.saveFolders();
        }
        this.dockUI.queueRender('incremental');
        
        this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 100, () => {
            this._isInternalSave = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    show(dockPosition) {
        this._dockPos = dockPosition;
        this._isFirstPosition = true;

        if (this.dockUI && isActorAlive(this.dockUI.actor) && setMagnifierPauseState) {
            setMagnifierPauseState(this.dockUI.actor, 'folder-menu', true);
        }

        this.timers.remove(this._showDelayId);
        this._showDelayId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, SHOW_MENU_DELAY_MS, () => {
            this._showDelayId = null;
            if (!this.actor) return GLib.SOURCE_REMOVE;

            Main.layoutManager.addChrome(this.actor, { affectsStruts: false });
            if (this.dockUI && isActorAlive(this.dockUI.actor)) {
                const parent = this.actor.get_parent();
                const sibling = this.dockUI.actor;
                const siblingParent = sibling && sibling.get_parent ? sibling.get_parent() : null;
                if (parent && sibling && parent === siblingParent) {
                    parent.set_child_below_sibling(this.actor, sibling);
                }
            }
            this.actor.set_position(0, 0);
            this.actor.set_size(global.stage.width, global.stage.height);

            const ah = 12;
            let padBottom = 16;
            let padTop = 16;
            let padLeft = 16;
            let padRight = 16;
            if (dockPosition === 'BOTTOM') padBottom += ah;
            else if (dockPosition === 'TOP') padTop += ah;
            else if (dockPosition === 'LEFT') padLeft += ah;
            else if (dockPosition === 'RIGHT') padRight += ah;

            this.panel.set_style(`background-color: transparent; border: none; box-shadow: none; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`);

            this.menuContainer.opacity = 0;
            this._updatePosition();

            this.menuContainer.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            this.timers.remove(this._posTrackerId);
            this._posTrackerId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, POSITION_TRACKER_INTERVAL_MS, () => {
                if (!this.actor || !isActorAlive(this.actor) || !this.actor.get_stage()) {
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
        if (!this.actor) return;

        this.timers.remove(this._showDelayId);
        this._showDelayId = null;

        this.timers.remove(this._posTrackerId);
        this._posTrackerId = null;
        
        if (this._emojiOverlay && isActorAlive(this._emojiOverlay)) {
            this._emojiOverlay.destroy();
            this._emojiOverlay = null;
        }

        if (this.dockUI && isActorAlive(this.dockUI.actor) && setMagnifierPauseState) {
            setMagnifierPauseState(this.dockUI.actor, 'folder-menu', false);
        }

        if (this.dockUI && this.dockUI._activeFolderMenu === this) {
            this.dockUI._activeFolderMenu = null;
        }

        if (this.actor && isActorAlive(this.actor) && this.actor.get_parent()) {
            Main.layoutManager.removeChrome(this.actor);
        }

        if (this.menuContainer && isActorAlive(this.menuContainer)) {
            this.menuContainer.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this.actor && isActorAlive(this.actor)) this.actor.destroy();
                    this.actor = null;
                    this.menuContainer = null;
                }
            });
        } else if (this.actor && isActorAlive(this.actor)) {
            this.actor.destroy();
            this.actor = null;
            this.menuContainer = null;
        }
    }
}