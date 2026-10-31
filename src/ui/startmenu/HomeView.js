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
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import AccountsService from 'gi://AccountsService';
import * as UserWidget from 'resource:///org/gnome/shell/ui/userWidget.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { gettext as _, ngettext } from 'resource:///org/gnome/shell/extensions/extension.js';

import { GridReorder } from './GridReorder.js';
import { isActorAlive } from '../../core/Utils.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';
import {
    vbox, hbox, label, button, iconButton, pillButton, sectionHeader,
    appIcon, folderIcon, thumbnail, relativeTime, fitWidth, isKeyboardEvent,
    onSecondaryClick, edgeScrollView, horizontalScroller, AutoHideScrollbar, CONTENT_WIDTH, EDGE_PADDING,
} from './StartMenuWidgets.js';


const COLUMNS = 6;
const PINNED_SPACING = 2;
const CARD_SPACING = 10;
const PINNED_ROWS = 2;
const PAGE_SIZE = COLUMNS * PINNED_ROWS;
const PAGE_MS = 250;
const PAGE_EDGE = 24;
const PAGE_DWELL_MS = 450;
const WHEEL_COOLDOWN_MS = 300;
const RECENT_APPS = 6;
const CONTINUE_VISIBLE = 5;
const ICON_SIZE = 44;
const CELL_WIDTH = fitWidth(COLUMNS, PINNED_SPACING);
const CARD_WIDTH = fitWidth(RECENT_APPS, CARD_SPACING);
const FILE_CARD_WIDTH = fitWidth(CONTINUE_VISIBLE, CARD_SPACING);
const THUMB_HEIGHT = 88;
const SETTINGS_APP_ID = 'org.gnome.Settings.desktop';


export class HomeView {
    constructor(menu) {
        this._menu = menu;
        this._cells = new Map();
        this._order = [];
        this._items = new Map();
        this._pageBoxes = [];
        this._dotButtons = [];
        this._page = 0;
        this._lastFlip = 0;
        this._wheelDelta = 0;
        this._dwellId = 0;
        this._dwellStep = 0;
        this._timers = new TimeoutTracker();
        this._reorder = new GridReorder({
            order: () => this._order,
            cell: key => this._cells.get(key),
            commit: order => this._menu.data.setPinnedOrder(order),
            canGroup: (sourceKey, targetKey) => this._canGroup(sourceKey, targetKey),
            group: (sourceKey, targetKey) => this._group(sourceKey, targetKey),
            motion: (x, y) => this._onDragMotion(x, y),
            end: () => this._cancelDwell(),
        });
        this._systemActions = SystemActions.getDefault();

        this.actor = vbox('spacing: 14px;', { x_expand: true, y_expand: true });

        this._content = vbox('spacing: 16px;', { x_expand: true });
        const scroll = edgeScrollView(this._content);
        this._scrollbar = new AutoHideScrollbar(scroll);
        this.actor.add_child(scroll);

        this._pinnedSection = vbox('spacing: 4px;');
        this._recentAppsSection = vbox('spacing: 6px;');
        this._continueSection = vbox('spacing: 6px;', { visible: false });
        this._content.add_child(this._pinnedSection);
        this._content.add_child(this._recentAppsSection);
        this._content.add_child(this._continueSection);

        this._sessionRow = hbox(`spacing: 8px; margin-right: ${EDGE_PADDING}px;`, { visible: false, x_align: Clutter.ActorAlign.END });
        this.actor.add_child(this._sessionRow);
        this.actor.add_child(this._buildFooter());

        this.refreshPinned();
        const settings = this._menu.settings;
        if (settings.get_boolean('start-menu-recent-apps')) this._buildRecentApps();
        else this._recentAppsSection.visible = false;
        if (settings.get_boolean('start-menu-continue')) this._loadContinue();
    }

