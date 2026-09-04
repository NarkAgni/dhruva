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


import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { playTrashEffect } from './effects/TrashEffect.js';
import { getDockButtons, getFixedSlots } from './magnifier/MagnifierMath.js';
import { stopDragLoop, startDragLoop } from './magnifier/MagnifierDragLoop.js';
import { resetMagnification, applyRealtimeFrame } from './magnifier/Magnifier.js';


let lastSwapTime = 0;

function _sourceDelegate(source) {
    return (source && source._delegate) || source || {};
}

function _sourceButton(source) {
    const delegate = _sourceDelegate(source);
    return delegate.button || (source && source.button) || (source && source.get_parent ? source : null);
}

function _sourceId(source) {
    const delegate = _sourceDelegate(source);
    const srcApp = delegate.app || (source && source.app) || null;
    if (delegate.appId) return delegate.appId;
    if (srcApp && srcApp.get_id) return srcApp.get_id();
    const srcBtn = _sourceButton(source);
    if (srcBtn && srcBtn._isFolder && srcBtn._folderData) return srcBtn._folderData.id;
    return null;
}

function isActorAlive(actor) {
    if (!actor) return false;
    return actor.visible !== undefined;
}

function _setMergeHint(btn, dockUI) {
    if (!isActorAlive(btn)) return;
    const mainActor = dockUI.actor;

    if (mainActor._mergeTargetButton && mainActor._mergeTargetButton !== btn)
        _clearMergeHint(mainActor._mergeTargetButton, dockUI);

    mainActor._mergeDropActive = true;
    mainActor._mergeTargetButton = btn;

    if (!btn._mergeHintApplied) {
        btn._mergeHintApplied = true;
        btn._mergeHintStyle = btn.get_style ? btn.get_style() : null;
        if (btn.set_style) {
            btn.set_style('background-color: rgba(255, 255, 255, 0.16); border-radius: 10px; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.34); transition-duration: 200ms;');
        }
    }
}

function _clearMergeHint(btn, dockUI) {
    if (!isActorAlive(btn)) return;
    if (btn._mergeHintApplied) {
        btn._mergeHintApplied = false;
        if (btn.set_style) {
            btn.set_style(`${btn._mergeHintStyle || ''} transition-duration: 200ms;`);
        }
        btn._mergeHintStyle = null;
        btn._wantsToMerge = false;
        btn._reorderWaitTime = null;
    }

    const mainActor = dockUI && dockUI.actor;
    if (mainActor && (!btn || mainActor._mergeTargetButton === btn)) {
        mainActor._mergeDropActive = false;
        mainActor._mergeTargetButton = null;
    }
}

export function applyIconFilter(btn) {
    const appBox = btn.get_child();
    if (!appBox) return;
    const icon = appBox.get_first_child();
    if (icon && icon.set_content_scaling_filters)
        icon.set_content_scaling_filters(1, 1);
}

