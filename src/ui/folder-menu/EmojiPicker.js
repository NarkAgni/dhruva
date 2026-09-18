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



import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


import emojisData from '../emojis.js';
import { isActorAlive, setBoxVertical } from '../../core/Utils.js';


const EMOJIS_PER_ROW = 8;
const MAX_SHOWN_EMOJIS = 200;
const SEARCH_DEBOUNCE_MS = 150;
const CACHED_EMOJIS = emojisData.emojis || [];
const CACHED_CATEGORIES = ['All', ...new Set(CACHED_EMOJIS.map(e => e.category).filter(Boolean))];

export class EmojiPicker {
    constructor(folderMenu, onSelect) {
        this.folderMenu = folderMenu;
        this.onSelect = onSelect;
        this.dockUI = folderMenu.dockUI;
        this.emojiList = CACHED_EMOJIS;
        this.categories = CACHED_CATEGORIES;
        this.currentCategory = 'All';
        this.activeEmojiButtons = [];
        this.currentFocusIndex = -1;
        this.timers = folderMenu.timers;
        this._searchTimerId = null;
    }

    async show() {
        if (this.folderMenu.menuContainer && isActorAlive(this.folderMenu.menuContainer)) {
            this.folderMenu.menuContainer.hide();
        }

        this.overlay = new St.Widget({
            reactive: true,
            style: 'background-color: rgba(0,0,0,0.6);'
        });
        this.overlay.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL
        }));
        this.overlay.set_layout_manager(new Clutter.BinLayout());

        Main.layoutManager.addChrome(this.overlay, {
            affectsStruts: false
        });

        this.folderMenu._emojiOverlay = this.overlay;
        this.overlay.connectObject('destroy', () => this.destroy(), this);

        const tooltipCss = (this.dockUI.actor && this.dockUI.actor._tooltipBg) || 'background-color: rgba(20,20,30,0.97);';

        const picker = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: `border-radius: 16px; padding: 16px 24px; border: 1px solid rgba(255,255,255,0.12); width: 680px; ${tooltipCss}`,
            reactive: true
        });
        setBoxVertical(picker, true);

        const headerBox = new St.BoxLayout({
            style: 'margin-bottom: 12px; spacing: 8px;',
            y_align: Clutter.ActorAlign.CENTER
        });
        setBoxVertical(headerBox, false);

        const catBtn = new St.Button({
            reactive: true,
            style: 'padding: 8px 14px; border-radius: 8px; background-color: rgba(255,255,255,0.1);'
        });
        const catBox = new St.BoxLayout({
            style: 'spacing: 8px;',
            y_align: Clutter.ActorAlign.CENTER
        });
        setBoxVertical(catBox, false);
        const catLabel = new St.Label({
            text: 'All',
            style: 'color: white; font-weight: bold; font-size: 14px;'
        });
        const catIcon = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 14,
            style: 'color: white;'
        });
        catBox.add_child(catLabel);
        catBox.add_child(catIcon);
        catBtn.set_child(catBox);

        const searchEntry = new St.Entry({
            hint_text: _('Search emojis...'),
            x_expand: true,
            style: 'font-size: 15px; font-family: sans-serif; border-radius: 8px; padding: 8px 14px; color: white; background-color: rgba(255,255,255,0.1); border: none; box-shadow: none;'
        });

        headerBox.add_child(catBtn);
        headerBox.add_child(searchEntry);
        picker.add_child(headerBox);

        const dropdownBox = new St.BoxLayout({
            style: `border-radius: 12px; padding: 6px; border: 1px solid rgba(255,255,255,0.15); ${tooltipCss}`,
            visible: false,
            reactive: true
        });
        setBoxVertical(dropdownBox, true);
        dropdownBox.connectObject('button-release-event', () => Clutter.EVENT_STOP, this);

        this.overlay.connectObject('button-release-event', () => {
            if (dropdownBox.visible) {
                dropdownBox.visible = false;
                return Clutter.EVENT_STOP;
            }
            this.closePicker();
            return Clutter.EVENT_STOP;
        }, this);

        picker.connectObject('button-release-event', () => {
            if (dropdownBox.visible) dropdownBox.visible = false;
            return Clutter.EVENT_STOP;
        }, this);

        const ddWrapper = new St.Widget({
            layout_manager: new Clutter.FixedLayout()
        });
        ddWrapper.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL
        }));
        ddWrapper.add_child(dropdownBox);

        const ddScroll = new St.ScrollView({
            style: 'max-height: 250px;',
            vscrollbar_policy: St.PolicyType.NEVER,
            hscrollbar_policy: St.PolicyType.NEVER
        });
        const ddInnerBox = new St.BoxLayout({});
        setBoxVertical(ddInnerBox, true);
        ddScroll.add_child(ddInnerBox);
        dropdownBox.add_child(ddScroll);

        this.categories.forEach(cat => {
            const btn = new St.Button({
                child: new St.Label({
                    text: cat,
                    style: 'color: white; font-size: 14px; font-weight: bold; text-shadow: 0 1px 2px rgba(0,0,0,0.5);'
                }),
                style: 'padding: 8px 14px; border-radius: 6px;',
                reactive: true
            });
            btn.connectObject('notify::hover', () => {
                btn.set_style(btn.hover
                    ? 'padding: 8px 14px; border-radius: 6px; background-color: rgba(255,255,255,0.15);'
                    : 'padding: 8px 14px; border-radius: 6px; background-color: transparent;');
            }, this);
            btn.connectObject('clicked', () => {
                this.currentCategory = cat;
                catLabel.set_text(cat);
                dropdownBox.visible = false;
                this.populateGrid(searchEntry.get_text(), this.currentCategory);
            }, this);
            ddInnerBox.add_child(btn);
        });

        catBtn.connectObject('clicked', () => {
            dropdownBox.visible = !dropdownBox.visible;
            if (dropdownBox.visible) {
                const [px, py] = catBtn.get_transformed_position();
                const [, ph] = catBtn.get_transformed_size();
                dropdownBox.set_position(px, py + ph + 8);
            }
        }, this);

        this.scrollView = new St.ScrollView({
            style: 'height: 400px;',
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER
        });

        this.gridContainer = new St.BoxLayout({
            x_expand: true,
            style: 'padding-right: 0px; padding-bottom: 16px;'
        });
        setBoxVertical(this.gridContainer, true);
        this.scrollView.add_child(this.gridContainer);
        picker.add_child(this.scrollView);

        const detailBox = new St.BoxLayout({
            style: 'margin-top: 16px; padding: 10px 14px; border-radius: 10px; background-color: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.05);',
            y_align: Clutter.ActorAlign.CENTER
        });
        setBoxVertical(detailBox, false);
        this.bigEmojiLabel = new St.Label({
            text: '✨',
            style: 'font-size: 32px; margin-right: 14px;'
        });
        const textDetailBox = new St.BoxLayout({
            x_expand: true
        });
        setBoxVertical(textDetailBox, true);
        this.emojiNameLabel = new St.Label({
            text: _('Hover an emoji'),
            style: 'font-size: 14px; font-weight: bold; color: white;'
        });
        this.emojiCatLabel = new St.Label({
            text: _('Category'),
            style: 'font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px;'
        });

        textDetailBox.add_child(this.emojiNameLabel);
        textDetailBox.add_child(this.emojiCatLabel);
        detailBox.add_child(this.bigEmojiLabel);
        detailBox.add_child(textDetailBox);
        picker.add_child(detailBox);

        this.overlay.connectObject('key-press-event', (_actor, event) => this.handleKeyPress(event), this);
        searchEntry.connectObject('key-press-event', (_actor, event) => this.handleKeyPress(event), this);

        this.populateGrid('', this.currentCategory);

        searchEntry.clutter_text.connectObject('text-changed', () => {
            if (this._searchTimerId) this.timers.remove(this._searchTimerId);
            this._searchTimerId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
                this.populateGrid(searchEntry.get_text(), this.currentCategory);
                this._searchTimerId = null;
                return GLib.SOURCE_REMOVE;
            });
        }, this);

        this.overlay.add_child(picker);
        this.overlay.add_child(ddWrapper);
        global.stage.set_key_focus(searchEntry);
    }

    populateGrid(filterText, filterCat) {
        this.gridContainer.destroy_all_children();
        this.activeEmojiButtons = [];
        this.currentFocusIndex = -1;
        let filtered = this.emojiList.filter(e => (filterCat === 'All' || e.category === filterCat));

        if (filterText) {
            const q = filterText.toLowerCase();
            filtered = filtered.filter(e => (e.name && e.name.toLowerCase().includes(q)) || (e.emoji && e.emoji.includes(q)));
        }

        const shown = filtered.slice(0, MAX_SHOWN_EMOJIS);
        let currentRow = null;
        shown.forEach((item, index) => {
            if (index % EMOJIS_PER_ROW === 0) {
                currentRow = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.CENTER,
                    style: index > 0 ? 'margin-top: 8px;' : ''
                });
                setBoxVertical(currentRow, false);
                this.gridContainer.add_child(currentRow);
            }
            const emoji = item.emoji;
            const name = item.name.charAt(0).toUpperCase() + item.name.slice(1);

            const baseStyle = 'font-size: 46px; border-radius: 10px; width: 72px; height: 72px; text-align: center; background-color: transparent;';
            const btn = new St.Button({
                label: emoji,
                style: baseStyle + (index % EMOJIS_PER_ROW !== (EMOJIS_PER_ROW - 1) ? ' margin-right: 8px;' : ''),
                reactive: true
            });

            btn._baseStyle = btn.style;
            btn._emojiData = { emoji, name, category: item.category };
            btn._btnIndex = index;

            btn.connectObject('notify::hover', () => {
                if (btn.hover) this.updateFocus(btn._btnIndex);
            }, this);

            btn.connectObject('clicked', () => {
                this.onSelect(emoji);
                this.closePicker();
            }, this);

            this.activeEmojiButtons.push(btn);
            currentRow.add_child(btn);
        });

        if (this.activeEmojiButtons.length > 0) this.updateFocus(0);
    }

    updateFocus(newIndex) {
        if (this.activeEmojiButtons.length === 0) return;

        if (this.currentFocusIndex >= 0 && this.activeEmojiButtons[this.currentFocusIndex]) {
            const oldBtn = this.activeEmojiButtons[this.currentFocusIndex];
            if (isActorAlive(oldBtn)) {
                oldBtn.set_style(oldBtn._baseStyle);
            }
        }

        if (newIndex >= 0 && this.activeEmojiButtons[newIndex]) {
            this.currentFocusIndex = newIndex;
            const newBtn = this.activeEmojiButtons[newIndex];

            if (isActorAlive(newBtn)) {
                newBtn.set_style(`${newBtn._baseStyle} background-color: rgba(255,255,255,0.25); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.4);`);

                if (isActorAlive(this.bigEmojiLabel)) this.bigEmojiLabel.set_text(newBtn._emojiData.emoji);
                if (isActorAlive(this.emojiNameLabel)) this.emojiNameLabel.set_text(newBtn._emojiData.name);
                if (isActorAlive(this.emojiCatLabel)) this.emojiCatLabel.set_text(newBtn._emojiData.category);

                let adj = null;
                if (this.scrollView.get_vadjustment) {
                    adj = this.scrollView.get_vadjustment();
                } else if (this.scrollView.get_vscroll_bar) {
                    adj = this.scrollView.get_vscroll_bar().get_adjustment();
                }

                if (adj) {
                    const rowIndex = Math.floor(newIndex / EMOJIS_PER_ROW);
                    const rowHeight = 80;

                    const targetTop = rowIndex * rowHeight;
                    const targetBottom = targetTop + rowHeight;

                    const viewTop = adj.get_value();
                    const pageSize = adj.get_page_size();
                    const viewBottom = viewTop + pageSize;

                    if (pageSize > 0) {
                        if (targetTop < viewTop) {
                            adj.set_value(targetTop);
                        } else if (targetBottom > viewBottom) {
                            adj.set_value(targetBottom - pageSize + 16);
                        }
                    } else {
                        adj.set_value(targetTop);
                    }
                }
            }
        }
    }

    handleKeyPress(event) {
        const key = event.get_key_symbol();
        if (this.activeEmojiButtons.length === 0) return Clutter.EVENT_PROPAGATE;

        if (key === Clutter.KEY_Escape) {
            this.closePicker();
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
            if (this.currentFocusIndex >= 0) this.activeEmojiButtons[this.currentFocusIndex].emit('clicked', 0);
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Right) {
            this.updateFocus((this.currentFocusIndex + 1) % this.activeEmojiButtons.length);
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Left) {
            this.updateFocus((this.currentFocusIndex - 1 + this.activeEmojiButtons.length) % this.activeEmojiButtons.length);
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Down) {
            this.updateFocus(Math.min(this.currentFocusIndex + EMOJIS_PER_ROW, this.activeEmojiButtons.length - 1));
            return Clutter.EVENT_STOP;
        }

        if (key === Clutter.KEY_Up) {
            this.updateFocus(Math.max(this.currentFocusIndex - EMOJIS_PER_ROW, 0));
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    closePicker() {
        if (this.overlay) {
            const overlayActor = this.overlay;
            this.overlay = null;
            if (isActorAlive(overlayActor)) {
                overlayActor.destroy();
            }
        }
    }

    destroy() {
        if (this._searchTimerId) {
            this.timers.remove(this._searchTimerId);
            this._searchTimerId = null;
        }
        if (this.folderMenu && this.folderMenu._emojiOverlay === this.overlay) {
            this.folderMenu._emojiOverlay = null;
        }
        if (this.folderMenu && this.folderMenu.menuContainer && isActorAlive(this.folderMenu.menuContainer)) {
            this.folderMenu.menuContainer.show();
        }
        this.overlay = null;
    }
}