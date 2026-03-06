import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import { playTrashEffect } from './effects/TrashEffect.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import { resetMagnification, getDockButtons, getFixedSlots, startDragLoop, stopDragLoop, applyRealtimeFrame } from './Magnifier.js';

let lastSwapTime = 0;

export function applyIconFilter(btn) {
    const appBox = btn.get_child();
    if (!appBox) return;
    const icon = appBox.get_first_child();
    if (icon && icon.set_content_scaling_filters)
        icon.set_content_scaling_filters(1, 1);
}

function _setDragCursor() {
    try {
        if (typeof Meta.CursorShape !== 'undefined') {
            global.display.set_cursor(Meta.CursorShape.DND_IN_DRAG);
        } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DND_IN_DRAG !== undefined) {
            global.display.set_cursor(Meta.Cursor.DND_IN_DRAG);
        }
    } catch (e) {}
}

function _setDefaultCursor() {
    try {
        if (typeof Meta.CursorShape !== 'undefined') {
            global.display.set_cursor(Meta.CursorShape.DEFAULT);
        } else if (typeof Meta.Cursor !== 'undefined' && Meta.Cursor.DEFAULT !== undefined) {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        }
    } catch (e) {}
}

export function setupDragAndDrop(btn, app, dockUI) {
    if (dockUI.settings.get_boolean('lock-icons')) return;
    if (app.is_module) return;

    if (!dockUI.boxActor._delegate) {
        dockUI.boxActor._delegate = { acceptDrop: () => true, handleDragDrop: () => true };
        dockUI.actor._delegate    = { acceptDrop: () => true, handleDragDrop: () => true };
    }
    if (dockUI.bgActor && !dockUI.bgActor._delegate) {
        dockUI.bgActor._delegate  = { acceptDrop: () => true, handleDragDrop: () => true };
    }

    btn.connect('button-press-event', () => { 
        btn._wasDragged = false; 
        return Clutter.EVENT_PROPAGATE; 
    });

    btn._delegate = {
        app,
        button: btn,
        getDragActor: () => {
            const iconSize = dockUI.settings.get_int('icon-size');
            const icon = app.create_icon_texture(iconSize + 16);
            icon.opacity = 255;
            return icon;
        },
        getDragActorSource: () => btn,
        handleDragDrop: () => true,
        acceptDrop: () => true,

        handleDragOver: (source) => {
            const mainActor = dockUI.actor;
            if (!source?.button || !source?.app) return DND.DragMotionResult.CONTINUE;

            const draggedBtn = source.button;
            const allBtns    = getDockButtons(mainActor);
            const draggedIndex = allBtns.indexOf(draggedBtn);
            if (draggedIndex === -1) return DND.DragMotionResult.CONTINUE;

            const now = Date.now();
            if (now - lastSwapTime < 100) return DND.DragMotionResult.MOVE_DROP;

            const isVertical  = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
            const [px, py]    = global.get_pointer();
            const [dx, dy]    = mainActor.get_transformed_position();
            const localCursor = isVertical ? py - dy : px - dx;

            const slots = getFixedSlots(mainActor, isVertical, allBtns);
            if (!slots?.length) return DND.DragMotionResult.CONTINUE;

            let closestIndex = draggedIndex, minDiff = Infinity;
            for (let i = 0; i < allBtns.length; i++) {
                if (!allBtns[i]._delegate?.app || allBtns[i]._delegate.app.is_module) continue;
                
                const diff = Math.abs(slots[i] - localCursor);
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
            }
            lastSwapTime = now;

            const avgSlotWidth = slots.length > 1
                ? (slots[slots.length - 1] - slots[0]) / (slots.length - 1)
                : dockUI.settings.get_int('icon-size') + 8;

            const displaced = [];
            if (closestIndex > draggedIndex) {
                for (let k = draggedIndex + 1; k <= closestIndex; k++) displaced.push({ b: allBtns[k], offset: avgSlotWidth });
            } else {
                for (let k = closestIndex; k < draggedIndex; k++) displaced.push({ b: allBtns[k], offset: -avgSlotWidth });
            }

            displaced.forEach(({ b: dispBtn, offset }) => {
                dispBtn.remove_all_transitions();
                dispBtn._flipOffset    = (dispBtn._flipOffset || 0) + offset;
                dispBtn._flipStartTime = now;
            });

            return DND.DragMotionResult.MOVE_DROP;
        }
    };

    const draggable = DND.makeDraggable(btn, { restoreOnSuccess: false });

    draggable.connect('drag-cancelled', () => {
        if (draggable._dragActor) draggable._dragActor.opacity = 0; 
        const [px, py] = global.get_pointer();
        const [bx, by] = dockUI.boxActor.get_transformed_position();
        const [bw, bh] = dockUI.boxActor.get_transformed_size();
        const isOutside = px < bx - 50 || px > bx + bw + 50 || py < by - 50 || py > by + bh + 50;
        
        if (!isOutside) btn.opacity = 255;
    });

    draggable.connect('drag-begin', () => {
        btn._wasDragged = true; 
        btn.opacity = 0;
        const mainActor = dockUI.actor;
        mainActor._isDragging = true;
        _setDragCursor();

        const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
        const allBtns = getDockButtons(mainActor);

        mainActor._fixedSlots = null;
        getFixedSlots(mainActor, isVertical, allBtns);

        allBtns.forEach(b => { 
            b.remove_all_transitions(); 
            b._flipOffset = 0; 
            b._flipStartTime = null; 
        });
        startDragLoop(mainActor, isVertical, dockUI.settings);
    });

    draggable.connect('drag-end', () => {
        const mainActor = dockUI.actor;
        mainActor._isDragging = false;
        mainActor._lastIconClickTime = Date.now();
        
        _setDefaultCursor();
        stopDragLoop(mainActor);

        if (draggable._dragActor && !draggable._dragActor.is_destroyed()) {
            draggable._dragActor.opacity = 0;
            draggable._dragActor.destroy();
        }

        const [px, py] = global.get_pointer();
        const [bx, by] = dockUI.boxActor.get_transformed_position();
        const [bw, bh] = dockUI.boxActor.get_transformed_size();
        const isOutside = px < bx - 50 || px > bx + bw + 50 || py < by - 50 || py > by + bh + 50;
        
        let appId = typeof app.get_id === 'function' ? app.get_id() : null;

        if (isOutside && appId) {
            let updatedApps = dockUI.appManager.pinnedApps.filter(id => id !== appId);
            dockUI.appManager.savePinnedApps(updatedApps); 
            if (typeof dockUI.appManager.loadPinnedAppsSync === 'function') dockUI.appManager.loadPinnedAppsSync(); 
            else dockUI.appManager.pinnedApps = updatedApps;
            
            btn.opacity = 0;
            if (app.get_state() !== Shell.AppState.RUNNING) {
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
        const currentBtns = getDockButtons(mainActor);

        const newFavorites  = [];
        currentBtns.forEach(b => {
            if (b._delegate?.app && !b._delegate.app.is_module && typeof b._delegate.app.get_id === 'function') {
                const id = b._delegate.app.get_id();
                if (dockUI.appManager.pinnedApps.includes(id) || b === btn) {
                    if (!newFavorites.includes(id)) newFavorites.push(id);
                }
            }
        });
        dockUI.appManager.pinnedApps = newFavorites; 
        dockUI.appManager.savePinnedApps(newFavorites);
        if (typeof dockUI.appManager.loadPinnedAppsSync === 'function') dockUI.appManager.loadPinnedAppsSync();

        const [dx, dy] = mainActor.get_transformed_position();
        const [dw, dh] = mainActor.get_transformed_size();
        const isInsideMain = px >= dx - 20 && px <= dx + dw + 20 && py >= dy - 20 && py <= dy + dh + 20;

        if (!isInsideMain) {
            currentBtns.forEach(b => {
                b._flipOffset = 0; b._flipStartTime = null;
                b.ease({ translation_x: 0, translation_y: 0, scale_x: 1.0, scale_y: 1.0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            });
        } else {
            currentBtns.forEach(b => { b._flipOffset = 0; b._flipStartTime = null; });
            const isVert = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
            applyRealtimeFrame(mainActor, px, py, isVert, dockUI.settings, Date.now());
        }

        if (!isInsideMain) resetMagnification(mainActor);
        mainActor._fixedSlots = null;
    });
}