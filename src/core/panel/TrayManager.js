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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../Utils.js';


export const WIDE_INDICATOR_PX = 80;

const SYSTEM_INDICATORS = new Set([
    'activities', 'aggregateMenu', 'quickSettings', 'dateMenu', 'appMenu',
    'keyboard', 'a11y', 'screenShield', 'dwellClick', 'screenRecording',
    'screenSharing', 'system', 'power', 'volume', 'network', 'bluetooth',
    'input-method', 'ibus',
    'tiling-assistant@leleat-on-github',
    'tiling-assistant@ubuntu.com',
    'tiling-assistant',
]);

const BLACKLISTED_KEYWORDS = [
    'tiling-assistant',
    'tilingassistant',
    'leleat-on-github',
];

const PANEL_KEY = 'tray-panel-indicators';
const ORDER_KEY = 'tray-order';


function isBlacklisted(name, indicator) {
    if (SYSTEM_INDICATORS.has(name)) return true;

    const lowerName = name.toLowerCase();
    const ctor = indicator.constructor;
    const className = (ctor && ctor.name ? ctor.name : '').toLowerCase();
    const gtypeName = (ctor && ctor.$gtype && ctor.$gtype.name ? ctor.$gtype.name : '').toLowerCase();
    const accName = (indicator.accessible_name || '').toLowerCase();

    return BLACKLISTED_KEYWORDS.some(keyword =>
        lowerName.includes(keyword) ||
        className.includes(keyword) ||
        gtypeName.includes(keyword) ||
        accName.includes(keyword)
    );
}

export function hasRealVisualContent(actor) {
    if (!isActorAlive(actor) || !actor.visible || actor.opacity === 0) return false;

    if ('icon_size' in actor) {
        return Boolean((actor.icon_name && actor.icon_name.trim()) || actor.gicon);
    }
    if ('clutter_text' in actor && actor.text && actor.text.trim()) return true;
    if (actor.content && (actor.content.get_texture || actor.content.paint)) return true;
    if ('get_context' in actor || 'source' in actor) return true;

    return actor.get_children().some(child => hasRealVisualContent(child));
}

export function indicatorDisplayName(name, indicator) {
    if (indicator.accessible_name) return indicator.accessible_name;
    const base = name.split('@')[0].replace(/[-_.]+/g, ' ').trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
}

export default class TrayManager {
    constructor(settings, onStateChanged) {
        this._settings = settings;
        this.onStateChanged = onStateChanged;
    }

    get _panelChoices() {
        return new Set(this._settings.get_strv(PANEL_KEY));
    }

    _liveIndicators() {
        const list = [];
        for (const [name, indicator] of Object.entries(Main.panel.statusArea)) {
            if (!indicator || !indicator.visible || isBlacklisted(name, indicator)) continue;
            const actor = indicator.container;
            if (!hasRealVisualContent(actor)) continue;
            list.push({ name, actor, indicator, displayName: indicatorDisplayName(name, indicator) });
        }
        return list;
    }

    _isSmall(actor) {
        const w = actor.get_width();
        const naturalW = w > 0 ? w : actor.get_preferred_width(-1)[1];
        return naturalW <= WIDE_INDICATOR_PX;
    }

    isInTray(name, actor) {
        return this._isSmall(actor) && !this._panelChoices.has(name);
    }

    getTrayIndicators() {
        const inTray = this._liveIndicators().filter(item => this.isInTray(item.name, item.actor));
        const order = this._settings.get_strv(ORDER_KEY);
        const rank = name => {
            const index = order.indexOf(name);
            return index === -1 ? order.length : index;
        };
        return inTray.sort((a, b) => rank(a.name) - rank(b.name));
    }

    getPanelIndicators() {
        return this._liveIndicators().filter(item => !this.isInTray(item.name, item.actor));
    }

    getPinnedIndicators() {
        const pinned = this._panelChoices;
        return this._liveIndicators().filter(item => this._isSmall(item.actor) && pinned.has(item.name));
    }

    moveToPanel(name) {
        const pinned = this._panelChoices;
        pinned.add(name);
        this._settings.set_strv(PANEL_KEY, [...pinned]);
        this.onStateChanged();
    }

    moveToTray(name) {
        const pinned = this._panelChoices;
        pinned.delete(name);
        this._settings.set_strv(PANEL_KEY, [...pinned]);
        this.onStateChanged();
    }

    resetToDefaults() {
        this._settings.set_strv(PANEL_KEY, []);
        this._settings.set_strv(ORDER_KEY, []);
        this.onStateChanged();
    }

    reorderTrayIndicators(fromIndex, toIndex) {
        const names = this.getTrayIndicators().map(item => item.name);
        if (fromIndex < 0 || fromIndex >= names.length || toIndex < 0 || toIndex >= names.length) return;

        const [moved] = names.splice(fromIndex, 1);
        names.splice(toIndex, 0, moved);
        this._settings.set_strv(ORDER_KEY, names);
    }
}
