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
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { isActorAlive } from '../../core/Utils.js';
import PeekManager from '../../core/PeekManager.js';
import { Settings } from '../../core/SettingsManager.js';
import { FrameTicker } from '../../core/FrameTicker.js';
import { resetMagnification } from './MagnifierReset.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { isContextMenuOpen, isAppGridOpen } from './MagnifierState.js';
import { getDockButtons, getFixedSlots, easeOutCirc, isStaticItem, axisSpan, getPanelSideActors } from './MagnifierMath.js';
import { createTooltipActor, populateTooltipContent, resumeTooltipTracking } from './MagnifierTooltipRenderer.js';
import { TOOLTIP_GAP, clearTooltipDelay, hideTooltip, isInsideTooltip, isPointerInDockTooltipBridge } from './MagnifierTooltip.js';


const FLIP_DURATION = 300;
const GAP_EASE_MS = 70;
const TOOLTIP_DELAY_MS = 600;
const MIN_ARROW_PADDING = 18;
const HOVER_EDGE_PX = 8;
const STAGE_EDGE_MARGIN = 8;
const REFERENCE_FRAME_MS = 1000 / 60;
const PANEL_CORRIDOR_GAP = 8;
const DOCK_BG_BUFFER = 16;

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function approach(current, target, factor) {
    return Math.abs(target - current) < 0.0015 ? target : current + (target - current) * factor;
}

function calculateScaleCurve(dist, radius, zoomRange, style) {
    if (dist >= radius) return 1.0;
    const ratio = dist / radius;
    const baseBell = (Math.cos(ratio * Math.PI) + 1) * 0.5;

    if (style === 'domino') {
        return 1.0 + zoomRange * Math.pow(baseBell, 1.25);
    } else if (style === 'cylinder') {
        const arcDepth = Math.sin((1.0 - ratio) * (Math.PI * 0.5));
        return 1.0 + zoomRange * Math.pow(arcDepth, 1.4);
    } else if (style === 'magnetic') {
        return 1.0 + zoomRange * Math.pow(baseBell, 1.6);
    } else if (style === 'jelly') {
        return 1.0 + zoomRange * baseBell;
    } else if (style === 'coverflow') {
        const cfPlateau = 1.0 - smoothstep(0.0, 1.0, Math.pow(ratio, 1.3));
        return 1.0 + zoomRange * cfPlateau;
    }

    return 1.0 + zoomRange * baseBell;
}

function getLateralLimits(dockActor, isVertical) {
    let start = STAGE_EDGE_MARGIN;
    let end = (isVertical ? global.stage.height : global.stage.width) - STAGE_EDGE_MARGIN;

    if (Settings.hybridPanelMode) {
        const sides = getPanelSideActors(dockActor);
        sides.start.forEach(actor => {
            if (actor.visible) start = Math.max(start, axisSpan(actor, isVertical)[1] + PANEL_CORRIDOR_GAP);
        });
        sides.end.forEach(actor => {
            if (actor.visible && actor.reactive) end = Math.min(end, axisSpan(actor, isVertical)[0] - PANEL_CORRIDOR_GAP);
        });
        return { start, end };
    }

    const desktop = dockActor._dockUI ? dockActor._dockUI.extractedDesktop : null;
    if (!isVertical && isActorAlive(desktop) && desktop.visible) {
        const deskX = desktop.x;
        if (deskX > 0 && (deskX - 24) < end) end = deskX - 24;
    }
    return { start, end };
}

function getIconRowShift(dockActor, btns, isVertical, origin, centers, sizeScales) {
    const { start, end } = getLateralLimits(dockActor, isVertical);
    const dockScale = (isVertical ? dockActor.scale_y : dockActor.scale_x) || 1.0;

    let minEdge = Infinity;
    let maxEdge = -Infinity;
    for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const size = ((isVertical ? b.height : b.width) || 48) * sizeScales[i] * dockScale;
        const center = origin + centers[i] * dockScale;
        minEdge = Math.min(minEdge, center - size / 2);
        maxEdge = Math.max(maxEdge, center + size / 2);
    }

    let shift = 0;
    if (maxEdge > end) shift = (end - maxEdge) / dockScale;
    else if (minEdge < start) shift = (start - minEdge) / dockScale;

    if (minEdge + shift * dockScale < start) shift = (start - minEdge) / dockScale;
    return shift;
}

function getDynamicPanelShift(dockActor, isVertical, origin, startExp, endExp) {
    const bg = dockActor.bgActor;
    const dockUI = dockActor._dockUI;
    if (!isActorAlive(bg) || bg._baseW === undefined || !dockUI) return 0;

    const monitorResult = dockUI.monitorManager.getCurrentMonitor();
    if (!monitorResult || !monitorResult.monitor) return 0;

    const monitor = monitorResult.monitor;
    const dockScale = (isVertical ? dockActor.scale_y : dockActor.scale_x) || 1.0;
    const monStart = isVertical ? monitor.y : monitor.x;
    const monEnd = monStart + (isVertical ? monitor.height : monitor.width);
    const base = isVertical ? bg._baseY : bg._baseX;
    const baseSize = isVertical ? bg._baseH : bg._baseW;

    const roomStart = Math.max(0, (origin + base * dockScale - monStart - STAGE_EDGE_MARGIN) / dockScale);
    const roomEnd = Math.max(0, (monEnd - STAGE_EDGE_MARGIN - (origin + (base + baseSize) * dockScale)) / dockScale);

    const minShift = startExp - roomStart;
    const maxShift = roomEnd - endExp;
    return Math.max(minShift, Math.min(0, maxShift));
}

function updateArrowCenter(bg, value) {
    const rounded = Math.round(value);
    if (bg._arrowCenter === rounded) return;
    bg._arrowCenter = rounded;
    bg.queue_repaint();
}

