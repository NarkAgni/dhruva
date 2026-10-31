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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Settings } from '../../core/SettingsManager.js';
import { isDynamicPanelLayout, isFullBarLayout, isPanelOrFullWidth } from '../../core/LayoutMode.js';
import { isActorAlive, hexToRgba } from '../../core/Utils.js';
import { HYBRID_PANEL_CONFIG } from '../../core/PanelConfig.js';
import { calculateScale, calculatePivot, calculateBackgroundBounds } from './DockGeometryCalculator.js';


const DEFAULT_BOX_SIZE = 10;
const BG_SETTLE_MS = 200;
const LEADING_CONTENT_DEPTH = 4;

function _hasVisibleContent(actor) {
    if (!isActorAlive(actor) || !actor.visible || actor.opacity === 0) return false;
    const children = actor.get_children();
    return children.length === 0 || children.some(_hasVisibleContent);
}

function _leadingContentOffset(container, isVertical) {
    let offset = 0;
    let node = container;
    for (let depth = 0; depth < LEADING_CONTENT_DEPTH; depth++) {
        const next = node.get_children().find(_hasVisibleContent);
        if (!next) break;
        offset += isVertical ? next.y : next.x;
        node = next;
    }
    return offset;
}

function _syncPanelSeparator(dockUI, isVertical, boxX, boxY, boxW, boxH) {
    const settings = dockUI.settings;
    const rightBox = dockUI.panelIntegrator ? dockUI.panelIntegrator.container : null;
    const thickness = settings.get_int('panel-separator-width');
    const shouldShow = isDynamicPanelLayout() &&
        settings.get_boolean('show-panel-separator') && thickness > 0 &&
        isActorAlive(rightBox) && rightBox.visible && rightBox.get_children().some(_hasVisibleContent);

    let sep = dockUI._panelSeparator;
    if (!shouldShow) {
        if (isActorAlive(sep)) sep.hide();
        return;
    }

    if (!isActorAlive(sep)) {
        sep = new St.Widget({ name: 'DhruvaPanelSeparator', reactive: false });
        dockUI.actor.add_child(sep);
        dockUI._panelSeparator = sep;
    }

    const rgba = hexToRgba(settings.get_string('panel-separator-color'), settings.get_int('panel-separator-opacity') / 100.0);
    sep.set_style(`background-color: ${rgba}; border-radius: ${thickness}px;`);

    const crossSpan = isVertical ? boxW : boxH;
    const length = Math.max(1, Math.round(crossSpan * settings.get_int('panel-separator-height') / 100.0));
    const endPadding = dockUI.boxActor.get_theme_node().get_padding(isVertical ? St.Side.BOTTOM : St.Side.RIGHT);
    const iconsEnd = (isVertical ? boxY + boxH : boxX + boxW) - endPadding;
    const itemsStart = (isVertical ? rightBox.y : rightBox.x) + _leadingContentOffset(rightBox, isVertical);
    const center = (iconsEnd + itemsStart) / 2;
    const crossCenter = isVertical ? boxX + boxW / 2 : boxY + boxH / 2;

    const w = isVertical ? length : thickness;
    const h = isVertical ? thickness : length;
    sep.set_size(w, h);
    sep.set_position(
        Math.round((isVertical ? crossCenter : center) - w / 2),
        Math.round((isVertical ? center : crossCenter) - h / 2)
    );
    sep.show();
}

function _settleBackgroundAfterReset(dockUI, x, y, width, height) {
    const bg = dockUI.bgActor;
    const syncBlur = () => {
        if (dockUI._syncBlurGeometry) dockUI._syncBlurGeometry();
    };

    bg.ease({
        x,
        y,
        width,
        height,
        duration: BG_SETTLE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onUpdate: syncBlur,
        onStopped: () => {
            if (isActorAlive(bg)) bg._isMagResetting = false;
            syncBlur();
        },
    });
    bg._isMagResetting = true;
}

