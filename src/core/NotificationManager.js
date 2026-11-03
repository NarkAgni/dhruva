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
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Settings } from './SettingsManager.js';
import { TimeoutTracker } from './TimeoutTracker.js';


const RENDER_DEBOUNCE_INTERVAL_MS = 60;
const BADGE_OVERSAMPLE = 3;
const BADGE_RISE = 0.25;
const GENERIC_POLICY_ID = 'generic';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const ACCENT_COLOR_KEY = 'accent-color';
const DEFAULT_BADGE_COLOR = [230, 45, 66];
const ACCENT_COLORS = {
    blue: [53, 132, 228],
    teal: [33, 144, 164],
    green: [58, 148, 74],
    yellow: [200, 136, 0],
    orange: [237, 91, 0],
    red: [230, 45, 66],
    pink: [213, 97, 153],
    purple: [145, 65, 172],
    slate: [111, 131, 150],
};

function hexToChannels(hex) {
    const value = parseInt(hex.slice(1), 16);
    return hex.length === 7 && Number.isFinite(value)
        ? [(value >> 16) & 255, (value >> 8) & 255, value & 255]
        : DEFAULT_BADGE_COLOR;
}

function createAccentSettings() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(INTERFACE_SCHEMA, true);
    return schema && schema.has_key(ACCENT_COLOR_KEY) ? new Gio.Settings({ schema_id: INTERFACE_SCHEMA }) : null;
}

