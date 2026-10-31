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
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { HomeView } from './HomeView.js';
import { BlurPanel } from '../blur/BlurPanel.js';
import { GridReorder } from './GridReorder.js';
import { SearchView } from './SearchView.js';
import { AllAppsView } from './AllAppsView.js';
import { StartMenuData } from './StartMenuData.js';
import { isActorAlive } from '../../core/Utils.js';
import { HYBRID_PANEL_CONFIG } from '../../core/PanelConfig.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import { resolvePopupBubbleColors } from '../dock/DockThemeResolver.js';
import { setMagnifierPauseState } from '../magnifier/MagnifierState.js';
import {
    vbox, hbox, label, iconButton, button, appIcon, onSecondaryClick, preloadPreviews, isKeyboardEvent, CONTENT_WIDTH, EDGE_PADDING,
} from './StartMenuWidgets.js';


const MIN_VIEW_HEIGHT = 300;
const MAX_VIEW_HEIGHT = 620;
const RESERVED_HEIGHT = 300;
const PAUSE_KEY = 'start-menu';
const MENU_RADIUS = 24;
const BLUR_BASE_PAD = 2;
const SCREEN_EDGE_MARGIN = 8;
const CONTEXT_MARGIN = 8;
const FOLDER_COLUMNS = 4;
const FOLDER_CELL_WIDTH = 116;
const FOLDER_ICON_SIZE = 48;
const VIEW_TYPES = { home: HomeView, search: SearchView, all: AllAppsView };
const NAV_DIRECTIONS = new Map([
    [Clutter.KEY_Up, St.DirectionType.UP],
    [Clutter.KEY_Down, St.DirectionType.DOWN],
    [Clutter.KEY_Left, St.DirectionType.LEFT],
    [Clutter.KEY_Right, St.DirectionType.RIGHT],
    [Clutter.KEY_Tab, St.DirectionType.TAB_FORWARD],
    [Clutter.KEY_ISO_Left_Tab, St.DirectionType.TAB_BACKWARD],
]);
const OPEN_MS = 200;
const OPEN_SLIDE = 12;
const OPEN_OFFSETS = { BOTTOM: [0, OPEN_SLIDE], TOP: [0, -OPEN_SLIDE], LEFT: [-OPEN_SLIDE, 0], RIGHT: [OPEN_SLIDE, 0] };
const VIEW_MS = 180;
const VIEW_SLIDE = 24;
const CALCULATOR_PROGRAM = 'gnome-calculator';
const TERMINAL_SCHEMA = 'org.gnome.desktop.default-applications.terminal';
const TERMINALS = [
    ['ptyxis', ['--']],
    ['kgx', ['--']],
    ['gnome-terminal', ['--']],
    ['xdg-terminal-exec', []],
    ['konsole', ['-e']],
    ['xfce4-terminal', ['-x']],
    ['alacritty', ['-e']],
    ['kitty', []],
    ['foot', []],
    ['wezterm', ['start', '--']],
    ['xterm', ['-e']],
    ['x-terminal-emulator', ['-e']],
];


function preferredTerminal() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(TERMINAL_SCHEMA, true);
    if (!schema) return null;
    const exec = new Gio.Settings({ settings_schema: schema }).get_string('exec');
    return TERMINALS.find(([name]) => name === GLib.path_get_basename(exec)) || null;
}


function findTerminal() {
    const preferred = preferredTerminal();
    const candidates = preferred ? [preferred, ...TERMINALS] : TERMINALS;
    const found = candidates.find(([name]) => GLib.find_program_in_path(name));
    return found ? [GLib.find_program_in_path(found[0]), ...found[1]] : null;
}


function containsActor(parent, actor) {
    return Boolean(actor) && parent.contains(actor);
}


function navDirection(event) {
    const symbol = event.get_key_symbol();
    const isShift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
    if (symbol === Clutter.KEY_Tab && isShift) return St.DirectionType.TAB_BACKWARD;
    return NAV_DIRECTIONS.get(symbol);
}