export function updateLayout(dockUI) {
    if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor) || !dockUI.actor.is_mapped()) return;

    if (dockUI._wasDragging && !dockUI.actor._isDragging) {
        dockUI._wasDragging = false;
        if (dockUI.actor._wasRealDrag) {
            dockUI.actor._wasRealDrag = false;
            dockUI.triggerPostDragSettle();
        }
    }
    if (dockUI.actor._isDragging) dockUI._wasDragging = true;

    const isHybrid = Settings.hybridPanelMode;
    const isDynamicPanel = isDynamicPanelLayout();
    const isFullWidth = isFullBarLayout();
    const pos = dockUI.dockPosition;
    const isVertical = pos === 'LEFT' || pos === 'RIGHT';
    const alignment = isHybrid ? 'CENTER' : (Settings.iconAlignment || 'CENTER');
    const monitorResult = dockUI.monitorManager.getCurrentMonitor();

    if (!monitorResult || !monitorResult.monitor) return;

    const actualMonitor = monitorResult.monitor;
    const hasPanel = !isHybrid && monitorResult.index === Main.layoutManager.primaryIndex && Main.panel.visible;
    const topOffset = hasPanel ? Main.panel.height : 0;

    const activeMonWidth = actualMonitor.width;
    const activeMonHeight = actualMonitor.height;

    const monitor = {
        x: actualMonitor.x,
        y: actualMonitor.y + topOffset,
        width: activeMonWidth,
        height: Math.max(100, activeMonHeight - topOffset)
    };

    const boxPrefW = dockUI.boxActor.get_preferred_width(-1);
    const boxPrefH = dockUI.boxActor.get_preferred_height(-1);
    let boxW = boxPrefW[1] || DEFAULT_BOX_SIZE;
    let boxH = boxPrefH[1] || DEFAULT_BOX_SIZE;

    const isGridExtracted = isFullWidth && (Settings.gridButtonPosition === 'LEFT_EDGE');
    let gridW = 0;
    let gridH = 0;
    if (dockUI.gridBtn && dockUI.gridBtn.visible && isGridExtracted && !isHybrid) {
        const gpW = dockUI.gridBtn.get_preferred_width(-1);
        const gpH = dockUI.gridBtn.get_preferred_height(-1);
        gridW = gpW[1] || 0;
        gridH = gpH[1] || 0;
    }

    let clockW = 0;
    let clockH = 0;
    if (dockUI.extractedClock && dockUI.extractedClock.visible && isFullWidth) {
        const cpW = dockUI.extractedClock.get_preferred_width(-1);
        const cpH = dockUI.extractedClock.get_preferred_height(-1);
        clockW = cpW[1] || 0;
        clockH = cpH[1] || 0;
    }

    const sWidth = !isFullWidth ? Settings.strokeWidth : 0;
    const hoverZoom = Settings.hoverZoom;
    const iconSize = Settings.iconSize;
    const zoomFactor = hoverZoom ? (Settings.hoverZoomFactor || 1.8) : 1.0;

    const isNeverHide = Settings.hideMode === 'none';
    const edgeMargin = ((!isHybrid || isDynamicPanel) && isNeverHide) ? Math.max(0, Settings.dockMargin || 0) : 0;

    let dynLeftW = 0;
    let dynLeftH = 0;
    let dynRightW = 0;
    let dynRightH = 0;
    let dynDeskSpan = 0;

    if (isDynamicPanel && dockUI.panelIntegrator) {
        const leftBox = dockUI.panelIntegrator.leftContainer;
        if (isActorAlive(leftBox)) {
            const lwP = leftBox.get_preferred_width(-1);
            const lhP = leftBox.get_preferred_height(-1);
            dynLeftW = Math.max(30, Math.round(lwP[1] || 0));
            dynLeftH = Math.max(20, Math.round(lhP[1] || 0));
        }

        const rightBox = dockUI.panelIntegrator.container;
        if (isActorAlive(rightBox)) {
            dockUI.panelIntegrator.alignItems();
            rightBox.set_size(-1, -1);
            const rhP = rightBox.get_preferred_height(-1);
            const visibleChildren = rightBox.get_children().filter(c => {
                if (!isActorAlive(c) || !c.visible || c.opacity === 0) return false;
                if (c.name === 'DhruvaStolenExtensionsBox') {
                    const subChildren = (c.get_children && c.get_children()) ? c.get_children().filter(sc => isActorAlive(sc) && sc.visible && sc.opacity > 0) : [];
                    return subChildren.length > 0;
                }
                return true;
            });
            let itemsW = 0;
            let itemsH = 0;
            for (let i = 0; i < visibleChildren.length; i++) {
                const cwP = visibleChildren[i].get_preferred_width(-1);
                const chP = visibleChildren[i].get_preferred_height(-1);
                itemsW += Math.round(cwP[1] || 0);
                itemsH += Math.round(chP[1] || 0);
            }
            const spacingSum = Math.max(0, (visibleChildren.length - 1) * 8);
            dynRightW = isVertical ? Math.max(boxW, 30) : Math.max(itemsW + spacingSum, 30);
            dynRightH = isVertical ? Math.max(itemsH + spacingSum, 32) : Math.max(Math.round(rhP[1] || 0), 32);
        }

        if (Settings.showDesktopButton) {
            const minCornerWidth = Math.max(12, Math.ceil((Settings.borderRadius || 18) * 0.55));
            const rawWidth = Settings.desktopBtnWidth;
            dynDeskSpan = Math.max(minCornerWidth, (rawWidth !== undefined && rawWidth !== null && rawWidth > 0) ? rawWidth : 12) + 8;
        }
    }

    const dynGapLeft = 16;
    const dynGapRight = 16;
    const dynOuterPad = 10;

    let effectiveBoxW = boxW;
    let effectiveBoxH = boxH;

    if (isDynamicPanel) {
        const availableMonitorSpan = isVertical ? (monitor.height - 24) : (monitor.width - 24);

        if (!isVertical) {
            const naturalPanelW = dynOuterPad + dynLeftW + dynGapLeft + boxW + dynGapRight + dynRightW + dynDeskSpan + dynOuterPad;
            effectiveBoxW = Math.min(availableMonitorSpan, naturalPanelW);
        } else {
            const naturalPanelH = dynOuterPad + dynLeftH + dynGapLeft + boxH + dynGapRight + dynRightH + dynDeskSpan + dynOuterPad;
            effectiveBoxH = Math.min(availableMonitorSpan, naturalPanelH);
        }
    }

    const baseActorW = isFullWidth ? (isVertical ? Math.max(boxW, gridW) + (sWidth * 2) : monitor.width) : effectiveBoxW + (sWidth * 2);
    const baseActorH = isFullWidth ? (isVertical ? monitor.height : Math.max(boxH, gridH) + (sWidth * 2)) : effectiveBoxH + (sWidth * 2);

    const actorW = isVertical ? (baseActorW + edgeMargin) : baseActorW;
    const actorH = isVertical ? baseActorH : (baseActorH + edgeMargin);

    dockUI.actor.set_size(actorW, actorH);

    let contentW = boxW + (sWidth * 2);
    let contentH = boxH + (sWidth * 2);

    if (isFullWidth) {
        if (dockUI.gridBtn && dockUI.gridBtn.visible && !isHybrid) {
            contentW += gridW + 30;
            contentH += gridH + 30;
        }
        if (dockUI.extractedClock && dockUI.extractedClock.visible) {
            contentW += clockW + 30;
            contentH += clockH + 30;
        }
    }

    const availableSpace = isVertical ? monitor.height : monitor.width;
    const baseContentSize = isVertical ? contentH : contentW;

    const scale = (isFullWidth || isHybrid)
        ? 1.0
        : calculateScale(isVertical, baseContentSize, zoomFactor, iconSize, availableSpace);

    const pivot = calculatePivot(pos, isFullWidth, isVertical, alignment);
    const pivotX = pivot.pivotX;
    const pivotY = pivot.pivotY;

    dockUI.actor.set_pivot_point(pivotX, pivotY);
    dockUI.actor.set_scale(scale, scale);

    const bgBounds = calculateBackgroundBounds(
        isFullWidth, isVertical, pos, scale, sWidth, effectiveBoxW, effectiveBoxH, monitor, pivotX, pivotY, baseActorW, baseActorH
    );
    let bgX = bgBounds.bgX;
    let bgY = bgBounds.bgY;
    let bgW = bgBounds.bgW;
    let bgH = bgBounds.bgH;

    if (isNeverHide && edgeMargin > 0) {
        if (pos === 'BOTTOM') {
            bgY = (actorH - bgH) - edgeMargin;
        } else if (pos === 'TOP') {
            bgY = edgeMargin;
        } else if (pos === 'LEFT') {
            bgX = edgeMargin;
        } else if (pos === 'RIGHT') {
            bgX = (actorW - bgW) - edgeMargin;
        }
    }

    const padScale = Math.max(4, 10 / scale);

    let cx = 0;
    let cy = 0;
    let rightOffset = 0;
    let bottomOffset = 0;

    const isPanelOrFull = isPanelOrFullWidth();
    const showDesktopBtn = Settings.showDesktopButton;
    let desktopStartX = -1;

    if (isPanelOrFull && showDesktopBtn && dockUI.extractedDesktop && isActorAlive(dockUI.extractedDesktop)) {
        dockUI.extractedDesktop.show();
        dockUI.extractedDesktop.opacity = 255;

        const deskInset = (!isFullWidth && !Settings.blurEnabled) ? sWidth : 0;
        const rawRadius = isFullWidth ? 0 : Settings.borderRadius;
        const minCornerWidth = isDynamicPanel ? Math.max(12, Math.ceil(rawRadius * 0.55)) : 12;
        const rawWidth = Settings.desktopBtnWidth;
        const deskBtnWidth = Math.max(minCornerWidth, (rawWidth !== undefined && rawWidth !== null && rawWidth > 0) ? rawWidth : 12);

        const dWidth = isVertical ? Math.max(4, bgW - (deskInset * 2)) : deskBtnWidth;
        const dHeight = isVertical ? deskBtnWidth : Math.max(4, bgH - (deskInset * 2));

        dockUI.extractedDesktop.set_size(Math.round(dWidth), Math.round(dHeight));

        const dx = isVertical ? (bgX + deskInset) : (bgX + bgW - deskInset - dWidth);
        const dy = isVertical ? (bgY + bgH - deskInset - dHeight) : (bgY + deskInset);

        dockUI.extractedDesktop.set_position(Math.round(dx), Math.round(dy));
        if (dockUI.extractedDesktop._refreshDesktopBtnStyle) {
            dockUI.extractedDesktop._refreshDesktopBtnStyle();
        }

        desktopStartX = dx;
        rightOffset = isVertical ? 0 : (dWidth + deskInset);
        bottomOffset = isVertical ? (dHeight + deskInset) : 0;
    } else if (dockUI.extractedDesktop && isActorAlive(dockUI.extractedDesktop) && !showDesktopBtn) {
        dockUI.extractedDesktop.hide();
    }

    if (isFullWidth && dockUI.extractedClock && dockUI.extractedClock.visible) {
        cx = isVertical ? bgX + (bgW - clockW) / 2 : bgX + bgW - clockW - rightOffset - 4;
        cy = isVertical ? bgY + bgH - clockH - bottomOffset - 4 : bgY + (bgH - clockH) / 2;
        dockUI.extractedClock.set_position(cx, cy);
    }

    if (isHybrid && dockUI.panelIntegrator && dockUI.panelIntegrator.leftContainer) {
        const leftBox = dockUI.panelIntegrator.leftContainer;
        if (leftBox.get_parent() !== dockUI.actor) {
            if (leftBox.get_parent()) leftBox.get_parent().remove_child(leftBox);
            dockUI.actor.add_child(leftBox);
        }
        leftBox.queue_relayout();

        const lwPref = leftBox.get_preferred_width(-1);
        const lhPref = leftBox.get_preferred_height(-1);
        let lw = Math.max(30, Math.round(lwPref[1] || 0));
        let lh = Math.max(20, Math.round(lhPref[1] || 0));

        const leftInset = isDynamicPanel ? (sWidth + dynOuterPad) : 0;
        const lx = isVertical ? bgX + (bgW - lw) / 2 : bgX + leftInset;
        const ly = isVertical ? bgY + leftInset : bgY + (bgH - lh) / 2;

        leftBox.set_position(Math.round(lx), Math.round(ly));
        leftBox.set_size(Math.round(lw), Math.round(lh));
        leftBox.show();
        leftBox.opacity = 255;
    }

    if (isHybrid && dockUI.panelIntegrator && dockUI.panelIntegrator.container) {
        const rightBox = dockUI.panelIntegrator.container;
        if (rightBox.get_parent() !== dockUI.actor) {
            if (rightBox.get_parent()) rightBox.get_parent().remove_child(rightBox);
            dockUI.actor.add_child(rightBox);
        }

        dockUI.panelIntegrator.alignItems();

        rightBox.set_size(-1, -1);
        const rhPref = rightBox.get_preferred_height(-1);
        let naturalH = rhPref[1] || 0;

        const visibleChildren = rightBox.get_children().filter(c => {
            if (!isActorAlive(c) || !c.visible || c.opacity === 0) return false;
            if (c.name === 'DhruvaStolenExtensionsBox') {
                const subChildren = (c.get_children && c.get_children()) ? c.get_children().filter(sc => isActorAlive(sc) && sc.visible && sc.opacity > 0) : [];
                return subChildren.length > 0;
            }
            return true;
        });

        let totalItemsW = 0;
        for (let i = 0; i < visibleChildren.length; i++) {
            const child = visibleChildren[i];
            const childWPref = child.get_preferred_width(-1);
            totalItemsW += Math.round(childWPref[1] || 0);
        }

        const spacingSum = Math.max(0, (visibleChildren.length - 1) * 8);
        const rw = Math.max(totalItemsW + spacingSum, 30);
        const rh = Math.max(Math.round(naturalH || 0), 32);

        const FIXED_GAP = 8;

        let rx = 0;
        let ry = 0;

        const rightInset = isDynamicPanel ? (sWidth + dynOuterPad) : 8;
        if (isVertical) {
            rx = bgX + (bgW - rw) / 2;
            ry = (bottomOffset > 0)
                ? (bgY + bgH - bottomOffset - FIXED_GAP - rh)
                : (bgY + bgH - rh - rightInset);
        } else {
            const targetRight = (desktopStartX > 0)
                ? (desktopStartX - FIXED_GAP)
                : (bgX + bgW - rightInset);
            rx = targetRight - rw;
            ry = bgY + (bgH - rh) / 2;
        }

        const nextX = Math.round(rx);
        const nextY = Math.round(ry);
        const nextW = Math.round(rw);
        const nextH = Math.round(rh);

        rightBox.set_position(nextX, nextY);
        rightBox.set_size(nextW, nextH);
        rightBox.show();
        rightBox.opacity = 255;

        if (dockUI.extractedDesktop && isActorAlive(dockUI.extractedDesktop)) {
            dockUI.actor.set_child_above_sibling(dockUI.extractedDesktop, null);
        }
    }

    let contentX = sWidth;
    let contentY = sWidth;
    const safetyGap = Math.max(16, 32 / scale);

    if (!isVertical) {
        if (isFullWidth) {
            if (alignment === 'START') contentX = bgX + padScale;
            else if (alignment === 'END') contentX = bgX + bgW - boxW - padScale;
            else contentX = bgX + (bgW - boxW) / 2;
        } else {
            contentX = bgX + (bgW - boxW) / 2;
        }
        contentY = bgY + (bgH - boxH) / 2;

        if (isHybrid && dockUI.panelIntegrator) {
            const leftBox = dockUI.panelIntegrator.leftContainer;
            const rightBox = dockUI.panelIntegrator.container;

            const WORKSPACE_LEFT_GAP = isDynamicPanel ? dynGapLeft : HYBRID_PANEL_CONFIG.DOCK_GAP_AFTER_LEFT;
            const RIGHT_PANEL_GAP = isDynamicPanel ? dynGapRight : HYBRID_PANEL_CONFIG.DOCK_GAP_BEFORE_RIGHT;

            let minBoxLeft = bgX + (isDynamicPanel ? (sWidth + dynOuterPad + dynLeftW + WORKSPACE_LEFT_GAP) : 100);
            if (isActorAlive(leftBox) && leftBox.visible) {
                const lwPref = leftBox.get_preferred_width(-1);
                const lw = leftBox.width > 0 ? leftBox.width : (lwPref[1] || 70);
                minBoxLeft = Math.round(leftBox.x + lw + WORKSPACE_LEFT_GAP);
            }

            const fallbackRightReserve = dockUI.isPanelHost ? 260 : 90;
            let maxBoxRight = bgX + bgW - fallbackRightReserve;
            if (isActorAlive(rightBox) && rightBox.visible && rightBox.x > 0) {
                maxBoxRight = rightBox.x - RIGHT_PANEL_GAP;
            }
            if (dockUI.extractedDesktop && isActorAlive(dockUI.extractedDesktop) && dockUI.extractedDesktop.visible) {
                if (dockUI.extractedDesktop.x > 0 && (dockUI.extractedDesktop.x - RIGHT_PANEL_GAP) < maxBoxRight) {
                    maxBoxRight = dockUI.extractedDesktop.x - RIGHT_PANEL_GAP;
                }
            }

            if (isDynamicPanel) {
                const freeCorridorW = Math.max(0, maxBoxRight - minBoxLeft);
                contentX = Math.round(minBoxLeft + Math.max(0, (freeCorridorW - boxW) / 2));
            } else {
                if (contentX + boxW > maxBoxRight) {
                    contentX = maxBoxRight - boxW;
                }
                if (contentX < minBoxLeft) {
                    contentX = minBoxLeft;
                }
            }

            if (!isDynamicPanel && contentX + boxW > maxBoxRight + 2) {
                dockUI.checkPanelOverflow();
            }
        }
    } else {
        if (isFullWidth) {
            if (alignment === 'START') contentY = bgY + padScale;
            else if (alignment === 'END') contentY = bgY + bgH - boxH - padScale;
            else contentY = bgY + (bgH - boxH) / 2;
        } else {
            contentY = bgY + (bgH - boxH) / 2;
        }
        contentX = bgX + (bgW - boxW) / 2;

        if (isHybrid && dockUI.panelIntegrator) {
            const leftBox = dockUI.panelIntegrator.leftContainer;
            const rightBox = dockUI.panelIntegrator.container;

            const vGapTop = isDynamicPanel ? dynGapLeft : HYBRID_PANEL_CONFIG.DOCK_GAP_AFTER_LEFT_VERTICAL;
            const vGapBottom = isDynamicPanel ? dynGapRight : HYBRID_PANEL_CONFIG.DOCK_GAP_BEFORE_RIGHT_VERTICAL;

            let minBoxTop = bgY + (isDynamicPanel ? (sWidth + dynOuterPad + dynLeftH + vGapTop) : 180);
            if (isActorAlive(leftBox) && leftBox.visible) {
                minBoxTop = (leftBox.y + leftBox.height) + vGapTop;
            }

            const fallbackBottomReserve = dockUI.isPanelHost ? 300 : 80;
            let maxBoxBottom = bgY + bgH - fallbackBottomReserve;
            if (isActorAlive(rightBox) && rightBox.visible && rightBox.y > 0) {
                maxBoxBottom = rightBox.y - vGapBottom;
            }

            if (isDynamicPanel) {
                const freeCorridorH = Math.max(0, maxBoxBottom - minBoxTop);
                contentY = Math.round(minBoxTop + Math.max(0, (freeCorridorH - boxH) / 2));
            } else {
                if (contentY + boxH > maxBoxBottom) {
                    contentY = maxBoxBottom - boxH;
                }
                if (contentY < minBoxTop) {
                    contentY = minBoxTop;
                }
            }

            if (!isDynamicPanel && contentY + boxH > maxBoxBottom + 2) {
                dockUI.checkPanelOverflow();
            }
        }
    }

    if (isGridExtracted && dockUI.gridBtn && dockUI.gridBtn.visible && !isHybrid) {
        const gx = isVertical ? bgX + (bgW - gridW) / 2 : bgX + padScale;
        const gy = isVertical ? bgY + padScale : bgY + (bgH - gridH) / 2;
        dockUI.gridBtn.set_position(gx, gy);

        if (!isVertical) {
            const gridRight = (bgX + padScale) + gridW + safetyGap;
            const boxLeft = contentX;
            if (boxLeft < gridRight) contentX += (gridRight - boxLeft);
        } else {
            const gridBottom = (bgY + padScale) + gridH + safetyGap;
            const boxTop = contentY;
            if (boxTop < gridBottom) contentY += (gridBottom - boxTop);
        }
    }

    if (isFullWidth && dockUI.extractedClock && dockUI.extractedClock.visible) {
        if (!isVertical) {
            const clockLeft = cx - safetyGap;
            const boxRight = contentX + boxW;
            if (boxRight > clockLeft) contentX -= (boxRight - clockLeft);
        } else {
            const clockTop = cy - safetyGap;
            const boxBottom = contentY + boxH;
            if (boxBottom > clockTop) contentY -= (boxBottom - clockTop);
        }
    }

    dockUI.boxActor.set_position(contentX, contentY);
    _syncPanelSeparator(dockUI, isVertical, contentX, contentY, boxW, boxH);
    dockUI.actor._isFullWidth = isFullWidth;
    dockUI.bgActor._baseX = bgX;
    dockUI.bgActor._baseY = bgY;
    dockUI.bgActor._baseW = bgW;
    dockUI.bgActor._baseH = bgH;

    if (!isFullWidth && dockUI.bgActor._isMagResetting) {
        _settleBackgroundAfterReset(dockUI, bgX, bgY, bgW, bgH);
    } else if (!dockUI.actor._isZoomActive || isFullWidth) {
        dockUI.bgActor.remove_all_transitions();
        dockUI.bgActor.set_position(bgX, bgY);
        dockUI.bgActor.set_size(bgW, bgH);
    }

    if (dockUI._syncBlurGeometry) {
        dockUI._syncBlurGeometry();
    }

    if (dockUI.dockManager) {
        dockUI.dockManager.updatePosition();
    }

    if (isDynamicPanel && !dockUI.isOverviewActive) {
        const dynPos = dockUI.settings ? (dockUI.settings.get_string('dynamic-panel-position') || 'CENTER') : 'CENTER';
        const outerGap = Math.max(8, Settings.dockMargin || 0);
        if (!isVertical) {
            if (dynPos === 'START') {
                dockUI.actor.x = Math.round(actualMonitor.x + outerGap);
            } else if (dynPos === 'END') {
                dockUI.actor.x = Math.round(actualMonitor.x + actualMonitor.width - actorW - outerGap);
            } else {
                dockUI.actor.x = Math.round(actualMonitor.x + (actualMonitor.width - actorW) / 2);
            }
        } else {
            if (dynPos === 'START') {
                dockUI.actor.y = Math.round(monitor.y + outerGap);
            } else if (dynPos === 'END') {
                dockUI.actor.y = Math.round(monitor.y + monitor.height - actorH - outerGap);
            } else {
                dockUI.actor.y = Math.round(monitor.y + (monitor.height - actorH) / 2);
            }
        }
        if (dockUI._syncBlurGeometry) {
            dockUI._syncBlurGeometry();
        }
    }

    if (dockUI.actor._fixedSlots && !dockUI.actor._isDragging && !dockUI.actor._isZoomActive) {
        dockUI.actor._fixedSlots = null;
    }

    dockUI.actor._cachedW = actorW;
    dockUI.actor._cachedH = actorH;
}