export default class NotificationManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.timers = new TimeoutTracker();
        this._renderDebounceId = 0;
        this._launcherEntries = new Map();
        this._trackedSources = new Set();
        this._trackedNotifications = new Set();
        this._accentSettings = createAccentSettings();

        if (this._accentSettings) {
            this._accentSettings.connectObject(`changed::${ACCENT_COLOR_KEY}`, () => this._requestRender(), this);
        }

        this._launcherSignalId = Gio.DBus.session.signal_subscribe(
            null,
            'com.canonical.Unity.LauncherEntry',
            'Update',
            null,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, sender, _path, _iface, _signal, parameters) => this._onLauncherEntryUpdate(sender, parameters)
        );

        this._nameOwnerSignalId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, parameters) => this._onNameOwnerChanged(parameters)
        );

        Main.messageTray.connectObject(
            'source-added', (_tray, source) => this._trackSource(source),
            'source-removed', (_tray, source) => this._untrackSource(source),
            this
        );

        Main.messageTray.getSources().forEach(source => this._trackSource(source));
    }

    _requestRender() {
        if (!this.dockUI || this._renderDebounceId) return;
        this._renderDebounceId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, RENDER_DEBOUNCE_INTERVAL_MS, () => {
            this._renderDebounceId = 0;
            if (this.dockUI) this.dockUI.queueRender();
            return GLib.SOURCE_REMOVE;
        });
    }

    _requestRenderForSource(source) {
        if (this._getSourceAppId(source)) this._requestRender();
    }

    _trackSource(source) {
        if (this._trackedSources.has(source)) return;
        this._trackedSources.add(source);

        source.connectObject('notification-added', (_source, notification) => this._trackNotification(source, notification), this);
        source.notifications.forEach(notification => this._trackNotification(source, notification));
    }

    _untrackSource(source) {
        if (!this._trackedSources.delete(source)) return;
        source.disconnectObject(this);
        this._requestRenderForSource(source);
    }

    _trackNotification(source, notification) {
        if (this._trackedNotifications.has(notification)) return;
        this._trackedNotifications.add(notification);

        notification.connectObject('destroy', () => {
            this._trackedNotifications.delete(notification);
            this._requestRenderForSource(source);
        }, this);
        this._requestRenderForSource(source);
    }

    _onLauncherEntryUpdate(sender, parameters) {
        const [appUri, properties] = parameters.deepUnpack();
        const appId = appUri.replace('application://', '').toLowerCase();
        const previousCount = this._getLauncherCount(appId);
        const entry = this._launcherEntries.get(appId) || { count: 0, visible: false, sender };

        if (properties['count']) entry.count = Number(properties['count'].unpack());
        if (properties['count-visible']) entry.visible = properties['count-visible'].unpack();
        entry.sender = sender;

        this._launcherEntries.set(appId, entry);
        if (this._getLauncherCount(appId) !== previousCount) this._requestRender();
    }

    _onNameOwnerChanged(parameters) {
        const [name, , newOwner] = parameters.deepUnpack();
        if (newOwner) return;

        let changed = false;
        this._launcherEntries.forEach((entry, appId) => {
            if (entry.sender !== name) return;
            changed = changed || this._getLauncherCount(appId) > 0;
            this._launcherEntries.delete(appId);
        });
        if (changed) this._requestRender();
    }

    _getSourceAppId(source) {
        if (source.app) return source.app.get_id().toLowerCase();

        const policyId = source.policy ? source.policy.id : '';
        if (!policyId || policyId === GENERIC_POLICY_ID) return '';
        return `${policyId}.desktop`.toLowerCase();
    }

    _getLauncherCount(appId) {
        const entry = this._launcherEntries.get(appId);
        return entry && entry.visible ? entry.count : 0;
    }

    _getNotificationCount(appId) {
        let count = 0;
        this._trackedSources.forEach(source => {
            if (this._getSourceAppId(source) === appId) count += source.notifications.length;
        });
        return count;
    }

    _getAccentChannels() {
        const accent = this._accentSettings ? this._accentSettings.get_string(ACCENT_COLOR_KEY) : '';
        return ACCENT_COLORS[accent] || DEFAULT_BADGE_COLOR;
    }

    _getBadgeColor() {
        const channels = Settings.notificationBadgeColorMode === 'custom'
            ? hexToChannels(Settings.notificationBadgeColor)
            : this._getAccentChannels();
        return channels.map(channel => channel / 255);
    }

    getUnreadCount(app) {
        const appId = app.get_id().toLowerCase();
        const launcherCount = this._getLauncherCount(appId);
        return launcherCount > 0 ? launcherCount : this._getNotificationCount(appId);
    }

    createBadgeActor(count, iconSize) {
        if (count <= 0) return null;

        const baseHeight = Math.max(18, Math.floor(iconSize * 0.38));
        const displayCount = count > 99 ? '99+' : count.toString();
        const baseFontSize = Math.max(10, Math.floor(baseHeight * 0.62));

        const drawHeight = baseHeight * BADGE_OVERSAMPLE;
        const fontSize = baseFontSize * BADGE_OVERSAMPLE;
        const fontDesc = Pango.FontDescription.from_string(`Sans Bold ${fontSize}px`);
        const [red, green, blue] = this._getBadgeColor();

        const badgeArea = new St.DrawingArea({
            clip_to_allocation: false
        });

        const tempLayout = badgeArea.create_pango_layout(displayCount);
        tempLayout.set_font_description(fontDesc);
        const [tw] = tempLayout.get_pixel_size();

        const padding = Math.floor(drawHeight * 0.35);
        const drawWidth = Math.max(drawHeight, tw + padding * 2);

        badgeArea.set_size(drawWidth, drawHeight);

        badgeArea.connectObject('repaint', (area) => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();

            const layout = area.create_pango_layout(displayCount);
            layout.set_font_description(fontDesc);

            cr.setSourceRGBA(red, green, blue, 1.0);
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
        }, badgeArea);

        badgeArea.queue_repaint();

        badgeArea.set_scale(1 / BADGE_OVERSAMPLE, 1 / BADGE_OVERSAMPLE);
        badgeArea.set_pivot_point(0, 0);

        const visualW = drawWidth / BADGE_OVERSAMPLE;
        badgeArea.set_position(
            Math.round(iconSize - visualW),
            Math.round(-baseHeight * BADGE_RISE)
        );

        const badgeLayer = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: false,
            reactive: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL
        });

        badgeLayer.add_child(badgeArea);

        return badgeLayer;
    }

    destroy() {
        this.timers.destroy();

        Gio.DBus.session.signal_unsubscribe(this._launcherSignalId);
        Gio.DBus.session.signal_unsubscribe(this._nameOwnerSignalId);

        Main.messageTray.disconnectObject(this);
        if (this._accentSettings) this._accentSettings.disconnectObject(this);
        this._trackedSources.forEach(source => source.disconnectObject(this));
        this._trackedNotifications.forEach(notification => notification.disconnectObject(this));
        this._trackedSources.clear();
        this._trackedNotifications.clear();
        this._launcherEntries.clear();

        this._accentSettings = null;
        this.dockUI = null;
    }
}