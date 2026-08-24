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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutTracker } from './TimeoutTracker.js';


export default class NotificationManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this._appBadgeCounts = new Map();
        this._dbusSignalId = 0;
        
        this.timers = new TimeoutTracker();
        this._renderDebounceId = null;

        this._setupListeners();
    }

    _requestRender() {
        if (!this.dockUI || this._renderDebounceId) return;
        this._renderDebounceId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 60, () => {
            this._renderDebounceId = null;
            if (this.dockUI && this.dockUI.queueRender) {
                this.dockUI.queueRender();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

   _setupListeners() {
        this._dbusSignalId = Gio.DBus.session.signal_subscribe(
            null,
            'com.canonical.Unity.LauncherEntry',
            'Update',
            null,
            null,
            Gio.DBusSignalFlags.NONE,
            (...args) => {
                const parameters = args[5];
                this._onDBusBadgeUpdate(parameters);
            }
        );

        Main.messageTray.connectObject('source-added', () => this._requestRender(), this);
        Main.messageTray.connectObject('source-removed', () => this._requestRender(), this);
        Main.messageTray.connectObject('queue-changed', () => this._requestRender(), this);
    }

    _onDBusBadgeUpdate(parameters) {
        const appUriVariant = parameters.get_child_value(0);
        const propsVariant = parameters.get_child_value(1);

        if (!appUriVariant || !propsVariant) return;

        const appUri = appUriVariant.get_string()[0];
        const cleanId = appUri.replace('application://', '').toLowerCase();

        let count = 0;
        let isVisible = false;

        const countV = propsVariant.lookup_value('count', null);
        if (countV) count = countV.get_int64();

        const visibleV = propsVariant.lookup_value('count-visible', null);
        if (visibleV) isVisible = visibleV.get_boolean();

        if (isVisible && count > 0) {
            this._appBadgeCounts.set(cleanId, count);
        } else {
            this._appBadgeCounts.delete(cleanId);
        }

        this._requestRender();
    }

    getUnreadCount(app) {
        if (!app) return 0;

        if (app.get_state && app.get_state() === Shell.AppState.STOPPED) {
            const id = app.get_id() ? app.get_id().toLowerCase() : '';
            if (id && this._appBadgeCounts.has(id)) {
                this._appBadgeCounts.delete(id);
            }
            return 0;
        }

        const fullId = app.get_id() ? app.get_id().toLowerCase() : '';
        if (!fullId) return 0;

        let count = 0;

        if (this._appBadgeCounts.has(fullId)) {
            count = this._appBadgeCounts.get(fullId);
        }

        const baseId = fullId.replace('.desktop', '');
        const sources = Main.messageTray.getSources();

        for (const source of sources) {
            if (source.isChat) continue;

            let sourceId = '';
            if (source.app && source.app.get_id) sourceId = source.app.get_id();
            else if (source.appInfo && source.appInfo.get_id) sourceId = source.appInfo.get_id();
            else if (typeof source.title === 'string') sourceId = source.title;
            else if (source.id) sourceId = source.id;

            if (!sourceId) continue;
            sourceId = sourceId.toLowerCase();

            if (sourceId === baseId || sourceId.includes(baseId) || baseId.includes(sourceId.replace('.desktop', ''))) {
                let sourceCount = 1;

                if (source.notifications) {
                    sourceCount = source.notifications.length;
                } else if (source.count || source.unreadCount) {
                    sourceCount = source.count || source.unreadCount;
                }

                if (sourceCount > 0) count += sourceCount;
            }
        }

        return count;
    }

    createBadgeActor(count, iconSize) {
        if (count <= 0) return null;

        const oversample = 3;
        const baseHeight = Math.max(18, Math.floor(iconSize * 0.38));
        const displayCount = count > 99 ? '99+' : count.toString();
        const baseFontSize = Math.max(10, Math.floor(baseHeight * 0.62));

        const drawHeight = baseHeight * oversample;
        const fontSize = baseFontSize * oversample;

        const badgeArea = new St.DrawingArea({
            clip_to_allocation: false
        });

        const tempLayout = badgeArea.create_pango_layout(displayCount);
        tempLayout.set_font_description(Pango.FontDescription.from_string(`Sans Bold ${fontSize}px`));
        const [tw] = tempLayout.get_pixel_size();

        const padding = Math.floor(drawHeight * 0.35);
        const drawWidth = Math.max(drawHeight, tw + padding * 2);

        badgeArea.set_size(drawWidth, drawHeight);

        badgeArea.connect('repaint', (area) => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();

            const layout = area.create_pango_layout(displayCount);
            layout.set_font_description(Pango.FontDescription.from_string(`Sans Bold ${fontSize}px`));

            cr.setSourceRGBA(1.0, 59 / 255, 48 / 255, 1.0);
            const r = h / 2;
            cr.newSubPath();
            cr.arc(r, r, r, Math.PI / 2, Math.PI * 1.5);
            cr.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
            cr.closePath();
            cr.fill();

            cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
            const [textW, textH] = layout.get_pixel_size();
            cr.moveTo((w - textW) / 2, (h - textH) / 2);
            PangoCairo.show_layout(cr, layout);

            cr.$dispose();
        });

        badgeArea.queue_repaint();

        badgeArea.set_scale(1 / oversample, 1 / oversample);
        badgeArea.set_pivot_point(0, 0);

        const visualW = drawWidth / oversample;

        const shiftLeft = Math.floor(iconSize * 0.50);
        const shiftUp = Math.floor(iconSize * 0.60);

        const targetX = iconSize - visualW - shiftLeft;
        const targetY = -shiftUp;

        badgeArea.set_position(targetX, targetY);

        const zeroBox = new St.Widget({
            width: 0,
            height: 0,
            clip_to_allocation: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START
        });

        zeroBox.add_child(badgeArea);

        return zeroBox;
    }

    destroy() {
        this.timers.destroy();

        if (this._dbusSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._dbusSignalId);
            this._dbusSignalId = 0;
        }

        Main.messageTray.disconnectObject(this);
        this._appBadgeCounts.clear();
        this.dockUI = null;
    }
}