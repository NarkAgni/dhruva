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
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { HomeView } from './HomeView.js';
import { GridReorder } from './GridReorder.js';
import { SearchView } from './SearchView.js';
import { AllAppsView } from './AllAppsView.js';
import { StartMenuData } from './StartMenuData.js';
import { isActorAlive } from '../../core/Utils.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { resolvePopupBubbleColors } from '../dock/DockThemeResolver.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import { hookPopupGap, unhookPopupGap } from '../../core/panel/PopupGap.js';
import {
    vbox, hbox, label, iconButton, button, appIcon, onSecondaryClick, preloadPreviews, CONTENT_WIDTH, EDGE_PADDING,
} from './StartMenuWidgets.js';


const MIN_VIEW_HEIGHT = 300;
const MAX_VIEW_HEIGHT = 620;
const RESERVED_HEIGHT = 300;
const PAUSE_KEY = 'start-menu';
const MENU_RADIUS = 24;
const CONTEXT_MARGIN = 8;
const FOLDER_COLUMNS = 4;
const FOLDER_CELL_WIDTH = 116;
const FOLDER_ICON_SIZE = 48;
const VIEW_TYPES = { home: HomeView, search: SearchView, all: AllAppsView };
const SIDES = { BOTTOM: St.Side.BOTTOM, TOP: St.Side.TOP, LEFT: St.Side.LEFT, RIGHT: St.Side.RIGHT };


