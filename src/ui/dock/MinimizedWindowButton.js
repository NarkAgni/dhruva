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
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { applyIconFilter } from '../DragDrop.js';
import { getIndicatorProps } from './DockRenderer.js';
import { Settings } from '../../core/SettingsManager.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { animateRestore, isThumbnailHidden } from '../effects/WindowEffects.js';
import { createBaseButtonContainer, attachHoverBackground } from './DockButtonBase.js';


const THUMBNAIL_RATIO = 0.9;
const BADGE_RATIO = 0.42;
const FADE_MS = 180;
const DRAG_CANCEL_DELTA_PX = 15;

function layoutThumbnail(frame, clone, win, size) {
    const frameRect = win.get_frame_rect();
    const bufferRect = win.get_buffer_rect();
    if (frameRect.width <= 0 || frameRect.height <= 0) return;

    const scale = size / Math.max(frameRect.width, frameRect.height);
    frame.set_size(Math.round(frameRect.width * scale), Math.round(frameRect.height * scale));
    clone.set_size(bufferRect.width * scale, bufferRect.height * scale);
    clone.set_position((bufferRect.x - frameRect.x) * scale, (bufferRect.y - frameRect.y) * scale);
}

function createAppBadge(app, iconSize) {
    const badgeSize = Math.round(iconSize * BADGE_RATIO);
    const maxZoom = Settings.hoverZoom ? 1.0 + (Settings.hoverZoomFactor - 1.0) * 2.0 : 1.0;
    const badge = app.create_icon_texture(Math.ceil(badgeSize * maxZoom));
    badge.set_size(badgeSize, badgeSize);
    badge.set_x_align(Clutter.ActorAlign.END);
    badge.set_y_align(Clutter.ActorAlign.END);
    badge.set_x_expand(true);
    badge.set_y_expand(true);
    return badge;
}

export function createWindowThumbnail(win, iconSize) {
    const app = Shell.WindowTracker.get_default().get_window_app(win);
    const thumbSize = Math.round(iconSize * THUMBNAIL_RATIO);

    const clone = new Clutter.Clone({ source: win.get_compositor_private(), reactive: false });
    const frame = new St.Widget({
        clip_to_allocation: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    frame.add_child(clone);
    layoutThumbnail(frame, clone, win, thumbSize);

    const actor = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: iconSize,
        height: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true,
    });
    actor.add_child(frame);
    if (app) actor.add_child(createAppBadge(app, iconSize));

    win.connectObject('size-changed', () => layoutThumbnail(frame, clone, win, thumbSize), actor);
    return { actor, frame, app };
}

export function buildMinimizedWindowButton(dockUI, win) {
    const iconSize = Settings.iconSize;
    const isVerticalDock = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';
    const { actor: iconWrapper, frame, app } = createWindowThumbnail(win, iconSize);
    frame.opacity = isThumbnailHidden(win) ? 0 : 255;

    const appBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: false,
        x_expand: true,
        y_expand: true,
    });
    appBox.set_pivot_point(0.5, 0.5);
    appBox.add_child(iconWrapper);

    const pad = Math.max(Settings.dockHeight || 6, 4);
    const btn = createBaseButtonContainer(appBox);
    btn._appBox = appBox;
    btn._iconWrapper = iconWrapper;
    btn._indicatorActor = null;
    btn._hasRunningIndicator = false;
    btn._minimizedWindow = win;
    btn._dims = { iconSize, pad, expandedDim: iconSize + pad * 2, collapsedDim: iconSize + 2, isVerticalDock };

    attachHoverBackground(dockUI, btn, appBox, false, getIndicatorProps(dockUI, app), btn._dims);

    btn._revealThumbnail = () => {
        frame.remove_all_transitions();
        frame.ease({ opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    };
    btn._hideThumbnail = () => {
        frame.remove_all_transitions();
        frame.opacity = 0;
    };

    btn._delegate = {
        app: {
            is_module: true,
            get_id: () => btn._entityId,
            get_name: () => win.get_title() || (app ? app.get_name() : _('Window')),
            get_windows: () => [],
        },
    };

    btn._activateCallback = (buttonNum, state = 0) => {
        if (buttonNum === 1) {
            Main.overview.hide();
            animateRestore(win, btn, dockUI.dockPosition);
        } else if (buttonNum === 3 && app) {
            const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
            new AppContextMenu(dockUI, app, btn, isCtrl, dockUI.openPrefsCallback).show(dockUI.dockPosition);
        }
    };

    btn.connectObject(
        'button-press-event', (_actor, event) => {
            [btn._pressX, btn._pressY] = event.get_coords();
            return Clutter.EVENT_PROPAGATE;
        },
        'button-release-event', (_actor, event) => {
            if (dockUI.activeContextMenu) {
                dockUI.activeContextMenu.hide();
                return Clutter.EVENT_STOP;
            }
            const [rx, ry] = event.get_coords();
            if (Math.abs(rx - btn._pressX) > DRAG_CANCEL_DELTA_PX || Math.abs(ry - btn._pressY) > DRAG_CANCEL_DELTA_PX) {
                return Clutter.EVENT_PROPAGATE;
            }
            btn._activateCallback(event.get_button(), event.get_state());
            return Clutter.EVENT_STOP;
        },
        btn
    );

    win.connectObject('unmanaged', () => dockUI.queueRender('incremental', true), btn);

    if (Settings.hoverZoom) applyIconFilter(btn);
    return btn;
}