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
import cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { hideTooltip } from './MagnifierTooltip.js';
import { traceMenuPath } from '../shared/MenuShape.js';
import WorkspaceFilter from '../../core/WorkspaceFilter.js';
import { animateMinimize, animateRestore } from '../effects/WindowEffects.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';


function isActorAlive(actor) {
    if (!actor) return false;
    return actor.visible !== undefined;
}

export function createWindowControl(iconName, rgbColor, onClick, bindObj) {
    const btn = new St.Button({
        child: new St.Icon({ icon_name: iconName, icon_size: 13, style: 'color: rgba(255,255,255,1.0);' }),
        style_class: 'context-menu-win-control-btn',
        style: `background-color: rgba(${rgbColor}, 0.40);`,
        reactive: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER
    });
    const target = bindObj || btn;
    if (onClick) btn.connectObject('clicked', onClick, target);
    btn.connectObject('enter-event', () => {
        btn.set_style(`background-color: rgba(${rgbColor}, 0.75); border-radius: 999px; width: 20px; height: 20px; border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 4px 10px rgba(0,0,0,0.45); transition-duration: 150ms;`);
        btn.ease({ scale_x: 1.1, scale_y: 1.1, duration: 120 });
        return Clutter.EVENT_PROPAGATE;
    }, target);
    btn.connectObject('leave-event', () => {
        btn.set_style(`background-color: rgba(${rgbColor}, 0.40); border-radius: 999px; width: 20px; height: 20px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 2px 5px rgba(0,0,0,0.25); transition-duration: 150ms;`);
        btn.ease({ scale_x: 1.0, scale_y: 1.0, duration: 120 });
        return Clutter.EVENT_PROPAGATE;
    }, target);
    return btn;
}

export function createTooltipActor() {
    const tooltip = new St.Widget({ layout_manager: new Clutter.BinLayout(), visible: false, reactive: true, track_hover: true, style: 'background-color: transparent;' });
    const tooltipBg = new St.DrawingArea({ x_expand: true, y_expand: true, style: 'background-color: transparent;' });
    const tooltipBox = new St.BoxLayout({ vertical: true, style_class: 'dhruva-tooltip', style: 'background-color: transparent; border: none; box-shadow: none;' });
    tooltip.add_child(tooltipBg); tooltip.add_child(tooltipBox);
    return { tooltip, tooltipBg, tooltipBox };
}

export function applyTooltipCairoDrawing(tooltipBg, settings) {
    if (tooltipBg._repaintConnected) return;
    tooltipBg._repaintConnected = true;

    tooltipBg.connectObject('repaint', (area) => {
        const dockPos = settings.get_string('dock-position') || 'BOTTOM';
        const cr = area.get_context();
        const [fullW, fullH] = area.get_surface_size();
        const r = 18; const ah = 12; const aw = 24;
        const sw = area._sWidth || 0;
        const half = sw / 2; const w = fullW - sw; const h = fullH - sw;

        const ax = (area._arrowCenter || fullW / 2) - half;
        const ay = (area._arrowCenter || fullH / 2) - half;

        const parseRgba = (str) => { const m = (str || '').match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };

        cr.save(); cr.setOperator(cairo.Operator.CLEAR); cr.paint(); cr.restore();
        cr.translate(half, half);
        traceMenuPath(cr, w, h, r, ah, aw, dockPos, ax, ay);

        const [br, bg, bb, ba] = parseRgba(area._bgRgba);
        cr.setSourceRGBA(br / 255, bg / 255, bb / 255, ba); cr.fillPreserve();

        if (sw > 0) {
            const [sr, sg, sb, sa] = parseRgba(area._strokeRgba);
            cr.setSourceRGBA(sr / 255, sg / 255, sb / 255, sa);
            cr.setLineWidth(sw); cr.setLineJoin(cairo.LineJoin.ROUND); cr.stroke();
        } else { cr.newPath(); }
        cr.$dispose();
    }, tooltipBg);
}