export class StartMenu {
    constructor(dockUI) {
        this._dockUI = dockUI;
        this._views = {};
        this._activeView = null;
        this._focusIdleId = 0;
        this._refreshIdleId = 0;
        this._recoverIdleId = 0;
        this._contextReturnFocus = null;
        this._folderReturnFocus = null;
        this._terminal = undefined;
        this._folderKey = null;
        this._folderReorder = null;
        this._isOpen = false;
        this._grab = null;
        this._blur = null;
        this._timers = new TimeoutTracker();

        this.data = new StartMenuData(dockUI.settings, dockUI.appManager);
        this._preloadRecent();
        this.data.ensureIndex();

        this._overlay = new St.Widget({ style_class: 'dhruva-start-overlay', reactive: true, visible: false });
        this._box = new St.Bin({ style_class: 'dhruva-start-menu-box', reactive: true });
        this._overlay.add_child(this._box);
        Main.uiGroup.add_child(this._overlay);

        this._buildContent();
        this._box.set_child(this._root);
        global.focus_manager.add_group(this._box);
        this._box.connectObject('notify::allocation', () => {
            if (this._isOpen && this._blur) this._blur.syncGeometry();
        }, this);

        this._overlay.connectObject(
            'captured-event', (_actor, event) => this._onOverlayCapturedEvent(event),
            'key-press-event', (_actor, event) => this._onOverlayKeyPress(event),
            this
        );

        dockUI.settings.connectObject(
            'changed::start-menu-pinned', () => this._queuePinnedRefresh(),
            'changed::start-menu-folders', () => this._queuePinnedRefresh(),
            this
        );
        Main.overview.connectObject('showing', () => this.close(), this);
        Main.sessionMode.connectObject('updated', () => this.close(), this);
        global.stage.connectObject('notify::key-focus', () => this._onKeyFocusChanged(), this);
    }

    get isOpen() {
        return this._isOpen;
    }