function onMagnifierTick(dockActor) {
    if (!isActorAlive(dockActor) || dockActor._isAutohiding || dockActor._isDragging) return false;

    const fromMotion = dockActor._magMotionPending;
    dockActor._magMotionPending = false;
    if (!fromMotion && (!dockActor._magNeedsFrames || dockActor._isResetting)) return false;
    dockActor._magNeedsFrames = false;

    let px = dockActor._magMotionX;
    let py = dockActor._magMotionY;
    if (!fromMotion) [px, py] = global.get_pointer();

    applyRealtimeFrame(dockActor, px, py, dockActor._magTickVertical, dockActor._magTickSettings, Date.now());
    return dockActor._magNeedsFrames || dockActor._magMotionPending;
}

function ensureMagnifierTicker(dockActor, isVertical, settings) {
    dockActor._magTickVertical = isVertical;
    dockActor._magTickSettings = settings;
    if (!dockActor._magTicker) dockActor._magTicker = new FrameTicker(dockActor, () => onMagnifierTick(dockActor));
    dockActor._magTicker.start();
}

export function queueMagnifierMotion(dockActor, x, y, isVertical, settings) {
    dockActor._magMotionX = x;
    dockActor._magMotionY = y;
    dockActor._magMotionPending = true;
    ensureMagnifierTicker(dockActor, isVertical, settings);
}

export function cancelMagnifierMotion(dockActor) {
    dockActor._magMotionPending = false;
}