export function populateTooltipContent(dockActor, btn, appName, settings) {
    dockActor._magTooltipBox.destroy_all_children();

    const tBg = dockActor._tooltipBg || 'background-color: rgba(20, 20, 22, 0.92);';
    const tFg = dockActor._tooltipFg || '#ffffff';
    
    let sWidth = settings.get_int('stroke-width') || 1;
    let sOpacity = (settings.get_int('stroke-opacity') || 20) / 100.0;

    let borderRgba = 'rgba(255,255,255,0.2)';
    if (tFg.startsWith('#')) {
        const r = parseInt(tFg.slice(1, 3), 16) || 255, g = parseInt(tFg.slice(3, 5), 16) || 255, b = parseInt(tFg.slice(5, 7), 16) || 255;
        borderRgba = `rgba(${r}, ${g}, ${b}, ${sOpacity})`;
    }

    let bgRgba = 'rgba(20, 20, 22, 0.92)';
    let match = tBg.match(/background-gradient-start:\s*(rgba?\([^)]+\))/);
    if (!match) match = tBg.match(/background-color:\s*(rgba?\([^)]+\))/);
    if (match) {
        const color = match[1];
        if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
            const allColors = tBg.match(/rgba?\([^)]+\)/g);
            if (allColors) bgRgba = allColors.find(c => c !== 'rgba(0, 0, 0, 0)' && c.replace(/\s/g, '') !== 'rgba(0,0,0,0)') || bgRgba;
        } else bgRgba = color;
    } else if (tBg.startsWith('#')) bgRgba = tBg;

    dockActor._magTooltipBg._bgRgba = bgRgba;
    dockActor._magTooltipBg._strokeRgba = borderRgba;
    dockActor._magTooltipBg._sWidth = sWidth;
    applyTooltipCairoDrawing(dockActor._magTooltipBg, settings);

    const ah = 12;
    let padBottom = 12, padTop = 12, padLeft = 12, padRight = 12;
    const dockPos = settings.get_string('dock-position') || 'BOTTOM';
    if (dockPos === 'BOTTOM') padBottom += ah; else if (dockPos === 'TOP') padTop += ah; else if (dockPos === 'LEFT') padLeft += ah; else if (dockPos === 'RIGHT') padRight += ah;

    dockActor._magTooltipBox.set_style(`color: ${tFg}; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px; background-color: transparent; border: none; box-shadow: none;`);
    const titleLbl = new St.Label({ text: appName, style: `font-weight: bold; text-align: center; color: ${tFg};` });
    dockActor._magTooltipBox.add_child(titleLbl);

    let windows = [];
    if (btn._delegate && btn._delegate.app && btn._delegate.app.get_windows) {
        windows = btn._delegate.app.get_windows();
        if (settings.get_boolean('isolate-monitors') && dockActor._dockUI) {
            const currentMonitorIndex = dockActor._dockUI.monitorManager.getCurrentMonitor().index;
            windows = windows.filter(w => w.get_monitor() === currentMonitorIndex);
        }
        windows = WorkspaceFilter.filterWindows(windows, settings);
    }

    if (windows.length > 0) {
        const thumbBox = new St.BoxLayout({ vertical: false, style: 'spacing: 12px; margin-top: 10px;' });
        const customSize = settings.get_int('context-menu-size') || 200;

        windows.forEach(win => {
            const thumbContainer = new St.Widget({ layout_manager: new Clutter.BinLayout(), reactive: true });
            const thumbBtn = new St.Button({ reactive: true, x_expand: true, y_expand: true, style_class: 'context-menu-thumb-btn' });
            thumbBtn.set_style('border-radius: 8px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms;');

            const compPrivate = win.get_compositor_private();
            if (compPrivate) {
                const clone = new Clutter.Clone({ source: compPrivate, reactive: false });
                const rect = win.get_frame_rect();
                const w = Math.max(1, rect.width || 1); const h = Math.max(1, rect.height || 1);
                let thumbW = customSize; let thumbH = (h / w) * thumbW;
                if (thumbH > customSize * 0.8) { thumbH = customSize * 0.8; thumbW = (w / h) * thumbH; }
                clone.set_size(thumbW, thumbH);
                thumbBtn.set_child(new St.Bin({ child: clone, style: 'border-radius: 6px; overflow: hidden;' }));
            } else thumbBtn.set_size(customSize, customSize * 0.6);

            let winTitleText = win.get_title() || 'Window';
            if (winTitleText.length > 20) winTitleText = `${winTitleText.substring(0, 18)}...`;
            const winTitleLbl = new St.Label({ text: winTitleText, style_class: 'context-menu-thumb-title', reactive: false });
            const labelBin = new St.Bin({ child: winTitleLbl, x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true, style_class: 'context-menu-thumb-title-bin' });

            const controlsBox = new St.BoxLayout({ vertical: false, opacity: 0, reactive: true, style_class: 'context-menu-controls-box', style: 'spacing: 4px; padding: 6px;' });
            
            if (!win.minimized) {
                controlsBox.add_child(createWindowControl('window-minimize-symbolic', '255, 189, 46', () => {
                    hideTooltip(dockActor); animateMinimize(win, btn, settings.get_string('dock-position') || 'BOTTOM');
                }, thumbContainer));
            }

            const isMaximized = win.is_maximized ? win.is_maximized() : false;
            const maxIcon = win.minimized ? 'view-fullscreen-symbolic' : (isMaximized ? 'window-restore-symbolic' : 'window-maximize-symbolic');
            controlsBox.add_child(createWindowControl(maxIcon, '40, 201, 64', () => {
                Main.activateWindow(win); hideTooltip(dockActor);
                if (win.minimized) animateRestore(win, btn, settings.get_string('dock-position') || 'BOTTOM');
                else if (isMaximized && win.unmaximize) win.unmaximize();
                else if (win.maximize) win.maximize();
            }, thumbContainer));

            const handleClose = () => {
                if (win.delete) win.delete(global.get_current_time());
                const parentBox = thumbContainer.get_parent();

                thumbContainer.ease({
                    scale_x: 0, scale_y: 0, opacity: 0, duration: 150,
                    onComplete: () => {
                        if (thumbContainer) thumbContainer.destroy();
                        if (parentBox && parentBox.get_children().length === 0) hideTooltip(dockActor);
                        else dockActor._lastTooltipStateStr = null; 
                    }
                });
                if (dockActor._magPeekManager) dockActor._magPeekManager.stopPeek();
            };

            const closeBtn = createWindowControl('window-close-symbolic', '255, 59, 48', handleClose, thumbContainer);
            controlsBox.add_child(closeBtn);

            const controlsBin = new St.Bin({ child: controlsBox, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, x_expand: true, y_expand: true });

            thumbContainer.add_child(thumbBtn); thumbContainer.add_child(labelBin); thumbContainer.add_child(controlsBin);

            thumbContainer.connectObject('enter-event', () => {
                thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.6); transition-duration: 150ms; box-shadow: 0 4px 12px rgba(0,0,0,0.4);');
                controlsBox.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_BACK });
                winTitleLbl.ease({ opacity: 0, duration: 150 });
                if (dockActor._magPeekManager) dockActor._magPeekManager.startPeek(win);
                return Clutter.EVENT_PROPAGATE;
            }, thumbContainer);

            thumbContainer.connectObject('leave-event', () => {
                thumbBtn.set_style('border-radius: 8px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms;');
                controlsBox.ease({ opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_IN_QUAD });
                winTitleLbl.ease({ opacity: 255, duration: 150 });
                if (dockActor._magPeekManager) dockActor._magPeekManager.stopPeek();
                return Clutter.EVENT_PROPAGATE;
            }, thumbContainer);

            thumbBtn.connectObject('clicked', () => {
                if (win.minimized) animateRestore(win, btn, settings.get_string('dock-position') || 'BOTTOM');
                Main.activateWindow(win); hideTooltip(dockActor);
            }, thumbBtn);

            thumbBtn.connectObject('button-press-event', (_a, event) => event.get_button() === 2 ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE, thumbBtn);
            thumbBtn.connectObject('button-release-event', (_a, event) => {
                if (event.get_button() === 2) { handleClose(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, thumbBtn);

            thumbBox.add_child(thumbContainer);
        });

        if (windows.length > 2) {
            const scroll = new St.ScrollView({ vscrollbar_policy: St.PolicyType.NEVER, hscrollbar_policy: St.PolicyType.AUTOMATIC, enable_mouse_scrolling: true, style: `max-width: ${(customSize * 2.5) + 20}px;` });
            scroll.connectObject('scroll-event', (_actor, event) => {
                let dx = 0, dy = 0; const dir = event.get_scroll_direction();
                if (dir === Clutter.ScrollDirection.SMOOTH) [dx, dy] = event.get_scroll_delta();
                else if (dir === Clutter.ScrollDirection.UP) dy = -1; else if (dir === Clutter.ScrollDirection.DOWN) dy = 1; else if (dir === Clutter.ScrollDirection.LEFT) dx = -1; else if (dir === Clutter.ScrollDirection.RIGHT) dx = 1;
                if (Math.abs(dy) > Math.abs(dx) && dy !== 0) { dx = dy; dy = 0; }
                if (dx !== 0) {
                    const adj = scroll.get_hadjustment ? scroll.get_hadjustment() : scroll.get_hscroll_bar().get_adjustment();
                    if (adj) {
                        let newVal = adj.get_value() + (dir === Clutter.ScrollDirection.SMOOTH ? dx * 40 : dx * 50);
                        const min = adj.get_lower(), max = adj.get_upper() - adj.get_page_size();
                        adj.set_value(Math.max(min, Math.min(newVal, max)));
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            }, scroll);
            scroll.add_child(thumbBox); dockActor._magTooltipBox.add_child(scroll);
        } else {
            dockActor._magTooltipBox.add_child(thumbBox);
        }
    }

    if (dockActor._tooltipPosTrackerId && dockActor._magTimers) {
        dockActor._magTimers.remove(dockActor._tooltipPosTrackerId);
        dockActor._tooltipPosTrackerId = null;
    }

    if (!dockActor._tooltipPosTrackerDestroyId) {
        dockActor._tooltipPosTrackerDestroyId = true;
        dockActor.connectObject('destroy', () => {
            if (dockActor._tooltipPosTrackerId && dockActor._magTimers) {
                dockActor._magTimers.remove(dockActor._tooltipPosTrackerId);
                dockActor._tooltipPosTrackerId = null;
            }
        }, dockActor);
    }
    
    const trackPos = () => {
        if (!isActorAlive(dockActor) || !dockActor._magTooltip) {
            dockActor._tooltipPosTrackerId = null;
            return GLib.SOURCE_REMOVE;
        }
        if (!dockActor._magTooltip.visible || dockActor._magTooltip.opacity === 0) return GLib.SOURCE_CONTINUE;

        if (!isActorAlive(btn) || !btn.get_parent()) {
            if (dockActor.boxActor) {
                const newBtn = dockActor.boxActor.get_children().find(c => c._delegate && c._delegate.app && c._delegate.app.get_name() === appName);
                if (newBtn) {
                    btn = newBtn; 
                } else {
                    hideTooltip(dockActor);
                    return GLib.SOURCE_REMOVE;
                }
            } else {
                hideTooltip(dockActor);
                return GLib.SOURCE_REMOVE;
            }
        }

        let [, tw] = dockActor._magTooltipBox.get_preferred_width(-1);
        let [, th] = dockActor._magTooltipBox.get_preferred_height(-1);

        const [bx, by] = btn.get_transformed_position();
        const [bw, bh] = btn.get_transformed_size();

        if (Number.isNaN(bx) || Number.isNaN(by) || bw <= 0 || (bx === 0 && by === 0 && !btn.get_parent())) return GLib.SOURCE_CONTINUE;

        const stateStr = `${bx},${by},${bw},${tw},${th}`;
        if (dockActor._lastTooltipStateStr === stateStr) return GLib.SOURCE_CONTINUE;
        dockActor._lastTooltipStateStr = stateStr;

        const dockPosStr = settings.get_string('dock-position') || 'BOTTOM';
        const btnClassStr = btn.get_style_class_name ? btn.get_style_class_name() : (btn.style_class || '');
        const gapAmt = (btnClassStr.includes('clock-module') || appName === 'Date & Time') ? 24 : 22;

        let tx = 0, ty = 0;
        const iconCenterX = bx + bw / 2;
        const iconCenterY = by + bh / 2;

        if (dockPosStr === 'BOTTOM') { tx = iconCenterX - tw / 2; ty = by - th - gapAmt; }
        else if (dockPosStr === 'TOP') { tx = iconCenterX - tw / 2; ty = by + bh + gapAmt; }
        else if (dockPosStr === 'LEFT') { tx = bx + bw + gapAmt; ty = iconCenterY - th / 2; }
        else if (dockPosStr === 'RIGHT') { tx = bx - tw - gapAmt; ty = iconCenterY - th / 2; }

        if (tx < 10) tx = 10;
        if (tx + tw > global.stage.width - 10) tx = global.stage.width - tw - 10;
        if (ty < 10) ty = 10;
        if (ty + th > global.stage.height - 10) ty = global.stage.height - th - 10;

        const minArrowPad = 18;
        if (dockPosStr === 'BOTTOM' || dockPosStr === 'TOP') dockActor._magTooltipBg._arrowCenter = Math.max(minArrowPad, Math.min(iconCenterX - tx, tw - minArrowPad));
        else dockActor._magTooltipBg._arrowCenter = Math.max(minArrowPad, Math.min(iconCenterY - ty, th - minArrowPad));

        dockActor._magTooltip.ease({ x: tx, y: ty, width: tw, height: th, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        dockActor._magTooltipBg.queue_repaint();
        
        return GLib.SOURCE_CONTINUE;
    };

    if (!dockActor._magTimers) dockActor._magTimers = new TimeoutTracker();
    dockActor._tooltipPosTrackerId = dockActor._magTimers.addTimeout(GLib.PRIORITY_DEFAULT, 16, trackPos);
}