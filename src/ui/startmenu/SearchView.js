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
import Clutter from 'gi://Clutter';
import { gettext as _, ngettext } from 'resource:///org/gnome/shell/extensions/extension.js';

import { evaluate } from './Calculator.js';
import { isActorAlive } from '../../core/Utils.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import {
    vbox, hbox, label, button, pillButton, sectionHeader, appIcon, thumbnail, prettyLocation, rowContent,
    highlightedLabel, onSecondaryClick, edgeScrollView, AutoHideScrollbar,
} from './StartMenuWidgets.js';


const ROW_ICON_SIZE = 32;
const BEST_ICON_SIZE = 64;
const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 44;
const GROUP_PREVIEW = 4;
const BEST_TASKS = 3;
const REMOTE_DELAY_MS = 150;
const COMMAND_PREFIX = '>';
const CALCULATOR_PROVIDER = 'org.gnome.Calculator.desktop';
const PROVIDERS_KEY = 'start-menu-search-providers';
const WEB_SEARCH_KEY = 'start-menu-web-search';


function searchTerms(text) {
    return text.split(/\s+/).filter(term => term.length > 0);
}


export class SearchView {
    constructor(menu) {
        this._menu = menu;
        this._firstAction = null;
        this._alternateAction = null;
        this._query = '';
        this._indexedHits = [];
        this._remoteGroups = [];
        this._calcResult = null;
        this._expanded = new Set();
        this._focusables = [];
        this._timers = new TimeoutTracker();
        this._remoteId = 0;
        this._remoteCancellable = null;

        this._results = vbox('spacing: 14px;', { x_expand: true });
        this.actor = edgeScrollView(this._results);
        this._scrollbar = new AutoHideScrollbar(this.actor);
    }

    setQuery(text) {
        if (text !== this._query) this._expanded.clear();
        this._query = text;
        this._indexedHits = [];
        this._remoteGroups = [];
        this._calcResult = this._isCommand() ? null : evaluate(text);
        this._render();
        this._queueRemote();

        if (this._isCommand()) return;
        this._menu.data.searchIndexedFiles(text).then(hits => {
            if (this._query !== text || !isActorAlive(this.actor) || hits.length === 0) return;
            this._indexedHits = hits;
            this._render();
        });
    }

    focusFirst() {
        const first = this._focusables[0];
        if (first) first.grab_key_focus();
    }

    _isCommand() {
        return this._query.startsWith(COMMAND_PREFIX);
    }

    _cancelRemote() {
        if (this._remoteId) this._timers.remove(this._remoteId);
        this._remoteId = 0;
        if (this._remoteCancellable) this._remoteCancellable.cancel();
        this._remoteCancellable = null;
    }

