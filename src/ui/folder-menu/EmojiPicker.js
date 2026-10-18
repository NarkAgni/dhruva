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
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import emojisData from '../emojis.js';
import { BlurPanel } from '../blur/BlurPanel.js';
import { CrispLabel } from '../modules/music/CrispLabel.js';
import { isActorAlive, setBoxVertical } from '../../core/Utils.js';
import { resolvePopupBubbleColors } from '../dock/DockThemeResolver.js';


const COLUMNS = 9;
const CELL_SIZE = 52;
const EMOJI_FONT_PX = 30;
const VISIBLE_ROWS = 7;
const CARD_PADDING = 16;
const SCROLLBAR_GUTTER = CARD_PADDING;
const CARD_RADIUS = 20;
const TAB_SIZE = 40;
const TAB_ICON_SIZE = 20;
const MAX_SEARCH_RESULTS = 240;
const MAX_RECENTS = COLUMNS * 4;
const SEARCH_DEBOUNCE_MS = 120;
const OPEN_MS = 180;
const CLOSE_MS = 120;

const RECENT_ID = 'recent';
const SEARCH_ID = 'search';

const CATEGORIES = [
    { id: RECENT_ID, icon: 'emoji-recent-symbolic', title: () => _('Recently used') },
    { id: 'Smileys & Emotion', icon: 'emoji-people-symbolic', title: () => _('Smileys & Emotion') },
    { id: 'People & Body', icon: 'emoji-body-symbolic', title: () => _('People & Body') },
    { id: 'Animals & Nature', icon: 'emoji-nature-symbolic', title: () => _('Animals & Nature') },
    { id: 'Food & Drink', icon: 'emoji-food-symbolic', title: () => _('Food & Drink') },
    { id: 'Travel & Places', icon: 'emoji-travel-symbolic', title: () => _('Travel & Places') },
    { id: 'Activities', icon: 'emoji-activities-symbolic', title: () => _('Activities') },
    { id: 'Objects', icon: 'emoji-objects-symbolic', title: () => _('Objects') },
    { id: 'Symbols', icon: 'emoji-symbols-symbolic', title: () => _('Symbols') },
    { id: 'Flags', icon: 'emoji-flags-symbolic', title: () => _('Flags') },
];

function getAllEmojis() {
    return emojisData.emojis.filter(entry => CATEGORIES.some(cat => cat.id === entry.category));
}

function getEmojisByCategory(categoryId) {
    return emojisData.emojis.filter(entry => entry.category === categoryId);
}

const CELL_STYLE = `width: ${CELL_SIZE}px; height: ${CELL_SIZE}px; border-radius: 14px; font-size: ${EMOJI_FONT_PX}px; ` +
    'text-align: center; transition-duration: 90ms;';
const CELL_IDLE = `${CELL_STYLE} background-color: transparent;`;
const CELL_HIGHLIGHT = `${CELL_STYLE} background-color: rgba(255,255,255,0.18);`;


function tabStyle(isActive, isHovered) {
    let background = 'transparent';
    if (isActive) background = 'rgba(255,255,255,0.20)';
    else if (isHovered) background = 'rgba(255,255,255,0.10)';
    return `width: ${TAB_SIZE}px; height: ${TAB_SIZE}px; padding: 0; border-radius: ${TAB_SIZE / 2}px; ` +
        `background-color: ${background}; transition-duration: 120ms;`;
}