export class StartMenu {
    constructor(dockUI) {
        this._dockUI = dockUI;
        this._views = {};
        this._activeView = null;
        this._focusIdleId = 0;
        this._refreshIdleId = 0;
        this._folderKey = null;
        this._folderReorder = null;
        this._forceClose = false;
        this._timers = new TimeoutTracker();

        this.data = new StartMenuData(dockUI.settings, dockUI.appManager);
        this._preloadRecent();
        this.data.ensureIndex();

        this._menu = new PopupMenu.PopupMenu(dockUI.bgActor, 0.5, SIDES[dockUI.dockPosition]);
        this._menu.actor.add_style_class_name('dhruva-start-menu');
        this._menu.box.add_style_class_name('dhruva-start-menu-box');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        const origClose = this._menu.close.bind(this._menu);
        this._menu.close = animate => {
            if (!this._forceClose) {
                if (this._contextLayer && this._contextLayer.visible) {
                    this.hideContextMenu();
                    return;
                }
                if (this._folderLayer && this._folderLayer.visible) {
                    this.hideFolder();
                    return;
                }
            }
            origClose(animate);
        };

        this._manager = new PopupMenu.PopupMenuManager(dockUI.actor);
        this._manager.addMenu(this._menu);

        this._buildContent();
        this._menu.box.add_child(this._root);
        hookPopupGap(dockUI, this._menu);

        this._menu.actor.connectObject('captured-event', (_actor, event) => {
            const type = event.type();
            if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN) {
                return Clutter.EVENT_PROPAGATE;
            }
            const target = global.stage.get_event_actor(event);
            if (this._contextLayer.visible) {
                if (!this._contextBox.contains(target)) {
                    this.hideContextMenu();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
            if (this._folderLayer.visible) {
                if (!this._folderBox.contains(target)) {
                    this.hideFolder();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);

        this._menu.connectObject('open-state-changed', (_menu, isOpen) => {
            if (isOpen) this._onOpened();
            else this._onClosed();
        }, this);

        dockUI.settings.connectObject(
            'changed::start-menu-pinned', () => this._queuePinnedRefresh(),
            'changed::start-menu-folders', () => this._queuePinnedRefresh(),
            this
        );
        Main.overview.connectObject('showing', () => this.close(), this);
    }

    get settings() {
        return this._dockUI.settings;
    }

    toggle() {
        if (this._menu.isOpen) this.close();
        else this.open();
    }

    _queuePinnedRefresh() {
        if (this._refreshIdleId) return;
        this._refreshIdleId = this._timers.addIdle(GLib.PRIORITY_DEFAULT, () => {
            this._refreshIdleId = 0;
            if (this._views.home) this._views.home.refreshPinned();
            if (this._folderKey) this.showFolder(this._folderKey);
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyTheme() {
        const colors = resolvePopupBubbleColors(this._dockUI);
        const strokeWidth = Math.max(1, colors.strokeWidth);
        const background = this._dockUI.settings.get_boolean('blur-enabled') ? '' : `background-color: ${colors.fill};`;
        this._menu.box.set_style(`${background} border: ${colors.strokeWidth}px solid ${colors.stroke}; ` +
            `border-radius: ${MENU_RADIUS}px; padding: ${EDGE_PADDING}px 0 ${EDGE_PADDING}px ${EDGE_PADDING}px;`);
        this._entry.set_style(`background-color: ${colors.fill}; border: 1px solid ${colors.stroke}; border-radius: 999px;`);
        this._folderBox.set_style(`background-color: ${colors.fill}; border: ${strokeWidth}px solid ${colors.stroke}; border-radius: ${MENU_RADIUS}px;`);
        this._contextBox.set_style(`background-color: ${colors.fill}; border: ${strokeWidth}px solid ${colors.stroke};`);
    }

    appMenuItems(app) {
        const items = [{ text: _('Open'), icon: 'media-playback-start-symbolic', run: () => this.launchApp(app) }];
        if (app.can_open_new_window()) items.push({ text: _('New Window'), icon: 'window-new-symbolic', run: () => this.launchApp(app, true) });
        items.push({
            text: this.data.isPinned(app) ? _('Unpin from Start') : _('Pin to Start'),
            icon: 'view-pin-symbolic',
            run: () => this.data.togglePinned(app),
        });

        items.push(this.dockPinItem(app));
        return items;
    }

    dockPinItem(app) {
        const appManager = this._dockUI.appManager;
        const isOnDock = appManager.hasApp(app);
        const labels = this._dockLabels();
        return {
            text: isOnDock ? labels.unpin : labels.pin,
            icon: isOnDock ? 'list-remove-symbolic' : 'list-add-symbolic',
            run: () => {
                if (isOnDock) appManager.removeApp(app);
                else appManager.addApp(app);
                this._dockUI.queueRender('incremental');
            },
        };
    }

    _dockLabels() {
        const settings = this._dockUI.settings;
        if (!settings.get_boolean('hybrid-panel-mode')) return { pin: _('Pin to Dock'), unpin: _('Unpin from Dock') };
        if (settings.get_boolean('dynamic-panel')) return { pin: _('Pin to Dynamic Panel'), unpin: _('Unpin from Dynamic Panel') };
        return { pin: _('Pin to Panel'), unpin: _('Unpin from Panel') };
    }

    fileMenuItems(entry) {
        return [
            { text: _('Open'), icon: 'document-open-symbolic', run: () => this.openFile(entry) },
            { text: _('Show in Files'), icon: 'folder-open-symbolic', run: () => this.showInFiles(entry) },
        ];
    }

    showInFiles(entry) {
        this.close();
        Gio.DBus.session.call(
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1',
            'ShowItems',
            new GLib.Variant('(ass)', [[entry.uri], '']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null
        );
    }

    showContextMenu(items, stageX, stageY) {
        this._contextBox.destroy_all_children();
        for (const item of items) {
            const content = hbox('spacing: 10px;');
            content.add_child(new St.Icon({ icon_name: item.icon, icon_size: 16, y_align: Clutter.ActorAlign.CENTER }));
            content.add_child(new St.Label({ text: item.text, y_align: Clutter.ActorAlign.CENTER }));
            this._contextBox.add_child(button('dhruva-start-context-item', content, () => {
                this.hideContextMenu();
                item.run();
            }, this, { x_expand: true, x_align: Clutter.ActorAlign.FILL }));
        }

        this._contextLayer.show();
        const [, localX, localY] = this._root.transform_stage_point(stageX, stageY);
        const [, width] = this._contextBox.get_preferred_width(-1);
        const [, height] = this._contextBox.get_preferred_height(width);
        const x = Math.min(localX, this._root.width - width - CONTEXT_MARGIN);
        const y = Math.min(localY, this._root.height - height - CONTEXT_MARGIN);
        this._contextBox.set_position(Math.max(CONTEXT_MARGIN, Math.round(x)), Math.max(CONTEXT_MARGIN, Math.round(y)));
    }

    showFolder(key) {
        const item = this.data.pinnedItems().find(entry => entry.key === key);
        if (!item || !item.folder) {
            this.hideFolder();
            return;
        }

        this._folderKey = key;
        this._destroyFolderReorder();
        this._folderBox.destroy_all_children();

        const header = hbox('spacing: 8px;', { x_expand: true });
        header.add_child(new St.Widget({ width: 36 }));
        this._folderTitle = label(item.folder.name, 'dhruva-start-folder-title', { x_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        header.add_child(this._folderTitle);
        header.add_child(item.isStartFolder
            ? iconButton('document-edit-symbolic', _('Rename'), () => this._startRename(item, header), this)
            : new St.Widget({ width: 36 }));
        this._folderBox.add_child(header);

        const order = item.apps.map(app => app.get_id());
        const cells = new Map();
        if (item.isStartFolder) {
            this._folderReorder = new GridReorder({
                order: () => order,
                cell: id => cells.get(id),
                commit: newOrder => this.data.setFolderApps(item.folder.id, newOrder),
            });
        }

        const grid = vbox('spacing: 4px;');
        let row = null;
        item.apps.forEach((app, index) => {
            if (index % FOLDER_COLUMNS === 0) {
                row = hbox('spacing: 4px;');
                grid.add_child(row);
            }
            const cell = this._folderAppCell(app, item);
            cells.set(app.get_id(), cell);
            row.add_child(cell);
        });
        if (this._folderReorder) grid._delegate = this._folderReorder.areaDelegate;
        this._folderBox.add_child(grid);
        this._folderLayer.show();
    }

    _destroyFolderReorder() {
        if (this._folderReorder) this._folderReorder.destroy();
        this._folderReorder = null;
    }

    _folderAppCell(app, item) {
        const icon = appIcon(app, FOLDER_ICON_SIZE);
        const content = vbox('spacing: 8px;', { x_expand: true });
        content.add_child(icon);
        content.add_child(label(app.get_name(), 'dhruva-start-cell-label', { x_align: Clutter.ActorAlign.CENTER }));
        const cell = button('dhruva-start-item', content, () => this.launchApp(app), this, { width: FOLDER_CELL_WIDTH });
        onSecondaryClick(cell, (x, y) => {
            const items = this.appMenuItems(app);
            if (item.isStartFolder) {
                items.push({ text: _('Remove from Folder'), icon: 'list-remove-symbolic', run: () => this.data.removeFromFolder(item.folder.id, app.get_id()) });
            }
            this.showContextMenu(items, x, y);
        }, this);
        if (this._folderReorder) this._folderReorder.makeDraggable(cell, app.get_id(), () => appIcon(app, FOLDER_ICON_SIZE), icon);
        return cell;
    }

    _startRename(item, header) {
        const entry = new St.Entry({
            style_class: 'dhruva-start-rename',
            text: item.folder.name,
            can_focus: true,
            x_expand: true,
        });
        const finish = isSaved => {
            if (!isActorAlive(entry)) return;
            const name = entry.text;
            entry.clutter_text.disconnectObject(this);
            if (isSaved) this.data.renameFolder(item.folder.id, name);
            else this.showFolder(this._folderKey);
        };
        entry.clutter_text.connectObject(
            'activate', () => finish(true),
            'key-focus-out', () => finish(true),
            'key-press-event', (_actor, event) => {
                if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
                finish(false);
                return Clutter.EVENT_STOP;
            },
            this
        );
        header.replace_child(this._folderTitle, entry);
        this._folderTitle = entry;
        entry.grab_key_focus();
        entry.clutter_text.set_selection(0, -1);
    }

    hideFolder() {
        this._folderKey = null;
        this._destroyFolderReorder();
        this._folderLayer.hide();
        this._folderBox.destroy_all_children();
    }

    hideContextMenu() {
        this._contextLayer.hide();
        this._contextBox.destroy_all_children();
    }

    open() {
        if (this._menu.isOpen) return;
        this.data.ensureIndex().then(() => this.refreshSearch());
        this._applyTheme();
        this._viewArea.set_height(this._viewHeight());
        this._entry.text = '';
        this.showHome();
        this._menu.open(false);
    }

    close() {
        if (!this._menu.isOpen) return;
        this._forceClose = true;
        this._menu.close(false);
        this._forceClose = false;
    }

    _preloadRecent() {
        this.data.loadRecentFiles().then(files => preloadPreviews(files.slice(0, this.data.recentFilesCount)));
    }

    _onOpened() {
        if (this._dockUI.autoHideManager) this._dockUI.autoHideManager.show();
        setMagnifierPauseState(this._dockUI.actor, PAUSE_KEY, true);

        if (this._focusIdleId) this._timers.remove(this._focusIdleId);
        this._focusIdleId = this._timers.addIdle(GLib.PRIORITY_DEFAULT, () => {
            this._focusIdleId = 0;
            if (this._menu.isOpen) this._entry.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onClosed() {
        this.hideContextMenu();
        this.hideFolder();
        setMagnifierPauseState(this._dockUI.actor, PAUSE_KEY, false);
        if (this._dockUI.autoHideManager) this._dockUI.autoHideManager.scheduleCheck(100);
        this._destroyViews();
        this._preloadRecent();
    }

    showHome() {
        this._setView('home');
    }

    showAllApps() {
        this._setView('all');
    }

    refreshSearch() {
        if (this._activeView === 'search') this._views.search.setQuery(this._entry.text.trim());
    }

    _setView(name) {
        if (!this._views[name]) {
            this._views[name] = new VIEW_TYPES[name](this);
            this._viewArea.add_child(this._views[name].actor);
        }
        for (const [key, view] of Object.entries(this._views)) view.actor.visible = key === name;
        this._activeView = name;
        this._backButton.visible = name !== 'home';
    }

    _destroyViews() {
        for (const view of Object.values(this._views)) view.destroy();
        this._views = {};
        this._activeView = null;
    }

    _onSearchChanged() {
        const text = this._entry.text.trim();
        if (text) {
            this._setView('search');
            this._views.search.setQuery(text);
        } else if (this._activeView === 'search') {
            this.showHome();
        }
    }

    launchApp(app, newWindow = false) {
        this.close();
        if (newWindow) app.open_new_window(-1);
        else app.activate();
    }

    launchAppId(appId) {
        const app = Shell.AppSystem.get_default().lookup_app(appId);
        if (app) this.launchApp(app);
    }

    launchAppInfo(info) {
        this.close();
        try {
            info.launch([], global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error('[Dhruva] Could not open settings panel:', e.message);
        }
    }

    openFile(entry) {
        this.close();
        Gio.AppInfo.launch_default_for_uri_async(entry.uri, global.create_app_launch_context(0, -1), null, (_source, res) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(res);
            } catch (e) {
                console.error('[Dhruva] Could not open file:', e.message);
            }
        });
    }

    _buildContent() {
        this._entry = new St.Entry({
            style_class: 'dhruva-start-search',
            hint_text: _('Search apps, files and settings'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({ icon_name: 'edit-find-symbolic', style_class: 'dhruva-start-search-icon' }),
        });
        this._entry.clutter_text.connectObject(
            'text-changed', () => this._onSearchChanged(),
            'activate', () => {
                if (this._activeView === 'search') this._views.search.activateFirst();
            },
            'key-press-event', (_actor, event) => {
                if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
                if (this._contextLayer.visible) this.hideContextMenu();
                else if (this._folderLayer.visible) this.hideFolder();
                else if (this._entry.text) this._entry.text = '';
                else this.close();
                return Clutter.EVENT_STOP;
            },
            this
        );

        this._backButton = iconButton('go-previous-symbolic', _('Back'), () => {
            this._entry.text = '';
            this.showHome();
        }, this);

        const searchRow = hbox(`spacing: 10px; margin-right: ${EDGE_PADDING}px;`, { x_expand: true });
        searchRow.add_child(this._backButton);
        searchRow.add_child(this._entry);

        this._viewArea = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });

        this._content = vbox('spacing: 14px;', { x_expand: true, width: CONTENT_WIDTH + EDGE_PADDING });
        this._content.add_child(searchRow);
        this._content.add_child(this._viewArea);

        this._contextBox = vbox('spacing: 2px;', { style_class: 'dhruva-start-context', reactive: true });
        this._contextLayer = new St.Widget({
            reactive: true,
            visible: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._contextLayer.add_child(this._contextBox);

        this._folderBox = vbox('spacing: 12px;', { style_class: 'dhruva-start-folder-popup', reactive: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        this._folderLayer = new St.Widget({
            style_class: 'dhruva-start-folder-layer',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            visible: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._folderLayer.add_child(this._folderBox);
        this._folderLayer.connectObject(
            'button-press-event', (_actor, event) => {
                if (!this._folderBox.contains(event.get_source())) this.hideFolder();
                return Clutter.EVENT_STOP;
            },
            'button-release-event', (_actor, event) => {
                if (!this._folderBox.contains(event.get_source())) this.hideFolder();
                return Clutter.EVENT_STOP;
            },
            this
        );

        this._root = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });
        this._root.add_child(this._content);
        this._root.add_child(this._folderLayer);
        this._root.add_child(this._contextLayer);
    }

    _viewHeight() {
        const current = this._dockUI.monitorManager.getCurrentMonitor();
        const height = current && current.monitor ? current.monitor.height : global.stage.height;
        return Math.max(MIN_VIEW_HEIGHT, Math.min(MAX_VIEW_HEIGHT, height - RESERVED_HEIGHT));
    }

    destroy() {
        this.close();
        this._destroyViews();
        this._timers.destroy();
        this._timers = null;
        this._dockUI.settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._entry.clutter_text.disconnectObject(this);
        this._menu.actor.disconnectObject(this);
        this._menu.disconnectObject(this);
        unhookPopupGap(this._menu);
        this._manager.removeMenu(this._menu);
        this._menu.destroy();
        this._menu = null;
        this.data.destroy();
        this.data = null;
        this._dockUI = null;
    }
}