    refreshPinned() {
        this._pinnedSection.destroy_all_children();
        this._cells = new Map();

        const items = this._menu.data.pinnedItems();
        this._items = new Map(items.map(item => [item.key, item]));
        this._order = items.map(item => item.key);
        this._pinnedSection.add_child(sectionHeader(_('Pinned'), pillButton(_('All apps'), 'go-next-symbolic', () => this._menu.showAllApps(), this, true)));

        items.forEach(item => this._cells.set(item.key, item.folder ? this._folderCell(item) : this._appCell(item)));

        this._pages = hbox('spacing: 0;', { x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START });
        this._pager = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            reactive: true,
            width: CONTENT_WIDTH,
        });
        this._pager.add_child(this._pages);
        this._pager._revealChild = actor => this._showPageOf(actor);
        this._pager.connectObject('scroll-event', (_actor, event) => this._onPagerScroll(event), this);

        this._dots = hbox('spacing: 6px; padding-top: 4px;', { x_align: Clutter.ActorAlign.CENTER });
        this._layoutGrid();

        this._pinnedSection.add_child(this._pager);
        this._pinnedSection.add_child(this._dots);
        this._pinnedSection._delegate = this._reorder.areaDelegate;
    }

    _layoutGrid() {
        this._pageBoxes = [];
        const pageCount = Math.max(1, Math.ceil(this._order.length / PAGE_SIZE));
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
            const page = vbox(`spacing: ${PINNED_SPACING}px;`, { width: CONTENT_WIDTH });
            const keys = this._order.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
            for (let start = 0; start < keys.length; start += COLUMNS) {
                const row = hbox(`spacing: ${PINNED_SPACING}px;`);
                keys.slice(start, start + COLUMNS).forEach(key => row.add_child(this._cells.get(key)));
                page.add_child(row);
            }
            this._pages.add_child(page);
            this._pageBoxes.push(page);
        }

        this._page = Math.min(this._page, pageCount - 1);
        this._pages.translation_x = -this._page * CONTENT_WIDTH;
        this._buildDots();
    }

    _buildDots() {
        this._dots.destroy_all_children();
        this._dots.visible = this._pageBoxes.length > 1;
        this._dotButtons = this._pageBoxes.map((_page, index) => {
            const dot = new St.Button({
                style_class: 'dhruva-start-page-dot',
                can_focus: false,
                accessible_name: _('Page %d').format(index + 1),
                y_align: Clutter.ActorAlign.CENTER,
            });
            dot.connectObject('clicked', () => this._setPage(index), this);
            this._dots.add_child(dot);
            return dot;
        });
        this._syncDots();
    }

    _syncDots() {
        this._dotButtons.forEach((dot, index) => {
            dot.checked = index === this._page;
        });
    }

    _setPage(index) {
        const page = Math.max(0, Math.min(this._pageBoxes.length - 1, index));
        if (page === this._page) return false;

        const shift = (page - this._page) * CONTENT_WIDTH;
        this._page = page;
        this._pages.remove_transition('translation-x');
        this._pages.ease({ translation_x: -page * CONTENT_WIDTH, duration: PAGE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        this._syncDots();
        this._reorder.shiftSlots(-shift, 0);
        return true;
    }

    _showPageOf(actor) {
        const index = this._pageBoxes.findIndex(page => page.contains(actor));
        if (index >= 0) this._setPage(index);
    }

    _onPagerScroll(event) {
        if (this._pageBoxes.length < 2) return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();
        let step = 0;
        if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) step = -1;
        else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) step = 1;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            this._wheelDelta += Math.abs(dx) > Math.abs(dy) ? dx : dy;
            const pending = Math.sign(this._wheelDelta);
            if (pending === 0) return Clutter.EVENT_STOP;
            if (!this._canMove(pending)) {
                this._wheelDelta = 0;
                return Clutter.EVENT_PROPAGATE;
            }
            if (Math.abs(this._wheelDelta) < 1) return Clutter.EVENT_STOP;
            step = pending;
            this._wheelDelta = 0;
        }

        if (step === 0 || !this._canMove(step)) return Clutter.EVENT_PROPAGATE;

        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastFlip < WHEEL_COOLDOWN_MS) return Clutter.EVENT_STOP;
        if (this._setPage(this._page + step)) this._lastFlip = now;
        return Clutter.EVENT_STOP;
    }

    _canMove(step) {
        const target = this._page + step;
        return target >= 0 && target < this._pageBoxes.length;
    }

    _onDragMotion(x, y) {
        let step = 0;
        if (this._pageBoxes.length > 1) {
            const [pagerX, pagerY] = this._pager.get_transformed_position();
            const [width, height] = this._pager.get_transformed_size();
            if (y >= pagerY && y <= pagerY + height) {
                if (x < pagerX + PAGE_EDGE) step = -1;
                else if (x > pagerX + width - PAGE_EDGE) step = 1;
            }
        }
        if (step !== 0 && !this._canMove(step)) step = 0;
        if (step === this._dwellStep) return;

        this._cancelDwell();
        this._dwellStep = step;
        if (step === 0) return;

        this._dwellId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, PAGE_DWELL_MS, () => {
            this._dwellId = 0;
            this._dwellStep = 0;
            this._setPage(this._page + step);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelDwell() {
        if (this._dwellId) this._timers.remove(this._dwellId);
        this._dwellId = 0;
        this._dwellStep = 0;
    }

    focusFirst() {
        const first = this._cells.get(this._order[this._page * PAGE_SIZE]);
        if (first) first.grab_key_focus();
        else this.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    _cell(icon, name, onClick) {
        const content = vbox('spacing: 8px;', { x_expand: true });
        content.add_child(icon);
        content.add_child(label(name, 'dhruva-start-cell-label', { x_align: Clutter.ActorAlign.CENTER }));
        return button('dhruva-start-item', content, onClick, this, { width: CELL_WIDTH });
    }

    _appCell(item) {
        const app = item.app;
        const icon = appIcon(app, ICON_SIZE);
        const cell = this._cell(icon, app.get_name(), () => this._menu.launchApp(app));
        onSecondaryClick(cell, (x, y) => this._menu.showContextMenu(this._menu.appMenuItems(app), x, y), this);
        this._makeDraggable(cell, item, icon);
        return cell;
    }

    _folderCell(item) {
        const icon = folderIcon(item.apps, ICON_SIZE);
        const cell = this._cell(icon, item.folder.name, () => this._menu.showFolder(item.key));
        onSecondaryClick(cell, (x, y) => this._menu.showContextMenu([
            { text: _('Open'), icon: 'folder-open-symbolic', run: () => this._menu.showFolder(item.key) },
            { text: _('Unpin from Start'), icon: 'view-pin-symbolic', run: () => this._menu.data.unpin(item.key) },
        ], x, y), this);
        this._makeDraggable(cell, item, icon);
        return cell;
    }

    _makeDraggable(cell, item, icon) {
        const dragActor = () => (item.app ? appIcon(item.app, ICON_SIZE) : folderIcon(item.apps, ICON_SIZE));
        this._reorder.makeDraggable(cell, item.key, dragActor, icon);
    }

    _canGroup(sourceKey, targetKey) {
        if (sourceKey.includes(':')) return false;
        const target = this._items.get(targetKey);
        return Boolean(target) && (Boolean(target.app) || target.isStartFolder);
    }

    _group(sourceKey, targetKey) {
        const data = this._menu.data;
        if (this._items.get(targetKey).app) data.groupIntoFolder(targetKey, sourceKey);
        else data.addToFolder(targetKey, sourceKey);
    }

    _buildRecentApps() {
        const apps = this._menu.data.recentApps(RECENT_APPS);
        this._recentAppsSection.visible = apps.length > 0;
        if (apps.length === 0) return;

        this._recentAppsSection.add_child(sectionHeader(_('Recent apps')));
        const row = hbox(`spacing: ${CARD_SPACING}px;`);
        apps.forEach(app => row.add_child(this._recentAppCard(app)));
        this._recentAppsSection.add_child(row);
    }

    _recentAppCard(app) {
        const windows = app.get_n_windows();
        const isRunning = windows > 0;

        const iconBox = vbox('spacing: 4px;', { x_align: Clutter.ActorAlign.CENTER });
        iconBox.add_child(appIcon(app, ICON_SIZE));
        iconBox.add_child(new St.Widget({
            style_class: 'dhruva-start-dot',
            opacity: isRunning ? 255 : 0,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const content = vbox('spacing: 4px;', { x_expand: true });
        content.add_child(iconBox);
        content.add_child(label(app.get_name(), 'dhruva-start-title', { x_align: Clutter.ActorAlign.CENTER }));
        content.add_child(label(
            isRunning ? ngettext('%d window', '%d windows', windows).format(windows) : _('Recently used'),
            'dhruva-start-meta',
            { x_align: Clutter.ActorAlign.CENTER }
        ));
        const card = button('dhruva-start-card', content, () => this._menu.launchApp(app), this, { width: CARD_WIDTH });
        onSecondaryClick(card, (x, y) => this._menu.showContextMenu(this._menu.appMenuItems(app), x, y), this);
        return card;
    }

    _loadContinue() {
        this._renderContinue(this._menu.data.recentFiles);
        this._menu.data.loadRecentFiles().then(files => {
            if (!isActorAlive(this._continueSection)) return;
            const uris = files.slice(0, this._menu.data.recentFilesCount).map(entry => entry.uri).join('\n');
            if (uris !== this._shownUris) this._renderContinue(files);
        });
    }

    _renderContinue(allFiles) {
        const files = allFiles.slice(0, this._menu.data.recentFilesCount);
        this._shownUris = files.map(entry => entry.uri).join('\n');
        this._continueSection.destroy_all_children();
        this._continueSection.visible = files.length > 0;
        if (files.length === 0) return;

        this._continueSection.add_child(sectionHeader(_('Continue where you left off')));
        const row = hbox(`spacing: ${CARD_SPACING}px;`);
        files.forEach(entry => row.add_child(this._fileCard(entry)));
        this._continueSection.add_child(horizontalScroller(row, this));
    }

    _fileCard(entry) {
        const info = vbox('spacing: 1px;', { x_expand: true });
        info.add_child(label(entry.name, 'dhruva-start-title'));
        info.add_child(label(relativeTime(entry.time), 'dhruva-start-meta'));

        const caption = hbox('spacing: 8px; padding: 0 2px;');
        caption.add_child(new St.Icon({ gicon: entry.gicon, icon_size: 20, y_align: Clutter.ActorAlign.CENTER }));
        caption.add_child(info);

        const content = vbox('spacing: 8px;');
        content.add_child(thumbnail(entry, FILE_CARD_WIDTH - 16, THUMB_HEIGHT, 12));
        content.add_child(caption);
        const card = button('dhruva-start-card', content, () => this._menu.openFile(entry), this, { width: FILE_CARD_WIDTH });
        onSecondaryClick(card, (x, y) => this._menu.showContextMenu(this._menu.fileMenuItems(entry), x, y), this);
        return card;
    }

    _buildFooter() {
        const footer = hbox(`spacing: 8px; padding-top: 12px; margin-right: ${EDGE_PADDING}px;`, { style_class: 'dhruva-start-footer' });

        const user = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());
        this._user = user;
        this._avatar = new UserWidget.Avatar(user, { styleClass: 'dhruva-start-avatar', iconSize: 36 });
        this._avatar.y_align = Clutter.ActorAlign.CENTER;
        this._userName = label('', 'dhruva-start-user', { y_align: Clutter.ActorAlign.CENTER, x_expand: true });

        const syncUser = () => {
            this._avatar.update();
            this._userName.text = user.get_real_name() || user.get_user_name() || GLib.get_user_name();
        };
        user.connectObject('notify::is-loaded', syncUser, 'changed', syncUser, this);
        syncUser();

        footer.add_child(this._avatar);
        footer.add_child(this._userName);
        footer.add_child(iconButton('emblem-system-symbolic', _('Settings'), () => this._menu.launchAppId(SETTINGS_APP_ID), this));
        footer.add_child(iconButton('system-lock-screen-symbolic', _('Lock'), () => this._runAction(() => this._systemActions.activateLockScreen()), this));
        footer.add_child(iconButton('system-shutdown-symbolic', _('Power Off / Log Out'), () => this._toggleSession(), this));
        return footer;
    }

    _sessionActions() {
        const actions = this._systemActions;
        const data = this._menu.data;
        return [
            [actions.can_switch_user, _('Switch User'), 'system-switch-user-symbolic', () => actions.activateSwitchUser()],
            [actions.can_suspend, _('Suspend'), 'media-playback-pause-symbolic', () => actions.activateSuspend()],
            [data.canHibernate, _('Hibernate'), 'document-save-symbolic', () => data.hibernate()],
            [actions.can_restart, _('Restart'), 'system-reboot-symbolic', () => actions.activateRestart()],
            [actions.can_power_off, _('Power Off'), 'system-shutdown-symbolic', () => actions.activatePowerOff()],
            [actions.can_logout, _('Log Out'), 'system-log-out-symbolic', () => actions.activateLogout()],
        ].filter(([isAvailable]) => isAvailable);
    }

    _toggleSession() {
        if (this._sessionRow.get_n_children() === 0) {
            this._sessionActions().forEach(([, text, icon, run]) => this._sessionRow.add_child(pillButton(text, icon, () => this._runAction(run), this)));
        }
        this._sessionRow.visible = !this._sessionRow.visible;
        if (this._sessionRow.visible && isKeyboardEvent()) this._sessionRow.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
    }

    _runAction(run) {
        this._menu.close();
        run();
    }

    destroy() {
        this._timers.destroy();
        this._timers = null;
        this._reorder.destroy();
        this._scrollbar.destroy();
        if (this._user) this._user.disconnectObject(this);
        this._user = null;
        if (isActorAlive(this.actor)) this.actor.destroy();
        this.actor = null;
    }
}