export function applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, now = null) {
    if (!isActorAlive(dockActor) || dockActor._isAutohiding || !dockActor.visible || dockActor._suppressZoom) {
        hideTooltip(dockActor);
        return;
    }

    if (dockActor._flipAnimating) return;

    if (dockActor._structureChanged) {
        dockActor._fixedSlots = null;
        dockActor._scalesCache = null;
        dockActor._scalesYCache = null;
        dockActor._scaledCentersCache = null;
        dockActor._riseOffsetsCache = null;
        dockActor._orderedScalesCache = null;
        dockActor._orderedCentersCache = null;
        dockActor._angleZCache = null;
        dockActor._angleYCache = null;
        dockActor._angleXCache = null;
        dockActor._magOffsetsCache = null;
        dockActor._structureChanged = false;
    }

    const pill = (dockActor._dockUI && dockActor._dockUI._musicPill) ? dockActor._dockUI._musicPill : null;
    if (pill && isActorAlive(pill) && pill.visible) {
        const pillPos = pill.get_transformed_position();
        const px = pillPos[0];
        const py = pillPos[1];
        const pillSize = pill.get_transformed_size();
        const pw = pillSize[0];
        const ph = pillSize[1];

        const onPill = (cx >= px && cx <= px + pw && cy >= py && cy <= py + ph) || Boolean(pill.hover || pill._isHovered);

        if (onPill) {
            hideTooltip(dockActor);
            if (!dockActor._isResetting) {
                resetMagnification(dockActor, 160, false);
                dockActor._isResetting = true;
            }
            return;
        }
    }

    const btns = getDockButtons(dockActor);
    const n = btns.length;
    if (!n || btns[0].width === 0) return;
    if (n > 1 && btns[0].x === btns[n - 1].x && btns[0].y === btns[n - 1].y) return;

    const isAppGrid = isAppGridOpen();
    const isMenu = isContextMenuOpen();

    if (isAppGrid || isMenu) {
        hideTooltip(dockActor);
        if (isAppGrid && !dockActor._isExternalDragging) return;
    }

    const hoverZoom = Settings.hoverZoom && !isAppGrid;
    const maxZoom = hoverZoom ? Settings.hoverZoomFactor : 1.0;
    const actualMaxZoom = 1.0 + (maxZoom - 1.0) * 2.0;
    const iconSize = Settings.iconSize;

    let zoomStyle = Settings.hoverZoomStyle || 'fluid';
    if (zoomStyle === 'macos') zoomStyle = 'fluid';
    if (zoomStyle === 'jelly-hover') zoomStyle = 'jelly';

    const maxRisePx = Settings.hoverZoomRise;
    const widthPushEnabled = Settings.hoverZoomWidth;
    const radiusMultiplier = Settings.hoverZoomRadius || 3.5;
    const gapFactorSetting = Settings.hoverZoomGapFactor || 2.0;
    const smoothnessSetting = Settings.hoverZoomSmoothness || 0.26;

    const dominoTilt = Settings.hoverZoomDominoTilt || 14;
    const cylinderAngle = Settings.hoverZoomCylinderAngle || 32;
    const magneticStrength = Settings.hoverZoomMagneticStrength || 12;
    const jellyStretchSetting = Settings.hoverZoomJellyStretch || 0.75;
    const jellySquishSetting = Settings.hoverZoomJellySquish || 0.50;
    const coverflowAngle = Settings.hoverZoomCoverflowAngle || 38;

    const RADIUS = iconSize * radiusMultiplier;
    const zoomRange = actualMaxZoom - 1.0;
    const zoomEnabled = actualMaxZoom > 1.0;

    const dockPosCoords = dockActor.get_transformed_position();
    const dx = dockPosCoords[0];
    const dy = dockPosCoords[1];
    const scaleFactor = isVertical ? dockActor.scale_y : dockActor.scale_x;
    const localCursor = (isVertical ? cy - dy : cx - dx) / scaleFactor;

    const dockThickness = isVertical ? (dockActor._cachedW || dockActor.width || 64) : (dockActor._cachedH || dockActor.height || 64);
    const crossCursor = isVertical ? cx - dx : cy - dy;

    if (crossCursor < -10 || crossCursor > dockThickness + 10) {
        if (isInsideTooltip(dockActor, cx, cy, 0) || isPointerInDockTooltipBridge(dockActor, cx, cy, settings)) return;
        if (!dockActor._isDragging && !isContextMenuOpen() && !dockActor._isResetting) {
            resetMagnification(dockActor, 180, false);
            dockActor._isResetting = true;
        }
        return;
    }

    if (dockActor._isResetting) {
        dockActor._isResetting = false;
    }

    const tFrame = now || Date.now();
    if (!dockActor._pointerState) {
        dockActor._pointerState = { x: cx, y: cy, t: tFrame, smoothVx: 0, smoothVy: 0 };
    }
    const ps = dockActor._pointerState;
    const dt = Math.max(8, Math.min(60, tFrame - ps.t));
    const instVx = (cx - ps.x) / dt;
    const instVy = (cy - ps.y) / dt;

    ps.smoothVx += (instVx - ps.smoothVx) * 0.40;
    ps.smoothVy += (instVy - ps.smoothVy) * 0.40;
    ps.x = cx;
    ps.y = cy;
    ps.t = tFrame;

    const slotModel = getFixedSlots(dockActor, isVertical, btns);
    if (!slotModel || !slotModel.orderedSlots || slotModel.orderedSlots.length !== n) return;

    const orderedSlots = slotModel.orderedSlots;
    const centersByBtn = slotModel.centersByBtn;
    const orderToBtn = slotModel.orderToBtn;
    const btnToOrder = slotModel.btnToOrder;

    const minSlot = orderedSlots[0];
    const maxSlot = orderedSlots[n - 1];
    const EDGE_BUFFER = Math.max(40, iconSize * 0.9);

    let clusterEnvelope = 1.0;
    if (localCursor < minSlot) {
        const distOut = minSlot - localCursor;
        clusterEnvelope = Math.max(0.0, 1.0 - (distOut / EDGE_BUFFER));
    } else if (localCursor > maxSlot) {
        const distOut = localCursor - maxSlot;
        clusterEnvelope = Math.max(0.0, 1.0 - (distOut / EDGE_BUFFER));
    }

    clusterEnvelope = clusterEnvelope * clusterEnvelope * (3.0 - 2.0 * clusterEnvelope);

    const pointerAxis = isVertical ? cy : cx;
    const pointerOnClock = btns.some(b => {
        if (!isActorAlive(b) || !b.visible || !(b.get_style_class_name() || '').includes('clock-module')) return false;
        const [spanStart, spanEnd] = axisSpan(b, isVertical);
        return pointerAxis >= spanStart && pointerAxis <= spanEnd;
    });
    const zoomEnvelope = pointerOnClock ? 0.0 : clusterEnvelope;

    if (clusterEnvelope <= 0.001) {
        hideTooltip(dockActor);

        let isStillAnimated = false;
        for (let i = 0; i < n; i++) {
            const b = btns[i];
            if (!isActorAlive(b)) continue;
            const sx = b.scale_x || 1.0;
            const sy = b.scale_y || 1.0;
            const tx = b.translation_x || 0;
            const ty = b.translation_y || 0;
            const rz = b.rotation_angle_z || 0;
            if (Math.abs(sx - 1.0) > 0.003 || Math.abs(sy - 1.0) > 0.003 ||
                Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5 || Math.abs(rz) > 0.2) {
                isStillAnimated = true;
                break;
            }
        }

        if (!isStillAnimated) {
            if (!dockActor._isMagnifierResetDone) {
                dockActor._isMagnifierResetDone = true;
                resetMagnification(dockActor, 0, false);
            }
            return;
        }

        clusterEnvelope = 0.0;
    }

    if (dockActor._isMagnifierResetDone && clusterEnvelope > 0.001) {
        dockActor._isMagnifierResetDone = false;
        for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            if (isActorAlive(b)) b.remove_all_transitions();
        }
    }

    if (!dockActor._scalesCache || dockActor._scalesCache.length !== n) {
        dockActor._scalesCache = new Array(n).fill(1.0);
        dockActor._scalesYCache = new Array(n).fill(1.0);
        dockActor._scaledCentersCache = new Array(n).fill(0);
        dockActor._riseOffsetsCache = new Array(n).fill(0);
        dockActor._angleZCache = new Array(n).fill(0);
        dockActor._angleYCache = new Array(n).fill(0);
        dockActor._angleXCache = new Array(n).fill(0);
        dockActor._magOffsetsCache = new Array(n).fill(0);
    }
    if (!dockActor._orderedScalesCache || dockActor._orderedScalesCache.length !== n) {
        dockActor._orderedScalesCache = new Array(n).fill(1.0);
    }
    if (!dockActor._orderedCentersCache || dockActor._orderedCentersCache.length !== n) {
        dockActor._orderedCentersCache = new Array(n).fill(0);
    }

    const scales = dockActor._scalesCache;
    const scalesY = dockActor._scalesYCache;
    const scaledCenters = dockActor._scaledCentersCache;
    const orderedScales = dockActor._orderedScalesCache;
    const orderedCenters = dockActor._orderedCentersCache;
    const riseOffsets = dockActor._riseOffsetsCache;
    const anglesZ = dockActor._angleZCache;
    const anglesY = dockActor._angleYCache;
    const anglesX = dockActor._angleXCache;
    const magOffsets = dockActor._magOffsetsCache;

    const effectiveCursor = localCursor - (dockActor._clusterShift || 0);

    for (let orderIndex = 0; orderIndex < n; orderIndex++) {
        const btnIndex = orderToBtn[orderIndex];
        const b = btns[btnIndex];

        if (!zoomEnabled || isStaticItem(b)) {
            orderedScales[orderIndex] = 1.0;
            continue;
        }

        const dist = Math.abs(effectiveCursor - orderedSlots[orderIndex]);
        const calculatedScale = calculateScaleCurve(dist, RADIUS, zoomRange, zoomStyle);
        orderedScales[orderIndex] = 1.0 + (calculatedScale - 1.0) * zoomEnvelope;
    }

    orderedCenters[0] = orderedSlots[0];
    for (let orderIndex = 1; orderIndex < n; orderIndex++) {
        const prevBtn = btns[orderToBtn[orderIndex - 1]];
        const currBtn = btns[orderToBtn[orderIndex]];

        const prevW = isVertical ? prevBtn.height : prevBtn.width;
        const currW = isVertical ? currBtn.height : currBtn.width;
        const prevScale = widthPushEnabled ? orderedScales[orderIndex - 1] : 1.0;
        const currScale = widthPushEnabled ? orderedScales[orderIndex] : 1.0;

        const originalGap = orderedSlots[orderIndex] - orderedSlots[orderIndex - 1];
        const gapFactor = Math.max(0.5, gapFactorSetting);

        let prevExtra = (prevW * prevScale - prevW) / gapFactor;
        let currExtra = (currW * currScale - currW) / gapFactor;

        const prevIsStatic = isStaticItem(prevBtn);
        const currIsStatic = isStaticItem(currBtn);

        if (currIsStatic && prevScale > 1.0) currExtra += (prevW * (prevScale - 1.0)) * 0.25;
        if (prevIsStatic && currScale > 1.0) prevExtra += (currW * (currScale - 1.0)) * 0.25;

        orderedCenters[orderIndex] = orderedCenters[orderIndex - 1] + originalGap + prevExtra + currExtra;
    }

    const dockPos = Settings.dockPosition || 'BOTTOM';

    for (let i = 0; i < n; i++) {
        const orderIndex = btnToOrder[i];
        const rawScale = orderedScales[orderIndex];
        scales[i] = rawScale;
        scalesY[i] = rawScale;
        scaledCenters[i] = orderedCenters[orderIndex];

        if (zoomEnabled && maxRisePx > 0) {
            const normElevation = Math.max(0, (rawScale - 1.0) / (actualMaxZoom - 1.0));
            const smoothElev = smoothstep(0.0, 1.0, normElevation);
            const riseAmount = smoothElev * maxRisePx;

            if (dockPos === 'BOTTOM') riseOffsets[i] = -riseAmount;
            else if (dockPos === 'TOP') riseOffsets[i] = riseAmount;
            else if (dockPos === 'LEFT') riseOffsets[i] = riseAmount;
            else if (dockPos === 'RIGHT') riseOffsets[i] = -riseAmount;
        } else {
            riseOffsets[i] = 0;
        }

        anglesZ[i] = 0;
        anglesY[i] = 0;
        anglesX[i] = 0;
        magOffsets[i] = 0;

        if (zoomEnabled && !pointerOnClock && !isStaticItem(btns[i])) {
            const delta = effectiveCursor - orderedSlots[orderIndex];
            const dist = Math.abs(delta);
            const ratio = dist / RADIUS;

            if (zoomStyle === 'domino' && dominoTilt > 0) {
                if (dist < RADIUS) {
                    const tiltSign = delta > 0 ? 1 : -1;
                    const envelope = Math.sin(ratio * Math.PI);
                    anglesZ[i] = tiltSign * envelope * dominoTilt;
                }
            } else if (zoomStyle === 'cylinder' && cylinderAngle > 0) {
                if (dist < RADIUS) {
                    const normDist = Math.max(-1.0, Math.min(1.0, delta / RADIUS));
                    const smoothDrum = Math.sin(normDist * (Math.PI * 0.5));
                    const angleVal = -smoothDrum * cylinderAngle;
                    if (isVertical) anglesX[i] = angleVal;
                    else anglesY[i] = angleVal;
                }
            } else if (zoomStyle === 'coverflow' && coverflowAngle > 0) {
                if (dist > 2 && dist < RADIUS) {
                    const side = delta > 0 ? 1 : -1;
                    const smoothYaw = smoothstep(0.0, 0.85, ratio);
                    anglesY[i] = side * smoothYaw * coverflowAngle;
                }
            } else if (zoomStyle === 'magnetic' && magneticStrength > 0) {
                if (dist < RADIUS) {
                    const pullBell = Math.sin(ratio * Math.PI) * (1.0 - ratio);
                    const pull = pullBell * magneticStrength;
                    magOffsets[i] = (delta > 0 ? 1 : -1) * pull;
                }
            } else if (zoomStyle === 'jelly') {
                if (dist < RADIUS) {
                    anglesZ[i] = 0;

                    const bell = (Math.cos(ratio * Math.PI) + 1) * 0.5;
                    const vMotion = isVertical ? ps.smoothVy : ps.smoothVx;
                    const normDelta = delta / RADIUS;

                    const velocityDrive = Math.max(-1.0, Math.min(1.0, vMotion * 0.5));
                    const positionDrive = Math.sin(normDelta * Math.PI);

                    const effectivePull = (positionDrive * 0.6 + velocityDrive * 0.4) * bell;

                    let dynamicStretch = 0;
                    let dynamicSquash = 0;

                    if (effectivePull >= 0) {
                        dynamicStretch = effectivePull * jellyStretchSetting;
                        dynamicSquash = effectivePull * jellySquishSetting;
                    } else {
                        const negPull = Math.abs(effectivePull);
                        dynamicStretch = -negPull * jellySquishSetting;
                        dynamicSquash = -negPull * jellyStretchSetting;
                    }

                    if (isVertical) {
                        scalesY[i] = Math.max(0.35, rawScale * (1.0 + dynamicStretch));
                        scales[i] = Math.max(0.35, rawScale * (1.0 - dynamicSquash));
                    } else {
                        scales[i] = Math.max(0.35, rawScale * (1.0 + dynamicStretch));
                        scalesY[i] = Math.max(0.35, rawScale * (1.0 - dynamicSquash));
                    }

                    magOffsets[i] = effectivePull * (jellyStretchSetting * 24);
                }
            }
        }
    }

    let mappedCursor = orderedCenters[0];
    if (n > 1) {
        if (effectiveCursor <= orderedSlots[0]) mappedCursor = orderedCenters[0] - (orderedSlots[0] - effectiveCursor);
        else if (effectiveCursor >= orderedSlots[n - 1]) mappedCursor = orderedCenters[n - 1] + (effectiveCursor - orderedSlots[n - 1]);
        else {
            for (let orderIndex = 0; orderIndex < n - 1; orderIndex++) {
                if (effectiveCursor >= orderedSlots[orderIndex] && effectiveCursor <= orderedSlots[orderIndex + 1]) {
                    const gap = orderedSlots[orderIndex + 1] - orderedSlots[orderIndex];
                    const tVal = gap > 0 ? (effectiveCursor - orderedSlots[orderIndex]) / gap : 0;
                    mappedCursor = orderedCenters[orderIndex] + tVal * (orderedCenters[orderIndex + 1] - orderedCenters[orderIndex]);
                    break;
                }
            }
        }
    }

    if (Number.isNaN(mappedCursor)) mappedCursor = orderedCenters[0] || 0;
    const zoomOffset = effectiveCursor - mappedCursor;
    if (Number.isNaN(zoomOffset)) return;

    const gapEase = 1 - Math.exp(-dt / GAP_EASE_MS);
    const gapSpread = approach(dockActor._gapSpread || 0, dockActor._gapSpreadTarget || 0, gapEase);
    dockActor._gapSpread = gapSpread;

    const lateralAxis = isVertical ? 'translation_y' : 'translation_x';
    const riseAxis = isVertical ? 'translation_x' : 'translation_y';

    const baseSmooth = dockActor._isDragging ? 0.35 : Math.max(0.08, Math.min(0.60, smoothnessSetting));
    const SMOOTH_FACTOR = 1 - Math.pow(1 - baseSmooth, dt / REFERENCE_FRAME_MS);
    let leftExp = 0;
    let rightExp = 0;
    let topExp = 0;
    let botExp = 0;

    if (zoomEnabled && widthPushEnabled) {
        let minVis = Infinity;
        let maxVis = -Infinity;
        let origMin = Infinity;
        let origMax = -Infinity;

        for (let i = 0; i < n; i++) {
            const btnStyleClass = btns[i].get_style_class_name ? btns[i].get_style_class_name() : (btns[i].style_class || '');
            if (btns[i]._isMusicPill || btnStyleClass.includes('clock-module') || btnStyleClass.includes('dock-drag-handle') || btnStyleClass.includes('dhruva-music-pill')) continue;
            const c = scaledCenters[i] + zoomOffset;
            const half = (isVertical ? btns[i].height : btns[i].width) * scales[i] / 2;
            if (c - half < minVis) minVis = c - half;
            if (c + half > maxVis) maxVis = c + half;

            const origC = centersByBtn[i];
            const origHalf = (isVertical ? btns[i].height : btns[i].width) / 2;
            if (origC - origHalf < origMin) origMin = origC - origHalf;
            if (origC + origHalf > origMax) origMax = origC + origHalf;
        }

        if (minVis !== Infinity && origMin !== Infinity) {
            if (isVertical) {
                topExp = Math.max(0, origMin - minVis);
                botExp = Math.max(0, maxVis - origMax);
            } else {
                leftExp = Math.max(0, origMin - minVis);
                rightExp = Math.max(0, maxVis - origMax);
            }
        }
    }

    if (isVertical) {
        topExp += gapSpread;
        botExp += gapSpread;
    } else {
        leftExp += gapSpread;
        rightExp += gapSpread;
    }

    const isDynamicPanel = Settings.hybridPanelMode && Settings.dynamicPanel;
    const isFullBar = Settings.fullWidth || (Settings.hybridPanelMode && !isDynamicPanel);
    const origin = isVertical ? dy : dx;

    let clusterBoundaryShift = 0;
    if (zoomEnabled && clusterEnvelope > 0.001) {
        if (isDynamicPanel) {
            clusterBoundaryShift = getDynamicPanelShift(dockActor, isVertical, origin,
                isVertical ? topExp : leftExp, isVertical ? botExp : rightExp);
        } else {
            const targetCenters = scaledCenters.map(center => center + zoomOffset);
            clusterBoundaryShift = getIconRowShift(dockActor, btns, isVertical, origin, targetCenters, isVertical ? scalesY : scales);
        }
    }

    dockActor._clusterShift = clusterBoundaryShift;
    dockActor._isZoomActive = zoomEnabled && clusterEnvelope > 0.001;

    let needsMoreFrames = false;

    for (let i = 0; i < n; i++) {
        const b = btns[i];
        const sClass = b.get_style_class_name ? b.get_style_class_name() : (b.style_class || '');
        if (b._isPanelBox || sClass.includes('dhruva-hybrid-panel-box')) {
            b.scale_x = 1.0;
            b.scale_y = 1.0;
            b[lateralAxis] = 0;
            b[riseAxis] = 0;
            continue;
        }

        const zoomTrans = zoomEnabled ? (scaledCenters[i] + zoomOffset) - centersByBtn[i] : 0;

        let flipTrans = 0;
        if (b._flipOffset && b._flipStartTime) {
            const elapsed = tFrame - b._flipStartTime;
            if (elapsed < FLIP_DURATION) flipTrans = b._flipOffset * (1.0 - easeOutCirc(elapsed / FLIP_DURATION));
            else {
                b._flipOffset = 0;
                b._flipStartTime = null;
            }
        }

        b._gapOffset = approach(b._gapOffset || 0, b._gapTarget || 0, gapEase);

        b.remove_transition('scale_x');
        b.remove_transition('scale_y');
        b.remove_transition('translation_x');
        b.remove_transition('translation_y');
        b.remove_transition('rotation_angle_z');
        b.remove_transition('rotation_angle_y');
        b.remove_transition('rotation_angle_x');

        const targetScaleX = scales[i];
        const targetScaleY = scalesY[i];
        const targetLateral = zoomTrans + clusterBoundaryShift + flipTrans + magOffsets[i] + b._gapOffset;
        const targetRise = riseOffsets[i];
        const targetAngleZ = anglesZ[i];
        const targetAngleY = anglesY[i];
        const targetAngleX = anglesX[i];

        const prevScaleX = Number.isFinite(b.scale_x) ? b.scale_x : 1.0;
        const prevScaleY = Number.isFinite(b.scale_y) ? b.scale_y : 1.0;
        const prevLateral = Number.isFinite(b[lateralAxis]) ? b[lateralAxis] : 0.0;
        const prevRise = Number.isFinite(b[riseAxis]) ? b[riseAxis] : 0.0;
        const prevAngleZ = Number.isFinite(b.rotation_angle_z) ? b.rotation_angle_z : 0.0;
        const prevAngleY = Number.isFinite(b.rotation_angle_y) ? b.rotation_angle_y : 0.0;
        const prevAngleX = Number.isFinite(b.rotation_angle_x) ? b.rotation_angle_x : 0.0;

        const smoothScaleX = approach(prevScaleX, targetScaleX, SMOOTH_FACTOR);
        const smoothScaleY = approach(prevScaleY, targetScaleY, SMOOTH_FACTOR);
        const smoothLateral = approach(prevLateral, targetLateral, SMOOTH_FACTOR);
        const smoothRise = approach(prevRise, targetRise, SMOOTH_FACTOR);
        const smoothAngleZ = approach(prevAngleZ, targetAngleZ, SMOOTH_FACTOR);
        const smoothAngleY = approach(prevAngleY, targetAngleY, SMOOTH_FACTOR);
        const smoothAngleX = approach(prevAngleX, targetAngleX, SMOOTH_FACTOR);

        if (Math.abs(targetScaleX - smoothScaleX) > 0.002 ||
            Math.abs(targetScaleY - smoothScaleY) > 0.002 ||
            Math.abs(targetLateral - smoothLateral) > 0.1 ||
            Math.abs(targetRise - smoothRise) > 0.1) {
            needsMoreFrames = true;
        }

        if (zoomEnabled) {
            b.scale_x = smoothScaleX;
            b.scale_y = smoothScaleY;
            b.rotation_angle_z = smoothAngleZ;
            b.rotation_angle_y = smoothAngleY;
            b.rotation_angle_x = smoothAngleX;
        }

        b[lateralAxis] = smoothLateral;
        b[riseAxis] = smoothRise;

        const appBox = b.get_child ? b.get_child() : null;
        if (appBox && appBox.get_children) {
            const boxKids = appBox.get_children();
            for (let k = 0; k < boxKids.length; k++) {
                const c = boxKids[k];
                if (!isActorAlive(c) || c._isHoverBg) continue;

                if (c._isIndicator) {
                    c.remove_transition('scale_x');
                    c.remove_transition('scale_y');
                    c.remove_transition('translation_x');
                    c.remove_transition('translation_y');

                    let px = 0.5;
                    let py = 0.5;
                    if (dockPos === 'BOTTOM') py = 1.0;
                    else if (dockPos === 'TOP') py = 0.0;
                    else if (dockPos === 'LEFT') px = 0.0;
                    else if (dockPos === 'RIGHT') px = 1.0;

                    c.set_pivot_point(px, py);

                    if (zoomEnabled) {
                        const antiScaleX = 1.0 / Math.max(0.01, smoothScaleX);
                        const antiScaleY = 1.0 / Math.max(0.01, smoothScaleY);
                        const baseSx = c._baseScaleX !== undefined ? c._baseScaleX : 1.0;
                        const baseSy = c._baseScaleY !== undefined ? c._baseScaleY : 1.0;

                        c.scale_x = baseSx * antiScaleX;
                        c.scale_y = baseSy * antiScaleY;
                        c.translation_x = (c._baseTx || 0) * antiScaleX;
                        c.translation_y = (c._baseTy || 0) * antiScaleY;
                    } else {
                        c.scale_x = c._baseScaleX !== undefined ? c._baseScaleX : 1.0;
                        c.scale_y = c._baseScaleY !== undefined ? c._baseScaleY : 1.0;
                        c.translation_x = c._baseTx || 0;
                        c.translation_y = c._baseTy || 0;
                    }
                } else {
                    c.remove_transition('translation_x');
                    c.remove_transition('translation_y');
                    if (zoomEnabled) {
                        c.translation_x = c._baseTx || 0;
                        c.translation_y = c._baseTy || 0;
                    }
                }
            }
        }
    }

    if (dockActor.bgActor && dockActor.boxActor && !isFullBar) {
        const baseW = dockActor.bgActor._baseW || dockActor.boxActor.width;
        const baseH = dockActor.bgActor._baseH || dockActor.boxActor.height;
        const baseX = dockActor.bgActor._baseX !== undefined
            ? dockActor.bgActor._baseX
            : (dockActor.width - baseW) / 2;
        const baseY = dockActor.bgActor._baseY !== undefined
            ? dockActor.bgActor._baseY
            : (dockActor.height - baseH) / 2;

        if (leftExp > 0 || rightExp > 0 || topExp > 0 || botExp > 0) {
            const BUFFER = isDynamicPanel ? 0 : DOCK_BG_BUFFER;

            dockActor.bgActor.remove_all_transitions();
            dockActor.bgActor.scale_x = 1.0;
            dockActor.bgActor.scale_y = 1.0;
            dockActor.bgActor.translation_x = 0;
            dockActor.bgActor.translation_y = 0;

            if (isVertical) {
                const topShift = topExp + (BUFFER / 2) - clusterBoundaryShift;
                const botShift = botExp + (BUFFER / 2) + clusterBoundaryShift;
                const targetH = baseH + topShift + botShift;
                const targetY = baseY - topShift;

                const prevH = dockActor.bgActor.height || baseH;
                const prevY = dockActor.bgActor.y;

                const nextH = approach(prevH, targetH, SMOOTH_FACTOR);
                const nextY = approach(prevY, targetY, SMOOTH_FACTOR);

                if (Math.abs(targetH - nextH) > 0.2 || Math.abs(targetY - nextY) > 0.2) {
                    needsMoreFrames = true;
                }

                dockActor.bgActor.set_position(baseX, nextY);
                dockActor.bgActor.set_size(baseW, nextH);
            } else {
                const leftShift = leftExp + (BUFFER / 2) - clusterBoundaryShift;
                const rightShift = rightExp + (BUFFER / 2) + clusterBoundaryShift;
                const targetW = baseW + leftShift + rightShift;
                const targetX = baseX - leftShift;

                const prevW = dockActor.bgActor.width || baseW;
                const prevX = dockActor.bgActor.x;

                const nextW = approach(prevW, targetW, SMOOTH_FACTOR);
                const nextX = approach(prevX, targetX, SMOOTH_FACTOR);

                if (Math.abs(targetW - nextW) > 0.2 || Math.abs(targetX - nextX) > 0.2) {
                    needsMoreFrames = true;
                }

                dockActor.bgActor.set_position(nextX, baseY);
                dockActor.bgActor.set_size(nextW, baseH);
            }

            if (dockActor._dockUI && dockActor._dockUI._dockBlur) {
                dockActor._dockUI._dockBlur.syncGeometry();
            }
        } else if (
            Math.abs(dockActor.bgActor.width - baseW) > 0.5 ||
            Math.abs(dockActor.bgActor.height - baseH) > 0.5 ||
            Math.abs(dockActor.bgActor.x - baseX) > 0.5 ||
            Math.abs(dockActor.bgActor.y - baseY) > 0.5
        ) {
            dockActor.bgActor.remove_all_transitions();
            dockActor.bgActor.scale_x = 1.0;
            dockActor.bgActor.scale_y = 1.0;
            dockActor.bgActor.translation_x = 0;
            dockActor.bgActor.translation_y = 0;
            dockActor.bgActor.set_position(baseX, baseY);
            dockActor.bgActor.set_size(baseW, baseH);

            if (dockActor._dockUI && dockActor._dockUI._dockBlur) {
                dockActor._dockUI._dockBlur.syncGeometry();
            }
        }
    }

    dockActor._magNeedsFrames = needsMoreFrames && !dockActor._isResetting && !dockActor._isDragging;
    if (dockActor._magNeedsFrames) ensureMagnifierTicker(dockActor, isVertical, settings);

    if (isAppGrid || isMenu || !Settings.showAppsPreview) {
        hideTooltip(dockActor);
        return;
    }

    let closestIndex = -1;
    let minDiff = Infinity;
    for (let i = 0; i < n; i++) {
        const btn = btns[i];
        if (!isActorAlive(btn) || !btn.visible) continue;
        const bPos = btn.get_transformed_position();
        const bSz = btn.get_transformed_size();
        const bx = bPos[0];
        const by = bPos[1];
        const bw = bSz[0];
        const bh = bSz[1];
        if (bw <= 0 || bh <= 0) continue;

        const btnCenter = isVertical ? (by + bh / 2) : (bx + bw / 2);
        const mousePos = isVertical ? cy : cx;
        const diff = Math.abs(mousePos - btnCenter);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }

    let isHovering = false;
    if (closestIndex !== -1) {
        const targetBtn = btns[closestIndex];
        const [tbx, tby] = targetBtn.get_transformed_position();
        const [tbw, tbh] = targetBtn.get_transformed_size();
        const reach = (isVertical ? tbh : tbw) / 2 + HOVER_EDGE_PX;

        let isOverIcon;
        switch (Settings.dockPosition || 'BOTTOM') {
            case 'TOP': isOverIcon = cy <= tby + tbh + HOVER_EDGE_PX; break;
            case 'LEFT': isOverIcon = cx <= tbx + tbw + HOVER_EDGE_PX; break;
            case 'RIGHT': isOverIcon = cx >= tbx - HOVER_EDGE_PX; break;
            default: isOverIcon = cy >= tby - HOVER_EDGE_PX; break;
        }
        isHovering = minDiff <= reach && isOverIcon;
    }

    if (isHovering) {
        const btn = btns[closestIndex];
        let appName = '';

        if (btn._delegate && btn._delegate.isFolder) appName = btn._delegate.folderData.name;
        else if (btn._delegate && btn._delegate.app) appName = btn._delegate.app.get_name();
        else if (btn.get_child && btn.get_child() && btn.get_child().has_style_class_name && btn.get_child().has_style_class_name('dock-grid-icon')) appName = _('Applications');

        if (appName) {
            if (dockActor._tooltipHoveredIndex !== closestIndex) {
                clearTooltipDelay(dockActor);
                if (dockActor._magTooltip) {
                    dockActor._magTooltip.remove_all_transitions();
                    dockActor._magTooltip.opacity = 0;
                    dockActor._magTooltip.hide();
                }
                dockActor._tooltipHoveredIndex = closestIndex;
                dockActor._magTooltipAppId = null;

                if (dockActor._tooltipDelayId && dockActor._magTimers) {
                    dockActor._magTimers.remove(dockActor._tooltipDelayId);
                }

                const showTooltip = () => {
                    dockActor._tooltipDelayId = null;
                    dockActor._tooltipReady = true;
                    const ptrCoords = global.get_pointer();
                    const pcx = ptrCoords[0];
                    const pcy = ptrCoords[1];
                    applyRealtimeFrame(dockActor, pcx, pcy, isVertical, settings, Date.now());
                    return GLib.SOURCE_REMOVE;
                };

                if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
                dockActor._tooltipDelayId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, showTooltip);
            }

            if (!dockActor._magTooltip) {
                const tooltipActors = createTooltipActor(dockActor, settings);
                dockActor._magTooltip = tooltipActors.tooltip;
                dockActor._magTooltipBg = tooltipActors.tooltipBg;
                dockActor._magTooltipBox = tooltipActors.tooltipBox;

                Main.layoutManager.uiGroup.add_child(dockActor._magTooltip);
            }

            if (!dockActor._magPeekManager && dockActor._dockUI) {
                dockActor._magPeekManager = new PeekManager(dockActor._dockUI, Main.layoutManager.uiGroup);
            }

            const delegate = btn._delegate || {};
            let appId;
            if (delegate.app) {
                appId = delegate.app.get_id ? delegate.app.get_id() : delegate.app.get_name();
            } else if (delegate.isFolder) {
                appId = delegate.folderData.id;
            } else {
                appId = appName;
            }

            if (dockActor._tooltipReady && dockActor._magTooltipAppId !== appId) {
                dockActor._magTooltipAppId = appId;
                populateTooltipContent(dockActor, btn, appName, settings);
            }

            if (!isActorAlive(btn) || !isActorAlive(dockActor._magTooltip) || !isActorAlive(dockActor._magTooltipBox)) {
                return;
            }

            if (dockActor._tooltipReady && (!dockActor._magTooltip.visible || dockActor._magTooltip.opacity === 0)) {
                dockActor._magTooltipBox.queue_relayout();
                const twPref = dockActor._magTooltipBox.get_preferred_width(-1);
                const thPref = dockActor._magTooltipBox.get_preferred_height(-1);
                let tw = twPref[1] || 0;
                let th = thPref[1] || 0;

                if (tw < 48 || th < 28) {
                    tw = dockActor._lastTooltipW || Math.max(120, Settings.iconSize * 2);
                    th = dockActor._lastTooltipH || 56;
                }
                dockActor._lastTooltipW = tw;
                dockActor._lastTooltipH = th;

                const btnPos = btn.get_transformed_position();
                const bx = btnPos[0];
                const by = btnPos[1];
                const btnSize = btn.get_transformed_size();
                const bw = btnSize[0];
                const bh = btnSize[1];

                let tx = 0;
                let ty = 0;
                const gap = TOOLTIP_GAP;
                const iconCenterX = bx + bw / 2;
                const iconCenterY = by + bh / 2;

                const currentDockPos = Settings.dockPosition || 'BOTTOM';
                if (currentDockPos === 'BOTTOM') {
                    tx = iconCenterX - tw / 2;
                    ty = by - th - gap;
                    dockActor._magTooltip.set_pivot_point(0.5, 1.0);
                } else if (currentDockPos === 'TOP') {
                    tx = iconCenterX - tw / 2;
                    ty = by + bh + gap;
                    dockActor._magTooltip.set_pivot_point(0.5, 0.0);
                } else if (currentDockPos === 'LEFT') {
                    tx = bx + bw + gap;
                    ty = iconCenterY - th / 2;
                    dockActor._magTooltip.set_pivot_point(0.0, 0.5);
                } else if (currentDockPos === 'RIGHT') {
                    tx = bx - tw - gap;
                    ty = iconCenterY - th / 2;
                    dockActor._magTooltip.set_pivot_point(1.0, 0.5);
                }

                if (tx < 10) tx = 10;
                if (tx + tw > global.stage.width - 10) tx = global.stage.width - tw - 10;
                if (ty < 10) ty = 10;
                if (ty + th > global.stage.height - 10) ty = global.stage.height - th - 10;

                if (isActorAlive(dockActor._magTooltipBg)) {
                    if (currentDockPos === 'BOTTOM' || currentDockPos === 'TOP') {
                        dockActor._magTooltipBg._arrowCenter = Math.max(MIN_ARROW_PADDING, Math.min(iconCenterX - tx, tw - MIN_ARROW_PADDING));
                    } else {
                        dockActor._magTooltipBg._arrowCenter = Math.max(MIN_ARROW_PADDING, Math.min(iconCenterY - ty, th - MIN_ARROW_PADDING));
                    }
                    dockActor._magTooltipBg.queue_repaint();
                }

                dockActor._magTooltip.set_size(tw, th);
                dockActor._magTooltip.set_position(tx, ty);
                dockActor._magTooltip.show();

                const parent = dockActor._magTooltip.get_parent();
                if (parent && dockActor._dockUI && dockActor._dockUI.actor) {
                    const sibling = dockActor._dockUI.actor;
                    if (sibling && sibling.get_parent && sibling.get_parent() === parent) {
                        parent.set_child_below_sibling(dockActor._magTooltip, sibling);
                    }
                }

                dockActor._magTooltip.remove_all_transitions();
                dockActor._magTooltip.ease({
                    opacity: 255,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
                resumeTooltipTracking(dockActor);
            } else if (dockActor._tooltipReady && dockActor._magTooltip.visible && isActorAlive(dockActor._magTooltipBg)) {
                const btnPos = btn.get_transformed_position();
                const bx = btnPos[0];
                const by = btnPos[1];
                const btnSize = btn.get_transformed_size();
                const bw = btnSize[0];
                const bh = btnSize[1];
                const tipPos = dockActor._magTooltip.get_transformed_position();
                const tx = tipPos[0];
                const ty = tipPos[1];
                const tipSize = dockActor._magTooltip.get_transformed_size();
                const tw = tipSize[0];
                const th = tipSize[1];
                const currentDockPos = Settings.dockPosition || 'BOTTOM';

                if (tw > 0 && th > 0) {
                    if (currentDockPos === 'BOTTOM' || currentDockPos === 'TOP') {
                        const iconCenterX = bx + bw / 2;
                        updateArrowCenter(dockActor._magTooltipBg, Math.max(MIN_ARROW_PADDING, Math.min(iconCenterX - tx, tw - MIN_ARROW_PADDING)));
                    } else {
                        const iconCenterY = by + bh / 2;
                        updateArrowCenter(dockActor._magTooltipBg, Math.max(MIN_ARROW_PADDING, Math.min(iconCenterY - ty, th - MIN_ARROW_PADDING)));
                    }
                }
                resumeTooltipTracking(dockActor);
            }
        }
    } else {
        const keepTooltipAlive = isInsideTooltip(dockActor, cx, cy, 0) || isPointerInDockTooltipBridge(dockActor, cx, cy, settings);
        if (!keepTooltipAlive) hideTooltip(dockActor);
    }
}