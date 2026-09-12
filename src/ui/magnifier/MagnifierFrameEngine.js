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

import PeekManager from '../../core/PeekManager.js';
import { isActorAlive } from '../../core/Utils.js';
import { resetMagnification } from './MagnifierReset.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { isContextMenuOpen, isAppGridOpen } from './MagnifierState.js';
import { getDockButtons, getFixedSlots, easeOutCirc } from './MagnifierMath.js';
import { createTooltipActor, populateTooltipContent } from './MagnifierTooltipRenderer.js';
import { clearTooltipDelay, hideTooltip, isInsideTooltip, isPointerInDockTooltipBridge } from './MagnifierTooltip.js';


const FLIP_DURATION = 300;
const TOOLTIP_DELAY_MS = 600;
const MIN_ARROW_PADDING = 18;

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
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

export function applyRealtimeFrame(dockActor, cx, cy, isVertical, settings, now = null) {
    if (!isActorAlive(dockActor) || dockActor._isHidden || !dockActor.visible || dockActor._suppressZoom) {
        hideTooltip(dockActor);
        return;
    }

    const btns = getDockButtons(dockActor);
    const n = btns.length;
    if (!n || btns[0].width === 0) return;
    if (n > 1 && btns[0].x === btns[n - 1].x && btns[0].y === btns[n - 1].y) return;

    const isAppGrid = isAppGridOpen();
    const isMenu = isContextMenuOpen();

    if (isAppGrid || isMenu) {
        hideTooltip(dockActor);
        if (isAppGrid) return;
    }

    const hoverZoom = settings.get_boolean('hover-zoom') && !isAppGrid;
    const maxZoom = hoverZoom ? settings.get_double('hover-zoom-factor') : 1.0;
    const actualMaxZoom = 1.0 + (maxZoom - 1.0) * 2.0;
    const iconSize = settings.get_int('icon-size');

    let zoomStyle = settings.get_string('hover-zoom-style') || 'fluid';
    if (zoomStyle === 'macos') zoomStyle = 'fluid';
    if (zoomStyle === 'jelly-hover') zoomStyle = 'jelly';

    const maxRisePx = settings.get_int('hover-zoom-rise');
    const widthPushEnabled = settings.get_boolean('hover-zoom-width');
    const radiusMultiplier = settings.get_double('hover-zoom-radius') || 3.5;
    const gapFactorSetting = settings.get_double('hover-zoom-gap-factor') || 2.0;
    const smoothnessSetting = settings.get_double('hover-zoom-smoothness') || 0.26;

    const dominoTilt = settings.get_int('hover-zoom-domino-tilt') || 14;
    const cylinderAngle = settings.get_int('hover-zoom-cylinder-angle') || 32;
    const magneticStrength = settings.get_int('hover-zoom-magnetic-strength') || 12;
    const jellyStretchSetting = settings.get_double('hover-zoom-jelly-stretch') || 0.75;
    const jellySquishSetting = settings.get_double('hover-zoom-jelly-squish') || 0.50;
    const coverflowAngle = settings.get_int('hover-zoom-coverflow-angle') || 38;

    const RADIUS = iconSize * radiusMultiplier;
    const zoomRange = actualMaxZoom - 1.0;
    const zoomEnabled = actualMaxZoom > 1.0;

    const [dx, dy] = dockActor.get_transformed_position();
    const scaleFactor = isVertical ? dockActor.scale_y : dockActor.scale_x;
    const localCursor = (isVertical ? cy - dy : cx - dx) / scaleFactor;

    const dockThickness = isVertical ? (dockActor._cachedW || dockActor.width || 64) : (dockActor._cachedH || dockActor.height || 64);
    const crossCursor = isVertical ? cx - dx : cy - dy;

    if (crossCursor < -25 || crossCursor > dockThickness + 25) {
        if (!dockActor._isDragging && !isContextMenuOpen() && !dockActor._isResetting) {
            resetMagnification(dockActor);
            dockActor._isResetting = true;
        }
        return;
    }

    dockActor._isResetting = false;

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

    for (let orderIndex = 0; orderIndex < n; orderIndex++) {
        const btnIndex = orderToBtn[orderIndex];
        const b = btns[btnIndex];
        const sClass = b.get_style_class_name ? b.get_style_class_name() : (b.style_class || '');
        const isStaticEdge = b._isStatic || sClass.includes('dock-separator') || sClass.includes('clock-module') || sClass.includes('dock-drag-handle');

        if (!zoomEnabled || isStaticEdge) {
            orderedScales[orderIndex] = 1.0;
            continue;
        }

        const dist = Math.abs(localCursor - orderedSlots[orderIndex]);
        orderedScales[orderIndex] = calculateScaleCurve(dist, RADIUS, zoomRange, zoomStyle);
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

        const sClassP = prevBtn.get_style_class_name ? prevBtn.get_style_class_name() : (prevBtn.style_class || '');
        const sClassC = currBtn.get_style_class_name ? currBtn.get_style_class_name() : (currBtn.style_class || '');

        const prevIsStatic = prevBtn._isStatic || sClassP.includes('dock-separator') || sClassP.includes('clock-module');
        const currIsStatic = currBtn._isStatic || sClassC.includes('dock-separator') || sClassC.includes('clock-module');

        if (currIsStatic && prevScale > 1.0) currExtra += (prevW * (prevScale - 1.0)) * 0.25;
        if (prevIsStatic && currScale > 1.0) prevExtra += (currW * (currScale - 1.0)) * 0.25;

        orderedCenters[orderIndex] = orderedCenters[orderIndex - 1] + originalGap + prevExtra + currExtra;
    }

    const dockPos = settings.get_string('dock-position') || 'BOTTOM';

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

        if (zoomEnabled) {
            const delta = localCursor - orderedSlots[orderIndex];
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
        if (localCursor <= orderedSlots[0]) mappedCursor = orderedCenters[0] - (orderedSlots[0] - localCursor);
        else if (localCursor >= orderedSlots[n - 1]) mappedCursor = orderedCenters[n - 1] + (localCursor - orderedSlots[n - 1]);
        else {
            for (let orderIndex = 0; orderIndex < n - 1; orderIndex++) {
                if (localCursor >= orderedSlots[orderIndex] && localCursor <= orderedSlots[orderIndex + 1]) {
                    const gap = orderedSlots[orderIndex + 1] - orderedSlots[orderIndex];
                    const tVal = gap > 0 ? (localCursor - orderedSlots[orderIndex]) / gap : 0;
                    mappedCursor = orderedCenters[orderIndex] + tVal * (orderedCenters[orderIndex + 1] - orderedCenters[orderIndex]);
                    break;
                }
            }
        }
    }

    if (Number.isNaN(mappedCursor)) mappedCursor = orderedCenters[0] || 0;
    const zoomOffset = localCursor - mappedCursor;
    if (Number.isNaN(zoomOffset)) return;

    const lateralAxis = isVertical ? 'translation_y' : 'translation_x';
    const riseAxis = isVertical ? 'translation_x' : 'translation_y';

    const SMOOTH_FACTOR = dockActor._isDragging ? 0.35 : Math.max(0.08, Math.min(0.60, smoothnessSetting));
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
            if (btns[i].style_class && (btns[i].style_class.includes('clock-module') || btns[i].style_class.includes('dock-drag-handle'))) continue;
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

    for (let i = 0; i < n; i++) {
        const b = btns[i];
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

        b.remove_transition('scale_x');
        b.remove_transition('scale_y');
        b.remove_transition('translation_x');
        b.remove_transition('translation_y');
        b.remove_transition('rotation_angle_z');
        b.remove_transition('rotation_angle_y');
        b.remove_transition('rotation_angle_x');

        const targetScaleX = scales[i];
        const targetScaleY = scalesY[i];
        const targetLateral = zoomTrans + flipTrans + magOffsets[i];
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

        const smoothScaleX = prevScaleX + ((targetScaleX - prevScaleX) * SMOOTH_FACTOR);
        const smoothScaleY = prevScaleY + ((targetScaleY - prevScaleY) * SMOOTH_FACTOR);
        const smoothLateral = prevLateral + ((targetLateral - prevLateral) * SMOOTH_FACTOR);
        const smoothRise = prevRise + ((targetRise - prevRise) * SMOOTH_FACTOR);
        const smoothAngleZ = prevAngleZ + ((targetAngleZ - prevAngleZ) * SMOOTH_FACTOR);
        const smoothAngleY = prevAngleY + ((targetAngleY - prevAngleY) * SMOOTH_FACTOR);
        const smoothAngleX = prevAngleX + ((targetAngleX - prevAngleX) * SMOOTH_FACTOR);

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
            appBox.get_children().forEach(c => {
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
                        c.scale_x = antiScaleX;
                        c.scale_y = antiScaleY;
                        c.translation_x = (c._baseTx || 0) * antiScaleX;
                        c.translation_y = (c._baseTy || 0) * antiScaleY;
                    }
                } else {
                    c.remove_transition('translation_x');
                    c.remove_transition('translation_y');
                    if (zoomEnabled) {
                        c.translation_x = (c._baseTx || 0);
                        c.translation_y = (c._baseTy || 0);
                    }
                }
            });
        }
    }

    if (dockActor.bgActor && dockActor.boxActor && !settings.get_boolean('full-width') && zoomEnabled && widthPushEnabled) {
        const baseW = dockActor.bgActor.width || dockActor.bgActor._baseW || dockActor.boxActor.width;
        const baseH = dockActor.bgActor.height || dockActor.bgActor._baseH || dockActor.boxActor.height;
        const BUFFER = 16;

        dockActor.bgActor.remove_transition('scale_x');
        dockActor.bgActor.remove_transition('scale_y');
        dockActor.bgActor.remove_transition('translation_x');
        dockActor.bgActor.remove_transition('translation_y');

        if (isVertical) {
            const newH = baseH + topExp + botExp + BUFFER;
            const targetScaleY = baseH > 0 ? newH / baseH : 1.0;
            const targetTransY = (botExp - topExp) / 2;
            const prevScaleY = Number.isFinite(dockActor.bgActor.scale_y) ? dockActor.bgActor.scale_y : 1.0;
            const prevTransY = Number.isFinite(dockActor.bgActor.translation_y) ? dockActor.bgActor.translation_y : 0.0;

            dockActor.bgActor.scale_y = prevScaleY + ((targetScaleY - prevScaleY) * SMOOTH_FACTOR);
            dockActor.bgActor.translation_y = prevTransY + ((targetTransY - prevTransY) * SMOOTH_FACTOR);
        } else {
            const newW = baseW + leftExp + rightExp + BUFFER;
            const targetScaleX = baseW > 0 ? newW / baseW : 1.0;
            const targetTransX = (rightExp - leftExp) / 2;
            const prevScaleX = Number.isFinite(dockActor.bgActor.scale_x) ? dockActor.bgActor.scale_x : 1.0;
            const prevTransX = Number.isFinite(dockActor.bgActor.translation_x) ? dockActor.bgActor.translation_x : 0.0;

            dockActor.bgActor.scale_x = prevScaleX + ((targetScaleX - prevScaleX) * SMOOTH_FACTOR);
            dockActor.bgActor.translation_x = prevTransX + ((targetTransX - prevTransX) * SMOOTH_FACTOR);
        }
    }

    if (isAppGrid || isMenu || !settings.get_boolean('show-apps-preview')) {
        hideTooltip(dockActor);
        return;
    }

    let closestIndex = -1;
    let minDiff = Infinity;
    for (let i = 0; i < n; i++) {
        const visualCenter = zoomEnabled ? (scaledCenters[i] + zoomOffset) : centersByBtn[i];
        const diff = Math.abs(localCursor - visualCenter);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }

    let isHovering = false;
    if (closestIndex !== -1) {
        const visualRadius = (iconSize * scales[closestIndex]) / 2;
        isHovering = minDiff <= visualRadius;
    }

    if (isHovering) {
        const btn = btns[closestIndex];
        let appName = '';

        if (btn._delegate && btn._delegate.isFolder) appName = btn._delegate.folderData.name;
        else if (btn._delegate && btn._delegate.app) appName = btn._delegate.app.get_name();
        else if (btn.get_child && btn.get_child() && btn.get_child().has_style_class_name && btn.get_child().has_style_class_name('dock-grid-icon')) appName = 'Applications';

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
                    const [pcx, pcy] = global.get_pointer();
                    applyRealtimeFrame(dockActor, pcx, pcy, isVertical, settings, Date.now());
                    return GLib.SOURCE_REMOVE;
                };

                if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
                dockActor._tooltipDelayId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, showTooltip);
            }

            if (!dockActor._magTooltip) {
                const { tooltip, tooltipBg, tooltipBox } = createTooltipActor();
                dockActor._magTooltip = tooltip;
                dockActor._magTooltipBg = tooltipBg;
                dockActor._magTooltipBox = tooltipBox;

                Main.layoutManager.uiGroup.add_child(dockActor._magTooltip);

                if (!dockActor._magDestroyHandlerId) {
                    dockActor._magDestroyHandlerId = dockActor.connectObject('destroy', () => {
                        if (dockActor._magTooltip) {
                            dockActor._magTooltip.destroy();
                            dockActor._magTooltip = null;
                        }
                        if (dockActor._magPeekManager) {
                            dockActor._magPeekManager.destroy();
                            dockActor._magPeekManager = null;
                        }
                        dockActor._magDestroyHandlerId = null;
                    }, dockActor);
                }
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

            if (dockActor._tooltipReady && (!dockActor._magTooltip.visible || dockActor._magTooltip.opacity === 0)) {
                if (!isActorAlive(btn)) return;

                dockActor._magTooltipBox.queue_relayout();
                let [, tw] = dockActor._magTooltipBox.get_preferred_width(-1);
                let [, th] = dockActor._magTooltipBox.get_preferred_height(-1);

                if (tw < 48 || th < 28) {
                    tw = dockActor._lastTooltipW || Math.max(120, settings.get_int('icon-size') * 2);
                    th = dockActor._lastTooltipH || 56;
                }
                dockActor._lastTooltipW = tw;
                dockActor._lastTooltipH = th;

                const [bx, by] = btn.get_transformed_position();
                const [bw, bh] = btn.get_transformed_size();

                let tx = 0;
                let ty = 0;
                const gap = 24;
                const iconCenterX = bx + bw / 2;
                const iconCenterY = by + bh / 2;

                const dockPos = settings.get_string('dock-position') || 'BOTTOM';
                if (dockPos === 'BOTTOM') {
                    tx = iconCenterX - tw / 2;
                    ty = by - th - gap;
                    dockActor._magTooltip.set_pivot_point(0.5, 1.0);
                } else if (dockPos === 'TOP') {
                    tx = iconCenterX - tw / 2;
                    ty = by + bh + gap;
                    dockActor._magTooltip.set_pivot_point(0.5, 0.0);
                } else if (dockPos === 'LEFT') {
                    tx = bx + bw + gap;
                    ty = iconCenterY - th / 2;
                    dockActor._magTooltip.set_pivot_point(0.0, 0.5);
                } else if (dockPos === 'RIGHT') {
                    tx = bx - tw - gap;
                    ty = iconCenterY - th / 2;
                    dockActor._magTooltip.set_pivot_point(1.0, 0.5);
                }

                if (tx < 10) tx = 10;
                if (tx + tw > global.stage.width - 10) tx = global.stage.width - tw - 10;
                if (ty < 10) ty = 10;
                if (ty + th > global.stage.height - 10) ty = global.stage.height - th - 10;

                if (dockPos === 'BOTTOM' || dockPos === 'TOP') {
                    dockActor._magTooltipBg._arrowCenter = Math.max(MIN_ARROW_PADDING, Math.min(iconCenterX - tx, tw - MIN_ARROW_PADDING));
                } else {
                    dockActor._magTooltipBg._arrowCenter = Math.max(MIN_ARROW_PADDING, Math.min(iconCenterY - ty, th - MIN_ARROW_PADDING));
                }

                dockActor._magTooltip.set_size(tw, th);
                dockActor._magTooltipBg.queue_repaint();
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
            } else if (dockActor._tooltipReady && dockActor._magTooltip && isActorAlive(dockActor._magTooltip) && dockActor._magTooltip.visible && dockActor._magTooltipBg) {
                if (!isActorAlive(btn)) return;

                const [bx, by] = btn.get_transformed_position();
                const [bw, bh] = btn.get_transformed_size();
                const [tx, ty] = dockActor._magTooltip.get_transformed_position();
                const [tw, th] = dockActor._magTooltip.get_transformed_size();
                const dockPos = settings.get_string('dock-position') || 'BOTTOM';

                if (tw > 0 && th > 0) {
                    if (dockPos === 'BOTTOM' || dockPos === 'TOP') {
                        const iconCenterX = bx + bw / 2;
                        dockActor._magTooltipBg._arrowCenter = Math.max(MIN_ARROW_PADDING, Math.min(iconCenterX - tx, tw - MIN_ARROW_PADDING));
                    } else {
                        const iconCenterY = by + bh / 2;
                        dockActor._magTooltipBg._arrowCenter = Math.max(MIN_ARROW_PADDING, Math.min(iconCenterY - ty, th - MIN_ARROW_PADDING));
                    }
                    dockActor._magTooltipBg.queue_repaint();
                }
            }
        }
    } else {
        const keepTooltipAlive = isInsideTooltip(dockActor, cx, cy, 24) || isPointerInDockTooltipBridge(dockActor, cx, cy, settings);
        if (!keepTooltipAlive) hideTooltip(dockActor);
    }
}