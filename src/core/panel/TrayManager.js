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


const SYSTEM_INDICATORS = [
    'activities', 'aggregateMenu', 'quickSettings', 'dateMenu', 'appMenu',
    'keyboard', 'a11y', 'screenShield', 'dwellClick', 'screenRecording',
    'screenSharing', 'system', 'power', 'volume', 'network', 'bluetooth',
    'input-method', 'ibus',
    'tiling-assistant@leleat-on-github',
    'tiling-assistant@ubuntu.com',
    'tiling-assistant',
];

const BLACKLISTED_KEYWORDS = [
    'tiling-assistant',
    'tilingassistant',
    'leleat-on-github',
];

const PANEL_KEY = 'tray-panel-indicators';
const WIDE_KEY = 'tray-wide-indicators';
const ORDER_KEY = 'tray-order';
const INLINE_KEY = 'tray-inline';
const MAX_ICON_SPAN = 1.5;


function isBlacklisted(name, indicator) {
    if (SYSTEM_INDICATORS.includes(name)) return true;

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

function naturalRatio(actor) {
    const [, width] = actor.get_preferred_width(-1);
    const [, height] = actor.get_preferred_height(-1);
    return width > 0 && height > 0 ? width / height : 1;
}

export function visualLeaves(actor, leaves = []) {
    if (!isActorAlive(actor) || !actor.visible) return leaves;

    if ('icon_size' in actor) {
        if ((actor.icon_name && actor.icon_name.trim()) || actor.gicon) leaves.push(actor);
    } else if ('clutter_text' in actor) {
        if (actor.text && actor.text.trim()) leaves.push(actor);
    } else if ('get_surface_size' in actor || 'source' in actor || actor.content) {
        leaves.push(actor);
    } else {
        for (const child of actor.get_children()) visualLeaves(child, leaves);
    }
    return leaves;
}

function contentStats(actor) {
    const stats = { span: 0, hasText: false };
    for (const leaf of visualLeaves(actor)) {
        if ('icon_size' in leaf) stats.span += 1;
        else if ('clutter_text' in leaf) stats.hasText = true;
        else stats.span += naturalRatio(leaf);
    }
    return stats;
}

function indicatorDisplayName(name, indicator) {
    if (indicator.accessible_name) return indicator.accessible_name;
    const base = name.split('@')[0].replace(/[-_.]+/g, ' ').trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
}

export default class TrayManager {
    constructor(settings, onStateChanged) {
        this._settings = settings;
        this.onStateChanged = onStateChanged;
    }

    _choices(key) {
        return new Set(this._settings.get_strv(key));
    }

    _liveIndicators() {
        const list = [];
        for (const [name, indicator] of Object.entries(Main.panel.statusArea)) {
            if (!indicator || !indicator.visible || isBlacklisted(name, indicator)) continue;
            const actor = indicator.container;
            const { span, hasText } = contentStats(actor);
            if (span === 0 && !hasText) continue;
            list.push({
                name,
                actor,
                indicator,
                isIconLike: !hasText && span <= MAX_ICON_SPAN,
                displayName: indicatorDisplayName(name, indicator),
            });
        }
        return list;
    }

    isInline() {
        return this._settings.get_boolean(INLINE_KEY);
    }

    _partition() {
        if (this.isInline()) {
            return { tray: [], panel: this._liveIndicators() };
        }
        const pinned = this._choices(PANEL_KEY);
        const wide = this._choices(WIDE_KEY);
        const tray = [];
        const panel = [];
        for (const item of this._liveIndicators()) {
            const inTray = item.isIconLike ? !pinned.has(item.name) : wide.has(item.name);
            if (inTray) tray.push(item);
            else panel.push(item);
        }
        return { tray, panel };
    }

    getTrayIndicators() {
        const order = this._settings.get_strv(ORDER_KEY);
        const rank = name => {
            const index = order.indexOf(name);
            return index === -1 ? order.length : index;
        };
        return this._partition().tray.sort((a, b) => rank(a.name) - rank(b.name));
    }

    getPanelIndicators() {
        return this._partition().panel;
    }

    snapshot() {
        const { tray, panel } = this._partition();
        return [...tray.map(item => item.actor), null, ...panel.map(item => item.actor)];
    }

    _setChoices(name, toPanel) {
        const pinned = this._choices(PANEL_KEY);
        const wide = this._choices(WIDE_KEY);
        if (toPanel) {
            pinned.add(name);
            wide.delete(name);
        } else {
            pinned.delete(name);
            wide.add(name);
        }
        this._settings.set_strv(PANEL_KEY, [...pinned]);
        this._settings.set_strv(WIDE_KEY, [...wide]);
        this.onStateChanged();
    }

    moveToPanel(name) {
        this._setChoices(name, true);
    }

    moveToTray(name) {
        this._setChoices(name, false);
    }

    resetToDefaults() {
        this._settings.set_strv(PANEL_KEY, []);
        this._settings.set_strv(WIDE_KEY, []);
        this._settings.set_strv(ORDER_KEY, []);
        this.onStateChanged();
    }

    reorderTrayIndicators(fromIndex, toIndex) {
        const trayItems = this.getTrayIndicators();
        const names = trayItems.filter(item => item.isIconLike).map(item => item.name);
        if (fromIndex < 0 || fromIndex >= names.length || toIndex < 0 || toIndex >= names.length) return;

        const [moved] = names.splice(fromIndex, 1);
        names.splice(toIndex, 0, moved);
        const wideNames = trayItems.filter(item => !item.isIconLike).map(item => item.name);
        this._settings.set_strv(ORDER_KEY, [...names, ...wideNames]);
    }
}