export function setupDragAndDrop(btn, app, dockUI) {
    if (dockUI.settings.get_boolean('lock-icons')) return;
    if (app && app.is_module) return;

    const clearHintsOnLeave = () => {
        if (dockUI.actor._mergeTargetButton)
            _clearMergeHint(dockUI.actor._mergeTargetButton, dockUI);
        return DND.DragMotionResult.MOVE_DROP;
    };

    const registerContainerDelegate = (actor) => {
        if (isActorAlive(actor)) {
            if (!actor._delegate) actor._delegate = {};
            actor._delegate.acceptDrop = () => true;
            actor._delegate.handleDragDrop = () => true;
            actor._delegate.handleDragOver = clearHintsOnLeave;
        }
    };

    registerContainerDelegate(dockUI.boxActor);
    registerContainerDelegate(dockUI.actor);
    registerContainerDelegate(dockUI.bgActor);

    btn.connect('button-press-event', () => {
        btn._wasDragged = false;
        return Clutter.EVENT_PROPAGATE;
    });

    btn._delegate = {
        app,
        isFolder: btn._isFolder || false,
        folderData: btn._folderData || null,
        button: btn,

        getDragActor: () => {
            const icon = btn.get_child();
            const clone = new Clutter.Clone({ source: icon });
            clone.reactive = false;
            return clone;
        },
        getDragActorSource: () => btn,

        _handleMergeOrDrop: function (source) {
            const sourceBtn = _sourceButton(source);
            if (btn._wantsToMerge && sourceBtn) {
                const sourceDelegate = _sourceDelegate(source);
                const isDraggedFolder = sourceBtn._isFolder || sourceDelegate.isFolder;
                const draggedId = (isDraggedFolder && sourceBtn._folderData) ? sourceBtn._folderData.id : _sourceId(source);

                if (!isDraggedFolder && draggedId && dockUI.folderManager) {
                    if (btn._isFolder) {
                        dockUI.folderManager.addAppToFolder(btn._folderData.id, draggedId);
                    } else {
                        const targetAppId = (app && app.get_id) ? app.get_id() : null;
                        if (targetAppId && targetAppId !== draggedId) {
                            const folderId = dockUI.folderManager.createFolder("New Folder");
                            dockUI.folderManager.addAppToFolder(folderId, targetAppId);
                            dockUI.folderManager.addAppToFolder(folderId, draggedId);
                        }
                    }
                }

                _clearMergeHint(btn, dockUI);
                sourceBtn._wasMerged = true;
                dockUI.queueRender();
                return true;
            }
            _clearMergeHint(btn, dockUI);
            return true;
        },

        acceptDrop: function (source) {
            return this._handleMergeOrDrop(source);
        },
        handleDragDrop: function (source) {
            return this._handleMergeOrDrop(source);
        },

        handleDragOver: (source) => {
            const mainActor = dockUI.actor;
            const sourceBtn = _sourceButton(source);
            if (!sourceBtn) return DND.DragMotionResult.MOVE_DROP;

            const draggedBtn = sourceBtn;
            const isDraggedFolder = draggedBtn._isFolder;
            const isTargetFolder = btn._isFolder;

            const draggedId = (isDraggedFolder && draggedBtn._folderData) ? draggedBtn._folderData.id : _sourceId(source);
            const targetId = isTargetFolder ? btn._folderData.id : (app && app.get_id ? app.get_id() : null);

            const [, , mods] = global.get_pointer();
            const isCtrlPressed = (mods & Clutter.ModifierType.CONTROL_MASK) !== 0;

            const canMerge = (!isDraggedFolder && targetId && draggedId && draggedId !== targetId);

            if (isCtrlPressed) {
                if (canMerge) {
                    if (!btn._wantsToMerge) {
                        if (dockUI.actor._mergeTargetButton && dockUI.actor._mergeTargetButton !== btn) {
                            _clearMergeHint(dockUI.actor._mergeTargetButton, dockUI);
                        }
                        btn._wantsToMerge = true;
                        _setMergeHint(btn, dockUI);
                    }
                    return DND.DragMotionResult.COPY_DROP;
                } else {
                    if (btn._wantsToMerge) _clearMergeHint(btn, dockUI);
                    return DND.DragMotionResult.CONTINUE;
                }
            }

            const allBtns = getDockButtons(mainActor);
            const draggedIndex = allBtns.indexOf(draggedBtn);
            if (draggedIndex === -1) return DND.DragMotionResult.MOVE_DROP;

            const now = Date.now();
            if (now - lastSwapTime < 80) return DND.DragMotionResult.MOVE_DROP;

            const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
            const [px, py] = global.get_pointer();

            let closestIndex = draggedIndex;
            let minDiff = Infinity;

            for (let i = 0; i < allBtns.length; i++) {
                const targetBtn = allBtns[i];
                const targetBtnDelegate = targetBtn._delegate;
                if (!targetBtnDelegate) continue;

                if (!targetBtnDelegate.isFolder && (!targetBtnDelegate.app || targetBtnDelegate.app.is_module)) continue;

                const [bx, by] = targetBtn.get_transformed_position();
                const [bw, bh] = targetBtn.get_transformed_size();

                const visualCenter = isVertical ? (by + bh / 2) : (bx + bw / 2);
                const cursorCoord = isVertical ? py : px;

                const diff = Math.abs(visualCenter - cursorCoord);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIndex = i;
                }
            }

            if (closestIndex === draggedIndex) return DND.DragMotionResult.MOVE_DROP;

            const targetBtn = allBtns[closestIndex];
            const realBoxChildren = dockUI.boxActor.get_children();
            const realTargetIndex = realBoxChildren.indexOf(targetBtn);

            if (realTargetIndex !== -1) {
                dockUI.boxActor.set_child_at_index(draggedBtn, realTargetIndex);
                mainActor._fixedSlots = null;
            }
            lastSwapTime = now;

            const avgSlotWidth = dockUI.settings.get_int('icon-size') + 8;
            const displaced = [];
            if (closestIndex > draggedIndex) {
                for (let k = draggedIndex + 1; k <= closestIndex; k++)
                    displaced.push({ b: allBtns[k], offset: avgSlotWidth });
            } else {
                for (let k = closestIndex; k < draggedIndex; k++)
                    displaced.push({ b: allBtns[k], offset: -avgSlotWidth });
            }

            displaced.forEach(({ b: dispBtn, offset }) => {
                if (dispBtn.remove_all_transitions) dispBtn.remove_all_transitions();
                dispBtn._flipOffset = (dispBtn._flipOffset || 0) + offset;
                dispBtn._flipStartTime = now;
            });

            return DND.DragMotionResult.MOVE_DROP;
        }
    };

    const draggable = DND.makeDraggable(btn, { restoreOnSuccess: false });

    draggable.connect('drag-cancelled', () => {
        if (dockUI.actor._mergeTargetButton)
            _clearMergeHint(dockUI.actor._mergeTargetButton, dockUI);

        if (draggable._dragActor)
            draggable._dragActor.opacity = 0;

        const [px, py] = global.get_pointer();
        const [bx, by] = dockUI.boxActor.get_transformed_position();
        const [bw, bh] = dockUI.boxActor.get_transformed_size();
        const isOutside = px < bx - 50 || px > bx + bw + 50 || py < by - 50 || py > by + bh + 50;

        if (!isOutside && isActorAlive(btn)) {
            btn.opacity = 255;
        }
    });

    draggable.connect('drag-begin', () => {
        btn._wasDragged = true;
        btn.opacity = 0;
        const mainActor = dockUI.actor;
        mainActor._isDragging = true;
        mainActor._mergeDropActive = false;
        mainActor._mergeTargetButton = null;

        const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
        const allBtns = getDockButtons(mainActor);

        mainActor._fixedSlots = null;
        getFixedSlots(mainActor, isVertical, allBtns);

        allBtns.forEach(b => {
            if (b.remove_all_transitions) b.remove_all_transitions();
            b._flipOffset = 0;
            b._flipStartTime = null;
        });
        startDragLoop(mainActor, isVertical, dockUI.settings);
    });

    draggable.connect('drag-end', () => {
        const mainActor = dockUI.actor;
        mainActor._isDragging = false;
        mainActor._lastIconClickTime = Date.now();
        if (mainActor._mergeTargetButton)
            _clearMergeHint(mainActor._mergeTargetButton, dockUI);

        stopDragLoop(mainActor);

        if (draggable._dragActor && isActorAlive(draggable._dragActor)) {
            draggable._dragActor.opacity = 0;
            draggable._dragActor.destroy();
        }

        if (btn._wasMerged) {
            btn._wasMerged = false;
            btn.opacity = 255;
            mainActor._fixedSlots = null;
            return;
        }

        const [px, py] = global.get_pointer();
        const [bx, by] = dockUI.boxActor.get_transformed_position();
        const [bw, bh] = dockUI.boxActor.get_transformed_size();
        const isOutside = px < bx - 50 || px > bx + bw + 50 || py < by - 50 || py > by + bh + 50;

        const entityId = btn._isFolder ? btn._folderData.id : (app && app.get_id ? app.get_id() : null);

        const [dx, dy] = mainActor.get_transformed_position();
        const [dw, dh] = mainActor.get_transformed_size();
        const isInsideMain = px >= dx - 20 && px <= dx + dw + 20 && py >= dy - 20 && py <= dy + dh + 20;

        if (isOutside && !isInsideMain && entityId) {
            if (btn._isFolder) {
                dockUI.folderManager.deleteFolder(entityId);
            } else {
                dockUI.appManager.removeApp(app);

                const isIndependent = dockUI.settings.get_boolean('independent-dock');
                if (!isIndependent && app && app.get_id) {
                    try {
                        const appId = app.get_id();
                        const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
                        const currentFavs = shellSettings.get_strv('favorite-apps') || [];
                        if (currentFavs.includes(appId)) {
                            const newFavs = currentFavs.filter(id => id !== appId);
                            shellSettings.set_strv('favorite-apps', newFavs);
                        }
                    } catch (e) {
                        console.error(`[Dhruva] Failed to unpin from GNOME Dash: ${e.message}`);
                    }
                }
            }

            btn.opacity = 0;
            if (btn._isFolder || (app && app.get_state() !== Shell.AppState.RUNNING)) {
                playTrashEffect(app, px, py, dockUI.settings.get_int('icon-size'));
            }

            mainActor._lastIconClickTime = 0;
            dockUI._renderDock();
            resetMagnification(mainActor);
            mainActor._fixedSlots = null;
            return;
        }

        btn.opacity = 255;
        btn._wasDragged = false;

        if (isInsideMain && entityId && !btn._isFolder && !dockUI.appManager.hasApp(app)) {
            dockUI.appManager.addApp(app);
        }

        const currentBtns = getDockButtons(mainActor);
        const newOrderKeys = [];
        currentBtns.forEach(b => {
            if (b._delegate) {
                if (b._delegate.isFolder && b._delegate.folderData) {
                    newOrderKeys.push(`folder:${b._delegate.folderData.id}`);
                } else if (b._delegate.app && !b._delegate.app.is_module && b._delegate.app.get_id) {
                    newOrderKeys.push(b._delegate.app.get_id());
                }
            }
        });

        if (dockUI.appManager.saveDockOrder) {
            dockUI.appManager.saveDockOrder(newOrderKeys);
        }

        const isIndependent = dockUI.settings.get_boolean('independent-dock');

        if (isIndependent) {
            const currentPinnedIds = dockUI.appManager.pinnedApps || [];
            const onlyAppIds = newOrderKeys.filter(id => !id.startsWith('folder:'));
            const finalPinnedOrder = onlyAppIds.filter(id => currentPinnedIds.includes(id) || id === entityId);

            currentPinnedIds.forEach(id => {
                if (!finalPinnedOrder.includes(id)) {
                    finalPinnedOrder.push(id);
                }
            });

            dockUI.appManager.savePinnedApps(finalPinnedOrder);
        } else {
            const favManager = dockUI.appManager.favManager;
            const currentFavIds = favManager.getFavorites().map(a => a.get_id());
            const onlyAppIds = newOrderKeys.filter(id => !id.startsWith('folder:'));

            const finalFavOrder = onlyAppIds.filter(id => currentFavIds.includes(id) || id === entityId);

            currentFavIds.forEach(id => {
                if (!finalFavOrder.includes(id)) {
                    finalFavOrder.push(id);
                }
            });

            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            shellSettings.set_strv('favorite-apps', finalFavOrder);
        }

        if (!isInsideMain) {
            currentBtns.forEach(b => {
                b._flipOffset = 0;
                b._flipStartTime = null;
            });
            resetMagnification(mainActor);
        } else {
            currentBtns.forEach(b => {
                b._flipOffset = 0;
                b._flipStartTime = null;
            });
            const isVert = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
            applyRealtimeFrame(mainActor, px, py, isVert, dockUI.settings, Date.now());
        }

        mainActor._fixedSlots = null;
    });
}