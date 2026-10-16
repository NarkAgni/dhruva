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

import { isActorAlive } from '../Utils.js';
import { TimeoutTracker } from '../TimeoutTracker.js';
import { HYBRID_PANEL_CONFIG } from '../PanelConfig.js';


const NO_ANIMATION = 0;
const MEASURE_DELAY_MS = 20;
const MAX_LOCK_ATTEMPTS = 5;

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

const SIDE_TOWARD_DOCK = { BOTTOM: St.Side.BOTTOM, TOP: St.Side.TOP, LEFT: St.Side.LEFT, RIGHT: St.Side.RIGHT };

function boxMarginTowardDock(dockUI, menu) {
    return menu.box.get_theme_node().get_margin(SIDE_TOWARD_DOCK[dockUI.dockPosition]);
}

function rectOf(actor) {
    const [x, y] = actor.get_transformed_position();
    const box = actor.get_allocation_box();
    return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(box.get_width()),
        h: Math.round(box.get_height()),
    };
}

function gapFromSource(dockUI, menu) {
    const s = rectOf(menu.sourceActor);
    const d = rectOf(dockUI.bgActor);
    const scale = scaleFactor();
    const target = HYBRID_PANEL_CONFIG.POPUP_BOX_GAP * scale;

    let insideDock;
    switch (dockUI.dockPosition) {
        case 'TOP': insideDock = (d.y + d.h) - (s.y + s.h); break;
        case 'LEFT': insideDock = (d.x + d.w) - (s.x + s.w); break;
        case 'RIGHT': insideDock = s.x - d.x; break;
        default: insideDock = s.y - d.y; break;
    }
    return (insideDock + target - boxMarginTowardDock(dockUI, menu)) / scale;
}

function applyGap(state, menu) {
    const gap = gapFromSource(state.dockUI, menu);
    state.boxPointer.set_style(`-arrow-rise: 0px; -boxpointer-gap: ${gap.toFixed(2)}px;`);
}

function visibleGap(dockPos, dock, box) {
    switch (dockPos) {
        case 'TOP': return box.y - (dock.y + dock.h);
        case 'LEFT': return box.x - (dock.x + dock.w);
        case 'RIGHT': return dock.x - (box.x + box.w);
        default: return dock.y - (box.y + box.h);
    }
}

function scheduleLock(state, menu) {
    state.timers.remove(state.measureId);
    state.measureId = state.timers.addTimeout(GLib.PRIORITY_DEFAULT, MEASURE_DELAY_MS, () => {
        state.measureId = 0;
        lockPosition(state, menu);
        return GLib.SOURCE_REMOVE;
    });
}

function lockPosition(state, menu) {
    const { dockUI, boxPointer } = state;
    if (!menu.isOpen || !isActorAlive(boxPointer)) return;

    const box = rectOf(menu.box);
    if (box.w <= 0 || box.h <= 0) {
        if (state.lockAttempts++ < MAX_LOCK_ATTEMPTS) scheduleLock(state, menu);
        else reveal(state);
        return;
    }

    const dock = rectOf(dockUI.bgActor);
    const target = HYBRID_PANEL_CONFIG.POPUP_BOX_GAP * scaleFactor();
    const delta = visibleGap(dockUI.dockPosition, dock, box) - target;

    switch (dockUI.dockPosition) {
        case 'TOP': boxPointer.translation_y -= delta; break;
        case 'LEFT': boxPointer.translation_x -= delta; break;
        case 'RIGHT': boxPointer.translation_x += delta; break;
        default: boxPointer.translation_y += delta; break;
    }

    reveal(state);
}

function reveal(state) {
    state.boxPointer.opacity = 255;
}

export function hookPopupGap(dockUI, menu) {
    if (menu._dhruvaGapState) return;
    const boxPointer = menu._boxPointer;

    const state = {
        dockUI, boxPointer,
        originalStyle: boxPointer.style,
        originalOpacity: boxPointer.opacity,
        measureId: 0,
        lockAttempts: 0,
        timers: new TimeoutTracker(),
    };
    menu._dhruvaGapState = state;

    menu.connectObject('open-state-changed', (_menu, isOpen) => {
        if (!dockUI || !dockUI.autoHideManager) return;
        if (isOpen) {
            dockUI.autoHideManager.show();
        } else {
            dockUI.autoHideManager.scheduleCheck(100);
        }
    }, state);

    const originalOpen = boxPointer.open;
    const originalClose = boxPointer.close;
    boxPointer.open = function (_animate, onComplete) {
        if (dockUI && dockUI.autoHideManager) {
            dockUI.autoHideManager.show();
        }
        this.translation_x = 0;
        this.translation_y = 0;
        applyGap(state, menu);
        state.lockAttempts = 0;
        const result = originalOpen.call(this, NO_ANIMATION, onComplete);

        this.queue_relayout();
        this.bin.queue_relayout();
        menu.box.queue_relayout();

        this.opacity = 0;
        scheduleLock(state, menu);
        menu.box.connectObject('notify::allocation', () => scheduleLock(state, menu), state);
        this.connectObject('notify::allocation', () => scheduleLock(state, menu), state);
        return result;
    };
    boxPointer.close = function (_animate, onComplete) {
        menu.box.disconnectObject(state);
        this.disconnectObject(state);
        state.timers.remove(state.measureId);
        state.measureId = 0;
        if (dockUI && dockUI.autoHideManager) {
            dockUI.autoHideManager.scheduleCheck(100);
        }
        return originalClose.call(this, NO_ANIMATION, onComplete);
    };
}

export function unhookPopupGap(menu) {
    const state = menu._dhruvaGapState;
    if (!state) return;

    state.timers.destroy();
    menu.disconnectObject(state);
    menu.box.disconnectObject(state);
    const boxPointer = state.boxPointer;
    if (isActorAlive(boxPointer)) {
        delete boxPointer.open;
        delete boxPointer.close;
        boxPointer.disconnectObject(state);
        boxPointer.set_style(state.originalStyle);
        boxPointer.opacity = state.originalOpacity;
        boxPointer.translation_x = 0;
        boxPointer.translation_y = 0;
    }
    delete menu._dhruvaGapState;
}