function tabIconStyle(isActive) {
    return `color: rgba(255,255,255,${isActive ? 1.0 : 0.6});`;
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function searchEmojis(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return getAllEmojis()
        .filter(entry => entry.emoji === query || words.every(word => entry.name.toLowerCase().includes(word)))
        .slice(0, MAX_SEARCH_RESULTS);
}

export class EmojiPicker {
    constructor(folderMenu, onSelect) {
        this.folderMenu = folderMenu;
        this.dockUI = folderMenu.dockUI;
        this.onSelect = onSelect;
        this.timers = folderMenu.timers;

        if (!this.dockUI._recentEmojis) {
            this.dockUI._recentEmojis = [];
        }
        this._recentEmojis = this.dockUI._recentEmojis;

        this._entries = [];
        this._cells = [];
        this._highlight = -1;
        this._categoryId = this._recentEmojis.length > 0 ? RECENT_ID : CATEGORIES[1].id;
        this._lastCategoryId = this._categoryId;
        this._tabs = new Map();
        this._searchTimerId = 0;
        this._blur = null;
        this._isClosing = false;
    }

    async show() {
        this.folderMenu.menuContainer.hide();

        this.overlay = new St.Widget({
            reactive: true,
            style: 'background-color: rgba(0,0,0,0.35);'
        });
        this.overlay.set_position(0, 0);
        this.overlay.set_size(global.stage.width, global.stage.height);
        this.overlay.connectObject(
            'button-release-event', (_actor, event) => {
                if (event.get_button() === Clutter.BUTTON_PRIMARY) this.close();
                return Clutter.EVENT_STOP;
            },
            this
        );
        this.folderMenu._emojiPicker = this;

        this._card = this._buildCard();
        this.overlay.add_child(this._card);
        Main.layoutManager.addChrome(this.overlay, { affectsStruts: false });

        this._showCategory(this._categoryId);
        this._placeCard();
        this._searchEntry.grab_key_focus();

        this._card.opacity = 0;
        this._card.set_pivot_point(0.5, 0.5);
        this._card.set_scale(0.96, 0.96);

        this._applyBlur();

        this._card.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: OPEN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._blur) this._blur.syncGeometry();
            }
        });
    }

    close() {
        if (this._isClosing || !this.overlay) return;
        this._isClosing = true;

        if (this._blur) {
            this._blur.destroy();
            this._blur = null;
        }

        if (isActorAlive(this._card)) {
            this._card.ease({
                opacity: 0,
                scale_x: 0.97,
                scale_y: 0.97,
                duration: CLOSE_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => this.destroy()
            });
        } else {
            this.destroy();
        }
    }

    _buildCard() {
        const colors = resolvePopupBubbleColors(this.dockUI);
        const blurOn = this.dockUI.settings.get_boolean('blur-enabled');
        const bgFill = blurOn ? 'rgba(0, 0, 0, 0.18)' : colors.fill;

        const card = new St.BoxLayout({
            reactive: true,
            style: `padding: ${CARD_PADDING}px 0 ${CARD_PADDING}px ${CARD_PADDING}px; spacing: 10px; ` +
                `border-radius: ${CARD_RADIUS}px; background-color: ${bgFill}; ` +
                `border: ${colors.strokeWidth}px solid ${colors.stroke};`
        });
        setBoxVertical(card, true);
        card.connectObject(
            'button-release-event', () => Clutter.EVENT_STOP,
            'captured-event', (_actor, event) => {
                if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
                return this._onKeyPress(event);
            },
            this
        );

        const search = this._buildSearch();
        search.style += ` margin-right: ${CARD_PADDING}px;`;
        card.add_child(search);

        this._sectionTitle = new CrispLabel({ font_desc: 'Sans Bold 9', color: 'rgba(255,255,255,0.7)' });
        card.add_child(this._sectionTitle);

        this._scrollView = new St.ScrollView({
            style: `height: ${CELL_SIZE * VISIBLE_ROWS}px; width: ${CELL_SIZE * COLUMNS + SCROLLBAR_GUTTER}px;`,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true
        });
        this._grid = new St.BoxLayout({ x_expand: true });
        setBoxVertical(this._grid, true);
        this._scrollView.add_child(this._grid);

        this._emptyLabel = new St.Label({
            text: _('No emojis found'),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: rgba(255,255,255,0.6); font-size: 13px; padding: 24px 0;',
            visible: false
        });

        const gridStack = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        gridStack.add_child(this._scrollView);
        gridStack.add_child(this._emptyLabel);
        card.add_child(gridStack);

        card.add_child(this._buildPreview());
        card.add_child(this._buildTabs());
        return card;
    }

    _buildSearch() {
        this._searchEntry = new St.Entry({
            hint_text: _('Search emoji'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({ icon_name: 'edit-find-symbolic', icon_size: 16, style: 'color: rgba(255,255,255,0.7);' }),
            style: 'font-size: 14px; border-radius: 12px; padding: 8px 12px; color: white; ' +
                'background-color: rgba(255,255,255,0.10); border: none; box-shadow: none;'
        });

        this._searchEntry.clutter_text.connectObject('text-changed', () => this._queueSearch(), this);
        return this._searchEntry;
    }

    _buildPreview() {
        const row = new St.BoxLayout({ style: `spacing: 10px; padding: 2px ${CARD_PADDING}px 2px 4px;` });
        setBoxVertical(row, false);

        this._previewEmoji = new St.Label({ style: 'font-size: 22px;', y_align: Clutter.ActorAlign.CENTER });
        this._previewName = new CrispLabel({
            font_desc: 'Sans 10',
            color: 'rgba(255,255,255,0.9)',
            y_align: Clutter.ActorAlign.CENTER
        });

        row.add_child(this._previewEmoji);
        row.add_child(this._previewName);
        return row;
    }

    _buildTabs() {
        const bar = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            style: `spacing: 4px; padding-top: 2px; margin-right: ${CARD_PADDING}px;`
        });
        setBoxVertical(bar, false);

        for (const category of CATEGORIES) {
            const icon = new St.Icon({
                icon_name: category.icon,
                fallback_icon_name: 'face-smile-symbolic',
                icon_size: TAB_ICON_SIZE,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: tabIconStyle(false)
            });
            const tab = new St.Button({
                child: icon,
                style: tabStyle(false, false),
                accessible_name: category.title()
            });
            tab._icon = icon;
            tab.connectObject(
                'notify::hover', () => this._styleTab(category.id),
                'clicked', () => this._showCategory(category.id),
                this
            );
            this._tabs.set(category.id, tab);
            bar.add_child(tab);
        }
        return bar;
    }

    _styleTab(categoryId) {
        const tab = this._tabs.get(categoryId);
        const isActive = categoryId === this._categoryId;
        tab.set_style(tabStyle(isActive, tab.hover));
        tab._icon.set_style(tabIconStyle(isActive));
    }

    _placeCard() {
        const monitor = this.dockUI.monitorManager.getCurrentMonitor().monitor || Main.layoutManager.primaryMonitor;
        const [, width] = this._card.get_preferred_width(-1);
        const [, height] = this._card.get_preferred_height(width);
        const x = Math.round(monitor.x + (monitor.width - width) / 2);
        const y = Math.round(monitor.y + (monitor.height - height) / 2);

        this._card.set_position(x, y);
        this._cardRect = {
            x,
            y,
            width: Math.round(width),
            height: Math.round(height)
        };
    }

    _applyBlur() {
        if (!this.dockUI.settings.get_boolean('blur-enabled')) return;
        this._blur = new BlurPanel(this._card, this.dockUI.settings, CARD_RADIUS, this._card, null, true);
        this._blur.contentActor = this.overlay;
        if (this._cardRect) {
            this._blur.setTargetRect(this._cardRect);
        }
    }

    _showCategory(categoryId) {
        this._categoryId = categoryId;
        this._lastCategoryId = categoryId;
        this._searchEntry.set_text('');
        if (this._searchTimerId) {
            this.timers.remove(this._searchTimerId);
            this._searchTimerId = 0;
        }

        this._tabs.forEach((_tab, id) => this._styleTab(id));
        const category = CATEGORIES.find(cat => cat.id === categoryId);
        const entries = categoryId === RECENT_ID ? this._recentEmojis : getEmojisByCategory(categoryId);
        this._populate(entries, category.title(), _('Pick an emoji to use it often'));
    }

    _queueSearch() {
        if (this._searchTimerId) {
            this.timers.remove(this._searchTimerId);
            this._searchTimerId = 0;
        }
        this._searchTimerId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            this._searchTimerId = 0;
            this._runSearch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _runSearch() {
        const query = this._searchEntry.get_text().trim();
        if (!query) {
            this._showCategory(this._lastCategoryId);
            return;
        }

        if (this._categoryId !== SEARCH_ID) this._lastCategoryId = this._categoryId;
        this._categoryId = SEARCH_ID;
        this._tabs.forEach((_tab, id) => this._styleTab(id));
        this._populate(searchEmojis(query), _('Search results'), _('No emojis found'));
    }

    _populate(entries, title, emptyText) {
        this._grid.destroy_all_children();
        this._entries = entries;
        this._cells = [];
        this._highlight = -1;

        this._sectionTitle.text = title;
        this._emptyLabel.text = emptyText;
        this._emptyLabel.visible = entries.length === 0;

        let row = null;
        entries.forEach((entry, index) => {
            if (index % COLUMNS === 0) {
                row = new St.BoxLayout();
                setBoxVertical(row, false);
                this._grid.add_child(row);
            }

            const cell = new St.Button({ label: entry.emoji, style: CELL_IDLE, accessible_name: entry.name });
            cell.connectObject(
                'notify::hover', () => {
                    if (cell.hover) this._setHighlight(index, false);
                },
                'clicked', () => this._choose(index),
                this
            );
            this._cells.push(cell);
            row.add_child(cell);
        });

        this._scrollAdjustment().set_value(0);
        this._setHighlight(entries.length > 0 ? 0 : -1, false);
    }

    _setHighlight(index, scrollIntoView = true) {
        if (this._highlight >= 0) this._cells[this._highlight].set_style(CELL_IDLE);
        this._highlight = index;

        if (index < 0) {
            this._previewEmoji.text = '';
            this._previewName.text = '';
            return;
        }

        const entry = this._entries[index];
        this._cells[index].set_style(CELL_HIGHLIGHT);
        this._previewEmoji.text = entry.emoji;
        this._previewName.text = capitalize(entry.name);
        if (scrollIntoView) this._scrollToRow(Math.floor(index / COLUMNS));
    }

    _scrollAdjustment() {
        return this._scrollView.vadjustment || this._scrollView.get_vscroll_bar().get_adjustment();
    }

    _scrollToRow(rowIndex) {
        const adjustment = this._scrollAdjustment();
        const rowTop = rowIndex * CELL_SIZE;
        const rowBottom = rowTop + CELL_SIZE;
        const viewTop = adjustment.value;
        const viewBottom = viewTop + adjustment.page_size;

        if (rowTop < viewTop) adjustment.set_value(rowTop);
        else if (rowBottom > viewBottom) adjustment.set_value(rowBottom - adjustment.page_size);
    }

    _rememberRecent(entry) {
        const index = this._recentEmojis.findIndex(recent => recent.emoji === entry.emoji);
        if (index >= 0) this._recentEmojis.splice(index, 1);
        this._recentEmojis.unshift(entry);
        this._recentEmojis.length = Math.min(this._recentEmojis.length, MAX_RECENTS);
    }

    _choose(index) {
        const entry = this._entries[index];
        this._rememberRecent(entry);
        this.onSelect(entry.emoji);
        this.close();
    }

    _moveHighlight(delta) {
        const count = this._cells.length;
        if (count === 0) return;

        let next = this._highlight + delta;
        if (next < 0) next = Math.abs(delta) >= COLUMNS ? this._highlight % COLUMNS : 0;
        if (next >= count) next = count - 1;
        this._setHighlight(next);
    }

    _cycleCategory(step) {
        const ids = CATEGORIES.map(cat => cat.id);
        const index = ids.indexOf(this._lastCategoryId);
        this._showCategory(ids[(index + step + ids.length) % ids.length]);
    }

    _onKeyPress(event) {
        const key = event.get_key_symbol();
        const isCtrl = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;

        switch (key) {
            case Clutter.KEY_Escape:
                if (this._searchEntry.get_text()) this._searchEntry.set_text('');
                else this.close();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
                if (this._highlight >= 0) this._choose(this._highlight);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Right:
                this._moveHighlight(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Left:
                this._moveHighlight(-1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Down:
                this._moveHighlight(COLUMNS);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Up:
                this._moveHighlight(-COLUMNS);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Page_Down:
                if (isCtrl) this._cycleCategory(1);
                else this._moveHighlight(COLUMNS * VISIBLE_ROWS);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Page_Up:
                if (isCtrl) this._cycleCategory(-1);
                else this._moveHighlight(-COLUMNS * VISIBLE_ROWS);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Tab:
                this._cycleCategory(1);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_ISO_Left_Tab:
                this._cycleCategory(-1);
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_PROPAGATE;
        }
    }

    destroy() {
        if (this._searchTimerId && this.timers) {
            this.timers.remove(this._searchTimerId);
            this._searchTimerId = 0;
        }
        if (this._blur) {
            this._blur.destroy();
            this._blur = null;
        }
        if (this._searchEntry && this._searchEntry.clutter_text) {
            this._searchEntry.clutter_text.disconnectObject(this);
        }
        this._tabs.forEach(tab => tab.disconnectObject(this));
        this._tabs.clear();
        this._cells.forEach(cell => cell.disconnectObject(this));
        this._cells = [];
        if (this._card) {
            this._card.remove_all_transitions();
            this._card.disconnectObject(this);
            this._card = null;
        }
        if (this.overlay) {
            const overlay = this.overlay;
            this.overlay = null;
            overlay.disconnectObject(this);
            if (isActorAlive(overlay)) {
                overlay.destroy();
            }
            if (this.folderMenu) {
                if (this.folderMenu._emojiPicker === this) {
                    this.folderMenu._emojiPicker = null;
                }
                if (isActorAlive(this.folderMenu.menuContainer)) {
                    this.folderMenu.menuContainer.show();
                }
            }
        }
    }
}
