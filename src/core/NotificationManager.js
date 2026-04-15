/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export default class NotificationManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this._appBadgeCounts = new Map();
        this._dbusSignalId = 0;
        this._traySignals = [];
        this._renderDebounceId = 0;

        this._setupListeners();
    }

    _requestRender() {
        if (!this.dockUI || this._renderDebounceId) return;
        this._renderDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._renderDebounceId = 0;
            if (this.dockUI && typeof this.dockUI.queueRender === 'function') {
                this.dockUI.queueRender();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupListeners() {
        try {
            this._dbusSignalId = Gio.DBus.session.signal_subscribe(
                null,
                'com.canonical.Unity.LauncherEntry',
                'Update',
                null,
                null,
                Gio.DBusSignalFlags.NONE,
                (connection, senderName, objectPath, interfaceName, signalName, parameters) => {
                    this._onDBusBadgeUpdate(parameters);
                }
            );
        } catch (e) {
            console.error('[Dhruva Badge] D-Bus listener failed:', e);
        }

        this._traySignals.push(Main.messageTray.connect('source-added', () => this._requestRender()));
        this._traySignals.push(Main.messageTray.connect('source-removed', () => this._requestRender()));
        this._traySignals.push(Main.messageTray.connect('queue-changed', () => this._requestRender()));
    }

    _onDBusBadgeUpdate(parameters) {
        try {
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
        } catch (e) {
            console.error('[Dhruva Badge] D-Bus decode error:', e);
        }
    }

    getUnreadCount(app) {
        if (!app) return 0;

        const fullId = app.get_id() ? app.get_id().toLowerCase() : '';
        if (!fullId) return 0;

        let count = 0;

        if (this._appBadgeCounts.has(fullId)) {
            count = this._appBadgeCounts.get(fullId);
        }

        try {
            const baseId = fullId.replace('.desktop', '');
            const sources = Main.messageTray.getSources();

            for (const source of sources) {
                if (source.isChat) continue;

                let sourceId = '';
                if (source.app && typeof source.app.get_id === 'function') sourceId = source.app.get_id();
                else if (source.appInfo && typeof source.appInfo.get_id === 'function') sourceId = source.appInfo.get_id();
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
        } catch (e) {}

        return count;
    }

    createBadgeActor(count, iconSize) {
        if (count <= 0) return null;

        const oversample = 3;
        const baseHeight = Math.max(18, Math.floor(iconSize * 0.38));
        const displayCount = count > 99 ? '99+' : count.toString();
        const baseFontSize = Math.max(10, Math.floor(baseHeight * 0.95));

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

            cr.setSourceRGBA(155 / 255, 155 / 255, 155 / 255, 1.0);
            const r = h / 2;
            cr.newSubPath();
            cr.arc(r, r, r, Math.PI / 2, Math.PI * 1.5);
            cr.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
            cr.closePath();
            cr.fill();

            cr.setSourceRGBA(0, 0, 0, 1.0);
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
        if (this._renderDebounceId) {
            try {
                GLib.source_remove(this._renderDebounceId);
            } catch (_e) {}
            this._renderDebounceId = 0;
        }
        if (this._dbusSignalId) {
            try {
                Gio.DBus.session.signal_unsubscribe(this._dbusSignalId);
            } catch (e) {}
            this._dbusSignalId = 0;
        }

        this._traySignals.forEach(id => {
            try {
                Main.messageTray.disconnect(id);
            } catch (e) {}
        });
        this._traySignals = [];
        this._appBadgeCounts.clear();
        this.dockUI = null;
    }
}