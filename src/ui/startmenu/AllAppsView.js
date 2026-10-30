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
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { isActorAlive } from '../../core/Utils.js';
import { vbox, hbox, label, button, iconButton, appIcon, rowContent, onSecondaryClick, CONTENT_WIDTH, EDGE_PADDING } from './StartMenuWidgets.js';


const ROW_ICON_SIZE = 32;
const OTHER_KEY = '#';
const RAIL_KEYS = [OTHER_KEY, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const SCROLL_MS = 220;
const GRID_KEY = 'start-menu-all-apps-grid';
const GRID_COLUMNS = 6;
const GRID_SPACING = 2;
const GRID_ICON_SIZE = 44;
const RAIL_RESERVE = 40;
const GRID_CELL_WIDTH = Math.floor((CONTENT_WIDTH - RAIL_RESERVE - GRID_SPACING * (GRID_COLUMNS - 1)) / GRID_COLUMNS);


function groupKey(name) {
    const first = name.charAt(0).toUpperCase();
    return RAIL_KEYS.includes(first) ? first : OTHER_KEY;
}


export class AllAppsView {
    constructor(menu) {
        this._menu = menu;
        this._headers = new Map();
        this._railKeys = new Map();
        this._activeKey = null;

        this.actor = vbox(`spacing: 12px; margin-right: ${EDGE_PADDING}px;`, { x_expand: true, y_expand: true });

        this._settings = menu.settings;
        this._isGrid = this._settings.get_boolean(GRID_KEY);

        const header = hbox('spacing: 8px; padding: 0 4px;', { x_expand: true });
        header.add_child(label(_('All apps'), 'dhruva-start-title', { x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        this._viewToggle = iconButton('', _('Switch between list and grid'), () => this._toggleLayout(), this);
        header.add_child(this._viewToggle);
        this.actor.add_child(header);

        const body = hbox('spacing: 8px;', { x_expand: true, y_expand: true });
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            style: '-st-vfade-offset: 24px;',
        });
        this._list = vbox('spacing: 2px;', { x_expand: true });
        this._scroll.set_child(this._list);
        body.add_child(this._scroll);
        this._populate();
        body.add_child(this._buildRail());
        this.actor.add_child(body);

        this._adjustment().connectObject(
            'notify::value', () => this._syncActiveKey(),
            'notify::page-size', () => this._syncActiveKey(),
            this
        );
        this._syncActiveKey();
    }

    _syncActiveKey() {
        const adjustment = this._adjustment();
        const bottom = adjustment.value + adjustment.page_size;
        let active = this._headers.keys().next().value;
        for (const [key, heading] of this._headers) {
            if (heading.y + heading.height > bottom) break;
            active = key;
        }
        if (active === this._activeKey) return;

        if (this._activeKey) this._railKeys.get(this._activeKey).checked = false;
        this._activeKey = active;
        if (active) this._railKeys.get(active).checked = true;
    }

    _toggleLayout() {
        this._isGrid = !this._isGrid;
        this._settings.set_boolean(GRID_KEY, this._isGrid);
        this._populate();
        this._adjustment().value = 0;
        this._activeKey = null;
        this._syncActiveKey();
    }

    _groups() {
        const groups = new Map();
        for (const app of this._menu.data.installedApps()) {
            const key = groupKey(app.get_name());
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(app);
        }
        return groups;
    }

    _populate() {
        this._list.destroy_all_children();
        this._headers.clear();
        this._viewToggle.child.icon_name = this._isGrid ? 'view-list-symbolic' : 'view-grid-symbolic';

        for (const [key, apps] of this._groups()) {
            const heading = label(key, 'dhruva-start-letter', { x_align: Clutter.ActorAlign.START });
            this._headers.set(key, heading);
            this._list.add_child(heading);
            if (this._isGrid) this._addGrid(apps);
            else apps.forEach(app => this._list.add_child(this._row(app)));
        }
    }

    _row(app) {
        const content = rowContent();
        content.add_child(appIcon(app, ROW_ICON_SIZE));
        content.add_child(label(app.get_name(), 'dhruva-start-app-name', { y_align: Clutter.ActorAlign.CENTER }));
        return this._withMenu(button('dhruva-start-row', content, () => this._menu.launchApp(app), this, { x_expand: true, x_align: Clutter.ActorAlign.FILL }), app);
    }

    _withMenu(actor, app) {
        onSecondaryClick(actor, (x, y) => this._menu.showContextMenu(this._menu.appMenuItems(app), x, y), this);
        return actor;
    }

    _addGrid(apps) {
        let row = null;
        apps.forEach((app, index) => {
            if (index % GRID_COLUMNS === 0) {
                row = hbox(`spacing: ${GRID_SPACING}px;`);
                this._list.add_child(row);
            }
            const content = vbox('spacing: 8px;', { x_expand: true });
            content.add_child(appIcon(app, GRID_ICON_SIZE));
            content.add_child(label(app.get_name(), 'dhruva-start-cell-label', { x_align: Clutter.ActorAlign.CENTER }));
            row.add_child(this._withMenu(button('dhruva-start-item', content, () => this._menu.launchApp(app), this, { width: GRID_CELL_WIDTH }), app));
        });
    }

    _buildRail() {
        const rail = vbox('spacing: 0;', { style_class: 'dhruva-start-rail', y_expand: true });
        RAIL_KEYS.forEach(key => {
            const hasApps = this._headers.has(key);
            const railKey = button('dhruva-start-rail-key', new St.Label({ text: key }), () => this._scrollTo(key), this, {
                reactive: hasApps,
                opacity: hasApps ? 255 : 90,
                y_expand: true,
            });
            this._railKeys.set(key, railKey);
            rail.add_child(railKey);
        });
        return rail;
    }

    _adjustment() {
        return this._scroll.vadjustment ? this._scroll.vadjustment : this._scroll.vscroll.adjustment;
    }

    _scrollTo(key) {
        const heading = this._headers.get(key);
        const adjustment = this._adjustment();
        const value = Math.min(heading.y, adjustment.upper - adjustment.page_size);
        adjustment.ease(value, { duration: SCROLL_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    destroy() {
        if (this._scroll) this._adjustment().disconnectObject(this);
        this._headers.clear();
        this._railKeys.clear();
        if (isActorAlive(this.actor)) this.actor.destroy();
        this.actor = null;
    }
}