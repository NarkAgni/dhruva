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


import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Settings } from '../../core/SettingsManager.js';
import { isActorAlive, markActorDisposed } from '../../core/Utils.js';
import { isPointerWithinDockBounds } from '../magnifier/MagnifierMath.js';


const MOVE_MS = 300;
const ENTER_MS = 340;
const ENTER_FADE_MS = 180;
const EXIT_MS = 220;
const BG_RESIZE_MS = 300;
const ATTENTION_MS = 460;
const INDICATOR_POP_MS = 320;

const ENTER_START_SCALE = 0.3;
const EXIT_END_SCALE = 0.35;
const EDGE_DRIFT_PX = 14;
const MIN_MOVE_PX = 1;

const GHOST_TYPES = new Set(['app', 'folder', 'module']);
const ENTER_TYPES = new Set(['app', 'folder', 'module', 'overflow', 'separator', 'music-pill']);


function towardDockEdge(dockPos) {
    switch (dockPos) {
        case 'TOP': return [0, -1];
        case 'LEFT': return [-1, 0];
        case 'RIGHT': return [1, 0];
        default: return [0, 1];
    }
}

function setEdgePivot(actor, dockPos) {
    switch (dockPos) {
        case 'TOP': actor.set_pivot_point(0.5, 0.0); break;
        case 'LEFT': actor.set_pivot_point(0.0, 0.5); break;
        case 'RIGHT': actor.set_pivot_point(1.0, 0.5); break;
        default: actor.set_pivot_point(0.5, 1.0); break;
    }
}

