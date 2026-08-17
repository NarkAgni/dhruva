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

import { createWindowControl } from './ContextMenuItems.js';
import { animateMinimize, animateRestore } from '../effects/WindowEffects.js';


export function createThumbnailScroll(menu, app, windows, customSize) {
    const thumbSpacing = 12;
    const maxWidth = (customSize * 2) + thumbSpacing;
    const scrollStyle = windows.length > 2 ? `max-width: ${maxWidth}px;` : '';

    const thumbScroll = new St.ScrollView({
        vscrollbar_policy: St.PolicyType.NEVER,
        hscrollbar_policy: windows.length > 2 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
        enable_mouse_scrolling: true, 
        overlay_scrollbars: true, 
        style_class: 'context-menu-thumb-scroll',
        style: scrollStyle
    });

    thumbScroll.connect('scroll-event', (_actor, event) => {
        let [dx, dy] = event.get_scroll_direction() === Clutter.ScrollDirection.SMOOTH ? event.get_scroll_delta() : [0, 0];
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP) dy = -1; else if (direction === Clutter.ScrollDirection.DOWN) dy = 1; else if (direction === Clutter.ScrollDirection.LEFT) dx = -1; else if (direction === Clutter.ScrollDirection.RIGHT) dx = 1;
        if (Math.abs(dy) > Math.abs(dx) && dy !== 0) { dx = dy; dy = 0; }
        if (dx !== 0) {
            const adjustment = typeof thumbScroll.get_hadjustment === 'function' ? thumbScroll.get_hadjustment() : thumbScroll.get_hscroll_bar().get_adjustment();
            if (adjustment) {
                const step = direction === Clutter.ScrollDirection.SMOOTH ? dx * 40 : dx * 50;
                const newVal = Math.min(Math.max(adjustment.get_value() + step, adjustment.get_lower()), adjustment.get_upper() - adjustment.get_page_size());
                adjustment.set_value(newVal); return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    });

    const thumbBox = new St.BoxLayout({ vertical: false, reactive: true, style_class: 'context-menu-thumb-box', style: `spacing: ${thumbSpacing}px;` });
    if (windows.length <= 2) thumbBox.x_align = Clutter.ActorAlign.CENTER;

    let currentWindowsList = [...windows];
    currentWindowsList.forEach(win => {
        const card = createThumbnailCard(menu, app, win, customSize, thumbScroll, () => {
            currentWindowsList = currentWindowsList.filter(w => w !== win);
            if (currentWindowsList.length === 0) {
                menu._addAppToIgnoreList(app);
                if (menu.dockUI.actor) menu.dockUI.actor._lastIconClickTime = 0;
                menu.dockUI._renderDock(); menu.hide();
            }
        });
        thumbBox.add_child(card);
    });

    thumbScroll.add_child(thumbBox); 
    return thumbScroll;
}

function createThumbnailCard(menu, app, win, customSize, thumbScroll, onWindowClosed) {
    const card = new St.Widget({ layout_manager: new Clutter.BinLayout(), reactive: true });
    const thumbBtn = new St.Button({ reactive: true, x_expand: true, y_expand: true, style_class: 'context-menu-thumb-btn' });

    const compPrivate = win.get_compositor_private();
    if (compPrivate) {
        const clone = new Clutter.Clone({ source: compPrivate, reactive: false });
        const rect = win.get_frame_rect();
        const w = Math.max(1, rect.width || 1); const h = Math.max(1, rect.height || 1);
        let thumbW = customSize; let thumbH = (h / w) * thumbW;
        if (thumbH > customSize * 0.8) { thumbH = customSize * 0.8; thumbW = (w / h) * thumbH; }
        clone.set_size(thumbW, thumbH);
        thumbBtn.set_child(new St.Bin({ child: clone, style: 'border-radius: 6px; overflow: hidden;' }));
    }

    let winTitleText = win.get_title() || 'Window';
    if (winTitleText.length > 20) winTitleText = `${winTitleText.substring(0, 18)}...`;
    const titleLbl = new St.Label({ text: winTitleText, style_class: 'context-menu-thumb-title', reactive: false });
    const labelBin = new St.Bin({ child: titleLbl, x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.END, x_expand: true, y_expand: true, style_class: 'context-menu-thumb-title-bin' });

    const controlsBox = new St.BoxLayout({ vertical: false, opacity: 0, reactive: true, style_class: 'context-menu-controls-box', style: 'spacing: 4px; padding: 6px;' });

    if (!win.minimized) {
        controlsBox.add_child(createWindowControl('window-minimize-symbolic', '255, 189, 46', () => {
            menu.hide(); animateMinimize(win, menu.buttonActor, menu.dockUI.dockPosition);
        }));
    }

    const isMaximized = typeof win.is_maximized === 'function' ? win.is_maximized() : false;
    const maxIcon = win.minimized ? 'view-fullscreen-symbolic' : (isMaximized ? 'window-restore-symbolic' : 'window-maximize-symbolic');
    controlsBox.add_child(createWindowControl(maxIcon, '40, 201, 64', () => {
        menu._previousFocus = null; menu.hide(); win.activate(global.get_current_time());
        if (win.minimized) animateRestore(win, menu.buttonActor, menu.dockUI.dockPosition);
        else if (isMaximized) win.unmaximize(); else win.maximize();
        Main.activateWindow(win);
    }));

    const handleClose = () => {
        win.delete(global.get_current_time());
        const thumbBox = card.get_parent();
        const remaining = thumbBox ? thumbBox.get_children().length - 1 : 0;

        card.ease({
            scale_x: 0, scale_y: 0, opacity: 0, duration: 150,
            onComplete: () => {
                if (card) card.destroy();
                
                if (remaining > 0 && menu && menu.panel) {
                    if (remaining <= 2 && thumbScroll) {
                        thumbScroll.set_style(''); 
                        thumbScroll.hscrollbar_policy = St.PolicyType.NEVER;
                    }

                    const size = menu.dockUI.settings.get_int('context-menu-size') || 200;
                    const newWidth = Math.max(200, (remaining === 1 ? size : (size * 2) + 12) + 24 + 16);
                    menu._dynamicPanelWidth = newWidth;
                    menu.panel.set_width(newWidth);
                    menu._lastStateStr = null;
                } else if (remaining === 0 && menu) {
                    menu.hide();
                }
            }
        });
        if (menu.peekManager) menu.peekManager.stopPeek();
        if (onWindowClosed) onWindowClosed();
    };

    controlsBox.add_child(createWindowControl('window-close-symbolic', '255, 59, 48', handleClose));
    const controlsBin = new St.Bin({ child: controlsBox, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, x_expand: true, y_expand: true });

    card.add_child(thumbBtn); card.add_child(labelBin); card.add_child(controlsBin);

    card.connect('enter-event', () => {
        controlsBox.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_BACK });
        titleLbl.ease({ opacity: 0, duration: 150 });
        thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.6); transition-duration: 150ms;');
        if (menu.peekManager) menu.peekManager.startPeek(win);
        return Clutter.EVENT_PROPAGATE;
    });

    card.connect('leave-event', () => {
        controlsBox.ease({ opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_IN_QUAD });
        titleLbl.ease({ opacity: 255, duration: 150 });
        thumbBtn.set_style('border-radius: 10px; background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition-duration: 150ms;');
        if (menu.peekManager) menu.peekManager.stopPeek();
        return Clutter.EVENT_PROPAGATE;
    });

    thumbBtn.connect('clicked', () => {
        menu._previousFocus = null;
        if (win.minimized) animateRestore(win, menu.buttonActor, menu.dockUI.dockPosition);
        win.activate(global.get_current_time()); Main.activateWindow(win); menu.hide();
    });

    thumbBtn.connect('button-press-event', (_a, event) => event.get_button() === 2 ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE);
    thumbBtn.connect('button-release-event', (_a, event) => { if (event.get_button() === 2) { handleClose(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; });

    return card;
}