    _queueRemote() {
        this._cancelRemote();
        if (this._isCommand() || !this._menu.settings.get_boolean(PROVIDERS_KEY)) return;

        const text = this._query;
        this._remoteId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, REMOTE_DELAY_MS, () => {
            this._remoteId = 0;
            const cancellable = new Gio.Cancellable();
            this._remoteCancellable = cancellable;
            const skipped = this._calcResult ? [CALCULATOR_PROVIDER] : [];
            this._menu.data.searchRemote(searchTerms(text), skipped, cancellable).then(groups => {
                if (cancellable.is_cancelled() || this._query !== text || !isActorAlive(this.actor) || groups.length === 0) return;
                this._remoteGroups = groups;
                this._render();
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        const focus = global.stage.key_focus;
        const focusIndex = focus ? this._focusables.indexOf(focus) : -1;

        this._results.destroy_all_children();
        this._firstAction = null;
        this._alternateAction = null;
        this._focusables = [];

        if (this._isCommand()) this._renderCommand(this._query.slice(COMMAND_PREFIX.length).trim());
        else this._renderResults();

        if (focusIndex >= 0) {
            const target = this._focusables[Math.min(focusIndex, this._focusables.length - 1)];
            if (target) target.grab_key_focus();
            else this._menu.focusSearch();
        }
    }

    _renderCommand(command) {
        if (!command) {
            this._results.add_child(label(_('Type a command to run'), 'dhruva-start-empty', { x_align: Clutter.ActorAlign.CENTER }));
            return;
        }
        const group = vbox('spacing: 2px;');
        group.add_child(sectionHeader(_('Command')));
        if (this._menu.hasTerminal) {
            group.add_child(this._row(
                new St.Icon({ icon_name: 'utilities-terminal-symbolic', icon_size: ROW_ICON_SIZE }), command, _('Run in Terminal · Enter'),
                () => this._menu.runInTerminal(command), null, false));
        }
        const runInBackground = () => this._menu.runCommand(command);
        this._alternateAction = runInBackground;
        group.add_child(this._row(
            new St.Icon({ icon_name: 'system-run-symbolic', icon_size: ROW_ICON_SIZE }), command,
            this._menu.hasTerminal ? _('Run in Background · Ctrl+Enter') : _('Run in Background · Enter'),
            runInBackground, null, false));
        this._results.add_child(group);
    }

    _renderResults() {
        const text = this._query;
        const query = text.toLowerCase();
        const data = this._menu.data;
        const apps = data.searchApps(query);
        const files = data.searchFiles(text, this._indexedHits);
        const panels = data.searchSettings(query);

        if (this._calcResult !== null) this._results.add_child(this._calculatorCard(this._calcResult));

        if (apps.length > 0) {
            this._results.add_child(this._bestMatch(apps[0]));
            this._addGroup('apps', _('Apps'), apps, app => this._row(
                appIcon(app, ROW_ICON_SIZE), app.get_name(), _('App'), () => this._menu.launchApp(app), () => this._menu.appMenuItems(app)));
        }
        if (files.length > 0) {
            this._addGroup('files', _('Files'), files, entry => this._row(
                thumbnail(entry, THUMB_WIDTH, THUMB_HEIGHT, 8), entry.name, prettyLocation(entry.location), () => this._menu.openFile(entry),
                () => this._menu.fileMenuItems(entry)));
        }
        if (panels.length > 0) {
            this._addGroup('settings', _('Settings'), panels, info => this._row(
                new St.Icon({ gicon: info.get_icon(), icon_size: ROW_ICON_SIZE }), info.get_name(), info.get_description() || _('Settings'),
                () => this._menu.launchAppInfo(info)));
        }
        for (const { provider, metas } of this._remoteGroups) {
            const appInfo = provider.appInfo;
            this._addGroup(`remote:${appInfo.get_id()}`, appInfo.get_name(), metas, meta => this._row(
                meta.createIcon(ROW_ICON_SIZE) || new St.Icon({ gicon: appInfo.get_icon(), icon_size: ROW_ICON_SIZE }),
                meta.name, meta.description || appInfo.get_name(), () => this._menu.activateRemote(provider, meta.id, searchTerms(text))));
        }
        if (this._menu.settings.get_boolean(WEB_SEARCH_KEY)) this._results.add_child(this._webSearchGroup(text));
        if (!this._firstAction) {
            this._results.add_child(label(_('No results for “%s”').format(text), 'dhruva-start-empty', { x_align: Clutter.ActorAlign.CENTER }));
        }
    }

    _webSearchGroup(text) {
        const data = this._menu.data;
        const engine = data.webSearchEngine();
        const browser = data.webBrowser();
        const icon = browser
            ? new St.Icon({ gicon: browser.get_icon(), icon_size: ROW_ICON_SIZE })
            : new St.Icon({ icon_name: 'web-browser-symbolic', icon_size: ROW_ICON_SIZE });
        const title = engine ? _('Search %s for “%s”').format(engine, text) : _('Search the web for “%s”').format(text);
        const subtitle = browser ? _('Opens in %s').format(browser.get_display_name()) : _('Opens in your browser');

        const group = vbox('spacing: 2px;');
        group.add_child(sectionHeader(_('Web')));
        group.add_child(this._row(icon, title, subtitle, () => this._menu.openUri(data.webSearchUri(text)), null, false));
        return group;
    }

    activateFirst() {
        if (this._firstAction) this._firstAction();
    }

    activateAlternate() {
        if (this._alternateAction) this._alternateAction();
        else this.activateFirst();
    }

    _remember(action) {
        if (!this._firstAction) this._firstAction = action;
        return action;
    }

    _track(actor) {
        this._focusables.push(actor);
        return actor;
    }

    _calculatorCard(result) {
        const expression = this._query.replace(/^=/, '');
        const text = vbox('spacing: 10px;', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        const heading = vbox('spacing: 2px;');
        heading.add_child(label(`${_('Calculator')} · ${expression} =`, 'dhruva-start-meta'));
        heading.add_child(label(result, 'dhruva-start-best-title'));
        text.add_child(heading);

        if (this._menu.hasCalculator) {
            const open = this._remember(() => this._menu.openCalculator(expression));
            const actions = hbox('spacing: 8px;');
            actions.add_child(this._track(button('dhruva-start-pill dhruva-start-primary', new St.Label({ text: _('Open in Calculator') }), open, this)));
            text.add_child(actions);
        }

        const card = hbox('spacing: 16px; padding: 16px;', { style_class: 'dhruva-start-best' });
        card.add_child(new St.Icon({ icon_name: 'accessories-calculator-symbolic', icon_size: BEST_ICON_SIZE, y_align: Clutter.ActorAlign.CENTER }));
        card.add_child(text);
        return card;
    }

    _bestMatch(app) {
        const open = this._remember(() => this._menu.launchApp(app));
        const actions = hbox('spacing: 8px;');
        actions.add_child(this._track(button('dhruva-start-pill dhruva-start-primary', new St.Label({ text: _('Open') }), open, this)));
        if (app.can_open_new_window()) {
            actions.add_child(this._track(pillButton(_('New Window'), 'window-new-symbolic', () => this._menu.launchApp(app, true), this)));
        }
        const isPinned = this._menu.data.isPinned(app);
        actions.add_child(this._track(pillButton(isPinned ? _('Unpin from Start') : _('Pin to Start'), 'view-pin-symbolic', () => {
            this._menu.data.togglePinned(app);
            this._menu.refreshSearch();
        }, this)));
        const dockPin = this._menu.dockPinItem(app);
        actions.add_child(this._track(pillButton(dockPin.text, dockPin.icon, () => {
            dockPin.run();
            this._menu.refreshSearch();
        }, this)));

        const text = vbox('spacing: 10px;', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        const heading = vbox('spacing: 2px;');
        heading.add_child(label(_('Best match · App'), 'dhruva-start-meta'));
        heading.add_child(highlightedLabel(app.get_name(), this._query, 'dhruva-start-best-title'));
        text.add_child(heading);
        text.add_child(actions);

        const tasks = this._menu.appActionItems(app).slice(0, BEST_TASKS);
        if (tasks.length > 0) {
            const taskRow = hbox('spacing: 8px;');
            tasks.forEach(task => taskRow.add_child(this._track(pillButton(task.text, task.icon, task.run, this))));
            text.add_child(taskRow);
        }

        const card = hbox('spacing: 16px; padding: 16px;', { style_class: 'dhruva-start-best' });
        card.add_child(appIcon(app, BEST_ICON_SIZE));
        card.add_child(text);
        return card;
    }

    _addGroup(id, title, items, makeRow) {
        const shown = this._expanded.has(id) ? items : items.slice(0, GROUP_PREVIEW);
        const group = vbox('spacing: 2px;');
        group.add_child(sectionHeader(title));
        shown.forEach(item => group.add_child(makeRow(item)));

        const hidden = items.length - shown.length;
        if (hidden > 0) group.add_child(this._moreRow(id, hidden));
        this._results.add_child(group);
    }

    _moreRow(id, count) {
        const content = rowContent();
        content.add_child(new St.Icon({ icon_name: 'pan-down-symbolic', icon_size: 16, y_align: Clutter.ActorAlign.CENTER }));
        content.add_child(label(ngettext('Show %d more', 'Show %d more', count).format(count), 'dhruva-start-meta', { y_align: Clutter.ActorAlign.CENTER }));
        return this._track(button('dhruva-start-row dhruva-start-more', content, () => {
            this._expanded.add(id);
            this._render();
        }, this, { x_expand: true, x_align: Clutter.ActorAlign.FILL }));
    }

    _row(icon, title, subtitle, onClick, menuItems = null, isHighlighted = true) {
        this._remember(onClick);
        const text = vbox('spacing: 2px;', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        text.add_child(isHighlighted ? highlightedLabel(title, this._query, 'dhruva-start-title') : label(title, 'dhruva-start-title'));
        text.add_child(label(subtitle, 'dhruva-start-meta'));

        const content = rowContent();
        content.add_child(icon);
        content.add_child(text);
        const row = button('dhruva-start-row', content, onClick, this, { x_expand: true, x_align: Clutter.ActorAlign.FILL });
        if (menuItems) onSecondaryClick(row, (x, y) => this._menu.showContextMenu(menuItems(), x, y), this);
        return this._track(row);
    }

    destroy() {
        this._cancelRemote();
        this._timers.destroy();
        this._timers = null;
        this._scrollbar.destroy();
        this._focusables = [];
        this._remoteGroups = [];
        if (isActorAlive(this.actor)) this.actor.destroy();
        this.actor = null;
    }
}