    get settings() {
        return this._dockUI.settings;
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    _onOverlayCapturedEvent(event) {
        const type = event.type();
        const isPress = type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN;
        const isRelease = type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END;
        if (!isPress && !isRelease) return Clutter.EVENT_PROPAGATE;

        const target = global.stage.get_event_actor(event);
        if (!containsActor(this._box, target)) {
            if (isRelease) this.close();
            return Clutter.EVENT_STOP;
        }

        if (!isPress) return Clutter.EVENT_PROPAGATE;
        if (this._contextLayer.visible && !containsActor(this._contextBox, target)) {
            this.hideContextMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onOverlayKeyPress(event) {
        if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
        if (this._contextLayer.visible) this.hideContextMenu();
        else if (this._folderLayer.visible) this.hideFolder();
        else this.close();
        return Clutter.EVENT_STOP;
    }

    _reposition() {
        const bgActor = this._dockUI.bgActor;
        if (!this._isOpen || !isActorAlive(bgActor) || !isActorAlive(this._box)) return;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [dx, dy] = bgActor.get_transformed_position();
        const [dw, dh] = bgActor.get_transformed_size();
        const [, bw] = this._box.get_preferred_width(-1);
        const [, bh] = this._box.get_preferred_height(bw);
        const gap = HYBRID_PANEL_CONFIG.POPUP_BOX_GAP * scale;
        const margin = SCREEN_EDGE_MARGIN * scale;
        const monitor = Main.layoutManager.findMonitorForActor(bgActor) || Main.layoutManager.primaryMonitor;

        let x = dx + dw / 2 - bw / 2;
        let y = dy + dh / 2 - bh / 2;
        switch (this._dockUI.dockPosition) {
            case 'TOP': y = dy + dh + gap; break;
            case 'LEFT': x = dx + dw + gap; break;
            case 'RIGHT': x = dx - bw - gap; break;
            default: y = dy - bh - gap; break;
        }

        if (monitor) {
            x = Math.min(Math.max(x, monitor.x + margin), monitor.x + monitor.width - margin - bw);
            y = Math.min(Math.max(y, monitor.y + margin), monitor.y + monitor.height - margin - bh);
        }
        this._box.set_position(Math.round(x), Math.round(y));
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
        this._box.set_style(`${background} border: ${colors.strokeWidth}px solid ${colors.stroke}; color: #ffffff; ` +
            `border-radius: ${MENU_RADIUS}px; padding: ${EDGE_PADDING}px 0 ${EDGE_PADDING}px ${EDGE_PADDING}px;`);
        this._entry.set_style(`background-color: ${colors.fill}; border: 1px solid ${colors.stroke}; border-radius: 999px;`);
        this._folderBox.set_style(`background-color: ${colors.fill}; border: ${strokeWidth}px solid ${colors.stroke}; border-radius: ${MENU_RADIUS}px;`);
        this._contextBox.set_style(`background-color: ${colors.fill}; border: ${strokeWidth}px solid ${colors.stroke};`);
    }

    _syncBlur() {
        const isEnabled = this.settings.get_boolean('blur-enabled');
        if (isEnabled && !this._blur) {
            const insets = { top: BLUR_BASE_PAD, bottom: BLUR_BASE_PAD, left: BLUR_BASE_PAD, right: BLUR_BASE_PAD };
            this._blur = new BlurPanel(this._box, this.settings, MENU_RADIUS - BLUR_BASE_PAD, this._box, insets);
        } else if (!isEnabled && this._blur) {
            this._blur.destroy();
            this._blur = null;
        } else if (this._blur) {
            this._blur.syncSettings();
        }
    }

    appMenuItems(app) {
        const items = [{ text: _('Open'), icon: 'media-playback-start-symbolic', run: () => this.launchApp(app) }];
        if (app.can_open_new_window()) items.push({ text: _('New Window'), icon: 'window-new-symbolic', run: () => this.launchApp(app, true) });
        items.push(...this.appActionItems(app));
        items.push({
            text: this.data.isPinned(app) ? _('Unpin from Start') : _('Pin to Start'),
            icon: 'view-pin-symbolic',
            run: () => this.data.togglePinned(app),
        });

        items.push(this.dockPinItem(app));
        return items;
    }

    appActionItems(app) {
        const info = app.get_app_info();
        if (!info) return [];
        return info.list_actions()
            .filter(action => action.replace(/[^a-z]/gi, '').toLowerCase() !== 'newwindow')
            .map(action => ({ text: info.get_action_name(action), icon: 'system-run-symbolic', run: () => this.launchAppAction(app, action) }));
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

        if (isKeyboardEvent()) {
            this._contextReturnFocus = global.stage.key_focus;
            this._contextBox.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
        }
    }

    showFolder(key) {
        const item = this.data.pinnedItems().find(entry => entry.key === key);
        if (!item || !item.folder) {
            this.hideFolder();
            return;
        }

        const focus = global.stage.key_focus;
        const hadFocus = Boolean(focus) && this._folderBox.contains(focus);
        const isFirstShow = !this._folderLayer.visible;
        if (isFirstShow && isKeyboardEvent()) this._folderReturnFocus = focus;

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

        if (hadFocus || (isFirstShow && this._folderReturnFocus)) grid.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
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
        this._restoreFocus(this._folderReturnFocus);
        this._folderReturnFocus = null;
    }

    hideContextMenu() {
        this._contextLayer.hide();
        this._contextBox.destroy_all_children();
        this._restoreFocus(this._contextReturnFocus);
        this._contextReturnFocus = null;
    }

    _restoreFocus(actor) {
        if (actor && isActorAlive(actor) && actor.is_mapped()) actor.grab_key_focus();
    }

    focusSearch() {
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_cursor_position(-1);
    }

    _overlayBox() {
        if (this._contextLayer.visible) return this._contextBox;
        if (this._folderLayer.visible) return this._folderBox;
        return null;
    }

    _isUsable() {
        return this._isOpen && isActorAlive(this._entry) && isActorAlive(this._root);
    }

    _onKeyFocusChanged() {
        if (!this._isUsable()) return;
        const focus = global.stage.key_focus;

        if (!focus || focus === global.stage) {
            if (this._recoverIdleId) return;
            this._recoverIdleId = this._timers.addIdle(GLib.PRIORITY_DEFAULT, () => {
                this._recoverIdleId = 0;
                const current = global.stage.key_focus;
                if (this._isUsable() && this._entry.is_mapped() && (!current || current === global.stage)) this.focusSearch();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        if (!this._root.contains(focus)) return;
        for (let actor = focus.get_parent(); actor && actor !== this._root; actor = actor.get_parent()) {
            if (actor._revealChild) actor._revealChild(focus);
        }
    }

    _onRootKeyPress(event) {
        const overlay = this._overlayBox();
        const direction = navDirection(event);
        if (!overlay || direction === undefined) return Clutter.EVENT_PROPAGATE;

        const focus = global.stage.key_focus;
        const from = focus && overlay.contains(focus) ? focus : null;
        overlay.navigate_focus(from, direction, true);
        return Clutter.EVENT_STOP;
    }

    _animateOpen() {
        const [dx, dy] = OPEN_OFFSETS[this._dockUI.dockPosition];
        this._root.remove_all_transitions();
        this._root.set({ opacity: 0, translation_x: dx, translation_y: dy });
        this._root.ease({ opacity: 255, translation_x: 0, translation_y: 0, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    _animateView(actor, from, to) {
        let slide = 0;
        if (to === 'all') slide = VIEW_SLIDE;
        else if (from === 'all') slide = -VIEW_SLIDE;
        actor.remove_all_transitions();
        actor.set({ opacity: 0, translation_x: slide });
        actor.ease({ opacity: 255, translation_x: 0, duration: VIEW_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
    }

    open() {
        if (this._isOpen || !isActorAlive(this._overlay)) return;

        this._overlay.set_position(0, 0);
        this._overlay.set_size(global.stage.width, global.stage.height);
        Main.uiGroup.set_child_above_sibling(this._overlay, null);
        this._overlay.show();

        this._grab = Main.pushModal(this._overlay, { actionMode: Shell.ActionMode.POPUP });
        this._isOpen = true;

        this.data.ensureIndex().then(() => this.refreshSearch());
        this._applyTheme();
        this._syncBlur();
        this._viewArea.set_height(this._viewHeight());
        this._entry.text = '';
        this.showHome();
        if (this.settings.get_boolean('start-menu-search-providers')) this.data.remoteProviders();

        this._reposition();
        this._dockUI.bgActor.connectObject('notify::allocation', () => this._reposition(), this);
        this._dockUI.actor.connectObject(
            'notify::translation-x', () => this._reposition(),
            'notify::translation-y', () => this._reposition(),
            this
        );

        this._animateOpen();
        this._onOpened();
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (isActorAlive(this._dockUI.bgActor)) this._dockUI.bgActor.disconnectObject(this);
        if (isActorAlive(this._dockUI.actor)) this._dockUI.actor.disconnectObject(this);

        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._root.remove_all_transitions();
        this._overlay.hide();
        this._onClosed();
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
            if (this._isOpen) this._entry.grab_key_focus();
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
        const previous = this._activeView;
        this._activeView = name;
        this._backButton.visible = name !== 'home';
        if (previous && previous !== name) this._animateView(this._views[name].actor, previous, name);
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

    launchAppAction(app, action) {
        this.close();
        app.launch_action(action, global.get_current_time(), -1);
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
        this.openUri(entry.uri);
    }

    openUri(uri) {
        this.close();
        Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, (_source, res) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(res);
            } catch (e) {
                console.error('[Dhruva] Could not open link:', e.message);
            }
        });
    }

    get hasTerminal() {
        if (this._terminal === undefined) this._terminal = findTerminal();
        return this._terminal !== null;
    }

    runCommand(command) {
        this.close();
        Util.trySpawnCommandLine(command);
    }

    runInTerminal(command) {
        this.close();
        const shell = GLib.getenv('SHELL') || '/bin/bash';
        Util.spawn([...this._terminal, shell, '-c', `${command}\nexec ${GLib.shell_quote(shell)}`]);
    }

    get hasCalculator() {
        return Boolean(GLib.find_program_in_path(CALCULATOR_PROGRAM));
    }

    openCalculator(expression) {
        this.close();
        Util.spawn([CALCULATOR_PROGRAM, `--equation=${expression}`]);
    }

    activateRemote(provider, id, terms) {
        this.close();
        provider.activateResult(id, terms);
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
                const symbol = event.get_key_symbol();
                const isEnter = symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter;
                if (isEnter && (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0 && this._activeView === 'search') {
                    this._views.search.activateAlternate();
                    return Clutter.EVENT_STOP;
                }
                if (symbol === Clutter.KEY_Down && !this._overlayBox()) {
                    const view = this._views[this._activeView];
                    if (view) view.focusFirst();
                    return Clutter.EVENT_STOP;
                }
                if (symbol !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
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
                if (!containsActor(this._folderBox, global.stage.get_event_actor(event))) this.hideFolder();
                return Clutter.EVENT_STOP;
            },
            'button-release-event', (_actor, event) => {
                if (!containsActor(this._folderBox, global.stage.get_event_actor(event))) this.hideFolder();
                return Clutter.EVENT_STOP;
            },
            this
        );

        this._root = new St.Widget({ layout_manager: new Clutter.BinLayout(), x_expand: true });
        this._root.add_child(this._content);
        this._root.add_child(this._folderLayer);
        this._root.add_child(this._contextLayer);
        this._root.connectObject('key-press-event', (_actor, event) => this._onRootKeyPress(event), this);
    }

    _viewHeight() {
        const current = this._dockUI.monitorManager.getCurrentMonitor();
        const height = current && current.monitor ? current.monitor.height : global.stage.height;
        return Math.max(MIN_VIEW_HEIGHT, Math.min(MAX_VIEW_HEIGHT, height - RESERVED_HEIGHT));
    }

    destroy() {
        global.stage.disconnectObject(this);
        this.close();
        this._timers.destroy();
        this._timers = null;
        this._destroyViews();
        this._dockUI.settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        this._root.disconnectObject(this);
        this._entry.clutter_text.disconnectObject(this);
        if (this._blur) {
            this._blur.destroy();
            this._blur = null;
        }
        global.focus_manager.remove_group(this._box);
        this._box.disconnectObject(this);
        this._overlay.disconnectObject(this);
        this._overlay.destroy();
        this._overlay = null;
        this._box = null;
        this.data.destroy();
        this.data = null;
        this._dockUI = null;
    }
}