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
import {
    vbox, hbox, label, button, pillButton, sectionHeader, appIcon, thumbnail, prettyLocation, rowContent,
    onSecondaryClick, edgeScrollView, AutoHideScrollbar,
} from './StartMenuWidgets.js';


const ROW_ICON_SIZE = 32;
const BEST_ICON_SIZE = 64;
const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 44;


export class SearchView {
    constructor(menu) {
        this._menu = menu;
        this._firstAction = null;
        this._query = '';
        this._indexedHits = [];

        this._results = vbox('spacing: 14px;', { x_expand: true });
        this.actor = edgeScrollView(this._results);
        this._scrollbar = new AutoHideScrollbar(this.actor);
    }

    setQuery(text) {
        this._query = text;
        this._indexedHits = [];
        this._render();
        this._menu.data.searchIndexedFiles(text).then(hits => {
            if (this._query !== text || !isActorAlive(this.actor) || hits.length === 0) return;
            this._indexedHits = hits;
            this._render();
        });
    }

    _render() {
        const text = this._query;
        const query = text.toLowerCase();
        const data = this._menu.data;
        const apps = data.searchApps(query);
        const files = data.searchFiles(text, this._indexedHits);
        const panels = data.searchSettings(query);

        this._results.destroy_all_children();
        this._firstAction = null;

        if (apps.length > 0) {
            this._results.add_child(this._bestMatch(apps[0]));
            this._results.add_child(this._group(_('Apps'), apps.map(app => this._row(
                appIcon(app, ROW_ICON_SIZE), app.get_name(), _('App'), () => this._menu.launchApp(app), () => this._menu.appMenuItems(app)))));
        }
        if (files.length > 0) {
            this._results.add_child(this._group(_('Files'), files.map(entry => this._row(
                thumbnail(entry, THUMB_WIDTH, THUMB_HEIGHT, 8), entry.name, prettyLocation(entry.location), () => this._menu.openFile(entry),
                () => this._menu.fileMenuItems(entry)))));
        }
        if (panels.length > 0) {
            this._results.add_child(this._group(_('Settings'), panels.map(info => this._row(
                new St.Icon({ gicon: info.get_icon(), icon_size: ROW_ICON_SIZE }), info.get_name(), info.get_description() || _('Settings'),
                () => this._menu.launchAppInfo(info)))));
        }
        if (!this._firstAction) {
            this._results.add_child(label(_('No results for “%s”').format(text), 'dhruva-start-empty', { x_align: Clutter.ActorAlign.CENTER }));
        }
    }

    activateFirst() {
        if (this._firstAction) this._firstAction();
    }

    _remember(action) {
        if (!this._firstAction) this._firstAction = action;
        return action;
    }

    _bestMatch(app) {
        const open = this._remember(() => this._menu.launchApp(app));
        const actions = hbox('spacing: 8px;');
        actions.add_child(button('dhruva-start-pill dhruva-start-primary', new St.Label({ text: _('Open') }), open, this));
        if (app.can_open_new_window()) {
            actions.add_child(pillButton(_('New Window'), 'window-new-symbolic', () => this._menu.launchApp(app, true), this));
        }
        const isPinned = this._menu.data.isPinned(app);
        actions.add_child(pillButton(isPinned ? _('Unpin from Start') : _('Pin to Start'), 'view-pin-symbolic', () => {
            this._menu.data.togglePinned(app);
            this._menu.refreshSearch();
        }, this));
        const dockPin = this._menu.dockPinItem(app);
        actions.add_child(pillButton(dockPin.text, dockPin.icon, () => {
            dockPin.run();
            this._menu.refreshSearch();
        }, this));

        const text = vbox('spacing: 10px;', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        const heading = vbox('spacing: 2px;');
        heading.add_child(label(_('Best match · App'), 'dhruva-start-meta'));
        heading.add_child(label(app.get_name(), 'dhruva-start-best-title'));
        text.add_child(heading);
        text.add_child(actions);

        const card = hbox('spacing: 16px; padding: 16px;', { style_class: 'dhruva-start-best' });
        card.add_child(appIcon(app, BEST_ICON_SIZE));
        card.add_child(text);
        return card;
    }

    _group(title, rows) {
        const group = vbox('spacing: 2px;');
        group.add_child(sectionHeader(title));
        rows.forEach(row => group.add_child(row));
        return group;
    }

    _row(icon, title, subtitle, onClick, menuItems = null) {
        this._remember(onClick);
        const text = vbox('spacing: 2px;', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        text.add_child(label(title, 'dhruva-start-title'));
        text.add_child(label(subtitle, 'dhruva-start-meta'));

        const content = rowContent();
        content.add_child(icon);
        content.add_child(text);
        const row = button('dhruva-start-row', content, onClick, this, { x_expand: true, x_align: Clutter.ActorAlign.FILL });
        if (menuItems) onSecondaryClick(row, (x, y) => this._menu.showContextMenu(menuItems(), x, y), this);
        return row;
    }

    destroy() {
        this._scrollbar.destroy();
        if (isActorAlive(this.actor)) this.actor.destroy();
        this.actor = null;
    }
}