function transformedRect(actor) {
    if (!actor.has_allocation()) return null;

    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

function ghostSet(dockUI) {
    if (!dockUI._exitGhosts) dockUI._exitGhosts = new Set();
    return dockUI._exitGhosts;
}


export function captureDockTransition(dockUI) {
    if (!dockUI._initialLayoutDone || !dockUI.actor.is_mapped()) return null;

    const rects = new Map();
    const actors = new Map();
    for (const [key, entry] of dockUI._actorRegistry) {
        if (!isActorAlive(entry.actor) || !entry.actor.is_mapped()) continue;
        const rect = transformedRect(entry.actor);
        if (!rect) continue;
        rects.set(key, rect);
        actors.set(key, { actor: entry.actor, type: entry.type, isRunning: entry.isRunning });
    }

    return { rects, actors, bgRect: transformedRect(dockUI.bgActor) };
}

export function releaseRemovedItems(dockUI, transition, keptKeys) {
    const draggedOutKey = dockUI._draggedOutKey;

    for (const [key, { actor, type }] of transition.actors) {
        if (keptKeys.has(key) || key === draggedOutKey || !GHOST_TYPES.has(type)) continue;
        if (actor === dockUI._musicPill || actor._isOverflowBtn) continue;
        spawnExitGhost(dockUI, actor, transition.rects.get(key));
    }
}

function spawnExitGhost(dockUI, actor, rect) {
    const [width, height] = actor.get_size();
    if (width <= 0 || height <= 0) return;

    const scale = rect.w / width;
    const [edgeX, edgeY] = towardDockEdge(dockUI.dockPosition);

    actor.remove_all_transitions();
    actor.get_parent().remove_child(actor);
    markActorDisposed(actor);
    actor.reactive = false;

    actor.set_pivot_point(0.5, 0.5);
    actor.set_size(width, height);
    actor.set_scale(scale, scale);
    actor.translation_x = 0;
    actor.translation_y = 0;
    actor.set_position(rect.x + (rect.w - width) / 2, rect.y + (rect.h - height) / 2);
    Main.layoutManager.uiGroup.add_child(actor);

    const ghosts = ghostSet(dockUI);
    ghosts.add(actor);

    actor.ease({
        opacity: 0,
        scale_x: scale * EXIT_END_SCALE,
        scale_y: scale * EXIT_END_SCALE,
        translation_x: edgeX * EDGE_DRIFT_PX,
        translation_y: edgeY * EDGE_DRIFT_PX,
        duration: EXIT_MS,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onStopped: () => {
            ghosts.delete(actor);
            actor.destroy();
        },
    });
}

export function playDockTransition(dockUI, transition) {
    if (!isActorAlive(dockUI.actor)) return;

    dockUI.boxActor.get_allocation_box();

    const dockScale = dockUI.actor.scale_x;
    if (!(dockScale > 0)) return;
    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const [px, py] = global.get_pointer();
    const canSlide = !(Settings.hoverZoom && isPointerWithinDockBounds(dockUI.actor, px, py, isVertical, dockUI.settings));

    let isAnimating = false;
    for (const [key, entry] of dockUI._actorRegistry) {
        const oldRect = transition.rects.get(key);
        if (!oldRect) {
            if (ENTER_TYPES.has(entry.type)) {
                playEnter(entry.actor, dockUI.dockPosition);
                isAnimating = true;
            }
        } else {
            if (canSlide && playSlide(entry.actor, oldRect, dockScale)) isAnimating = true;
            if (entry.isRunning && !transition.actors.get(key).isRunning) playIndicatorPop(entry.actor);
        }
    }

    if (playBackgroundResize(dockUI, transition.bgRect, dockScale)) isAnimating = true;
    if (playPendingAttention(dockUI)) isAnimating = true;

    holdMagnifier(dockUI, isAnimating);
}

function playSlide(actor, oldRect, dockScale) {
    const newRect = transformedRect(actor);
    if (!newRect) return false;

    const dx = (oldRect.x - newRect.x) / dockScale;
    const dy = (oldRect.y - newRect.y) / dockScale;
    if (Math.abs(dx) < MIN_MOVE_PX && Math.abs(dy) < MIN_MOVE_PX) return false;

    actor.remove_transition('translation-x');
    actor.remove_transition('translation-y');
    actor.translation_x += dx;
    actor.translation_y += dy;
    actor.ease({
        translation_x: 0,
        translation_y: 0,
        duration: MOVE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
    return true;
}

function playEnter(actor, dockPos) {
    const [edgeX, edgeY] = towardDockEdge(dockPos);

    actor.remove_all_transitions();
    setEdgePivot(actor, dockPos);
    actor.opacity = 0;
    actor.set_scale(ENTER_START_SCALE, ENTER_START_SCALE);
    actor.translation_x = edgeX * EDGE_DRIFT_PX;
    actor.translation_y = edgeY * EDGE_DRIFT_PX;

    actor.ease({
        opacity: 255,
        duration: ENTER_FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    actor.ease({
        scale_x: 1.0,
        scale_y: 1.0,
        translation_x: 0,
        translation_y: 0,
        duration: ENTER_MS,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
    });
}

function playIndicatorPop(actor) {
    const indicator = actor._indicatorActor;
    if (!indicator) return;

    const targetX = 1.0 / Math.max(0.01, actor.scale_x);
    const targetY = 1.0 / Math.max(0.01, actor.scale_y);

    indicator.set_pivot_point(0.5, 0.5);
    indicator.opacity = 0;
    indicator.set_scale(0.2 * targetX, 0.2 * targetY);
    indicator.ease({ opacity: 255, duration: INDICATOR_POP_MS / 2, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    indicator.ease({
        scale_x: targetX,
        scale_y: targetY,
        duration: INDICATOR_POP_MS,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
    });
}

function playBackgroundResize(dockUI, oldRect, dockScale) {
    const actorRect = transformedRect(dockUI.actor);
    if (!oldRect || !actorRect) return false;

    const bg = dockUI.bgActor;
    const { x: actorX, y: actorY } = actorRect;

    const from = {
        x: (oldRect.x - actorX) / dockScale,
        y: (oldRect.y - actorY) / dockScale,
        width: oldRect.w / dockScale,
        height: oldRect.h / dockScale,
    };
    const to = { x: bg.x, y: bg.y, width: bg.width, height: bg.height };

    const hasChanged = Object.keys(to).some(prop => Math.abs(to[prop] - from[prop]) >= MIN_MOVE_PX);
    if (!hasChanged) return false;

    bg.remove_all_transitions();
    bg.set_position(from.x, from.y);
    bg.set_size(from.width, from.height);
    bg.ease({ ...to, duration: BG_RESIZE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    return true;
}

export function requestAttention(dockUI, matcher) {
    dockUI._pendingAttention = matcher;
}

function playPendingAttention(dockUI) {
    const matcher = dockUI._pendingAttention;
    dockUI._pendingAttention = null;
    if (!matcher) return false;

    for (const entry of dockUI._actorRegistry.values()) {
        if (matcher(entry.actor)) {
            setEdgePivot(entry.actor, dockUI.dockPosition);
            playSquashStretch(entry.actor);
            return true;
        }
    }
    return false;
}

function playSquashStretch(actor) {
    const step = ATTENTION_MS / 4;
    actor.ease({
        scale_x: 1.14,
        scale_y: 0.84,
        duration: step,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => actor.ease({
            scale_x: 0.92,
            scale_y: 1.12,
            duration: step,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => actor.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: step * 2,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            }),
        }),
    });
}

function holdMagnifier(dockUI, isAnimating) {
    if (dockUI._transitionHoldId) {
        dockUI.registry.remove(dockUI._transitionHoldId);
        dockUI._transitionHoldId = null;
    }

    dockUI.actor._flipAnimating = isAnimating;
    if (!isAnimating) return;

    dockUI._transitionHoldId = dockUI.registry.addTimeout(GLib.PRIORITY_DEFAULT, Math.max(ENTER_MS, ATTENTION_MS), () => {
        dockUI._transitionHoldId = null;
        dockUI.actor._flipAnimating = false;
        return GLib.SOURCE_REMOVE;
    });
}

export function cancelDockTransitions(dockUI) {
    for (const ghost of [...ghostSet(dockUI)]) ghost.remove_all_transitions();
}
