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
import cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import AppContextMenu from '../context-menu/AppContextMenu.js';


class EmojiPicker {
    constructor(folderMenu, onSelect) {
        this.folderMenu = folderMenu;
        this.onSelect = onSelect;
        this.dockUI = folderMenu.dockUI;
        this.emojiList = [];
        this.categories = ['All'];
        this.currentCategory = 'All';
        this.activeEmojiButtons = [];
        this.currentFocusIndex = -1;
        this.timers = folderMenu.timers;
        this._searchTimerId = null;
    }

    async show() {
        if (this.folderMenu.menuContainer) {
            this.folderMenu.menuContainer.hide();
        }

        try {
            const emojiFile = Gio.File.new_for_path(`${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/dhruva@narkagni/src/ui/emojis.json`);

            const readContentsAsync = (file) => {
                return new Promise((resolve) => {
                    if (!file.query_exists(null)) {
                        resolve(null);
                        return;
                    }
                    file.load_contents_async(null, (obj, res) => {
                        const [success, contents] = obj.load_contents_finish(res);
                        resolve(success ? contents : null);
                    });
                });
            };

            const contents = await readContentsAsync(emojiFile);
            if (contents) {
                const decoder = new TextDecoder('utf-8');
                const parsed = JSON.parse(decoder.decode(contents));
                this.emojiList = parsed.emojis || [];
                const cats = new Set();
                this.emojiList.forEach(e => {
                    if (e.category) cats.add(e.category);
                });
                this.categories = ['All', ...Array.from(cats)];
            }
        } catch (_e) {
            this.emojiList = [{
                emoji: '😀',
                name: 'grinning face',
                category: 'Smileys'
            }, {
                emoji: '📁',
                name: 'folder',
                category: 'Objects'
            }];
            this.categories = ['All', 'Smileys', 'Objects'];
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

        const tooltipCss = this.dockUI.actor._tooltipBg || 'background-color: rgba(20,20,30,0.97);';

        const picker = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: `border-radius: 16px; padding: 16px 24px; border: 1px solid rgba(255,255,255,0.12); width: 680px; ${tooltipCss}`,
            reactive: true
        });

        const headerBox = new St.BoxLayout({
            vertical: false,
            style: 'margin-bottom: 12px; spacing: 8px;',
            y_align: Clutter.ActorAlign.CENTER
        });

        const catBtn = new St.Button({
            reactive: true,
            style: 'padding: 8px 14px; border-radius: 8px; background-color: rgba(255,255,255,0.1);'
        });
        const catBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px;',
            y_align: Clutter.ActorAlign.CENTER
        });
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
            hint_text: 'Search emojis...',
            x_expand: true,
            style: 'font-size: 15px; font-family: sans-serif; border-radius: 8px; padding: 8px 14px; color: white; background-color: rgba(255,255,255,0.1); border: none; box-shadow: none;'
        });

        headerBox.add_child(catBtn);
        headerBox.add_child(searchEntry);
        picker.add_child(headerBox);

        const dropdownBox = new St.BoxLayout({
            vertical: true,
            style: `border-radius: 12px; padding: 6px; border: 1px solid rgba(255,255,255,0.15); ${tooltipCss}`,
            visible: false,
            reactive: true
        });
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
        const ddInnerBox = new St.BoxLayout({
            vertical: true
        });
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
            btn.connectObject('notify::hover', () => btn.set_style(btn.hover ? 'padding: 8px 14px; border-radius: 6px; background-color: rgba(255,255,255,0.15);' : 'padding: 8px 14px; border-radius: 6px; background-color: transparent;'), this);
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
            vertical: true,
            x_expand: true,
            style: 'padding-right: 0px; padding-bottom: 16px;'
        });
        this.scrollView.add_child(this.gridContainer);
        picker.add_child(this.scrollView);

        const detailBox = new St.BoxLayout({
            vertical: false,
            style: 'margin-top: 16px; padding: 10px 14px; border-radius: 10px; background-color: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.05);',
            y_align: Clutter.ActorAlign.CENTER
        });
        this.bigEmojiLabel = new St.Label({
            text: '✨',
            style: 'font-size: 32px; margin-right: 14px;'
        });
        const textDetailBox = new St.BoxLayout({
            vertical: true,
            x_expand: true
        });
        this.emojiNameLabel = new St.Label({
            text: 'Hover an emoji',
            style: 'font-size: 14px; font-weight: bold; color: white;'
        });
        this.emojiCatLabel = new St.Label({
            text: 'Category',
            style: 'font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px;'
        });

        textDetailBox.add_child(this.emojiNameLabel);
        textDetailBox.add_child(this.emojiCatLabel);
        detailBox.add_child(this.bigEmojiLabel);
        detailBox.add_child(textDetailBox);
        picker.add_child(detailBox);

        this.overlay.connectObject('key-press-event', (actor, event) => this.handleKeyPress(event), this);
        searchEntry.connectObject('key-press-event', (actor, event) => this.handleKeyPress(event), this);

        this.populateGrid('', this.currentCategory);

        searchEntry.clutter_text.connectObject('text-changed', () => {
            if (this._searchTimerId) this.timers.remove(this._searchTimerId);
            this._searchTimerId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 150, () => {
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

        const shown = filtered.slice(0, 200);
        let currentRow = null;
        shown.forEach((item, index) => {
            if (index % 8 === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    x_align: Clutter.ActorAlign.CENTER,
                    style: index > 0 ? 'margin-top: 8px;' : ''
                });
                this.gridContainer.add_child(currentRow);
            }
            const emoji = item.emoji;
            const name = item.name.charAt(0).toUpperCase() + item.name.slice(1);

            const baseStyle = 'font-size: 46px; border-radius: 10px; width: 72px; height: 72px; text-align: center; background-color: transparent;';
            const btn = new St.Button({
                label: emoji,
                style: baseStyle + (index % 8 !== 7 ? ' margin-right: 8px;' : ''),
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
                this.overlay.destroy();
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
            oldBtn.set_style(oldBtn._baseStyle);
        }

        if (newIndex >= 0 && this.activeEmojiButtons[newIndex]) {
            this.currentFocusIndex = newIndex;
            const newBtn = this.activeEmojiButtons[newIndex];

            newBtn.set_style(`${newBtn._baseStyle} background-color: rgba(255,255,255,0.25); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.4);`);

            this.bigEmojiLabel.set_text(newBtn._emojiData.emoji);
            this.emojiNameLabel.set_text(newBtn._emojiData.name);
            this.emojiCatLabel.set_text(newBtn._emojiData.category);

            let adj = null;
            if (this.scrollView.get_vadjustment) {
                adj = this.scrollView.get_vadjustment();
            } else if (this.scrollView.get_vscroll_bar) {
                adj = this.scrollView.get_vscroll_bar().get_adjustment();
            }

            if (adj) {
                const rowIndex = Math.floor(newIndex / 8);
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

    handleKeyPress(event) {
        const key = event.get_key_symbol();
        if (this.activeEmojiButtons.length === 0) return Clutter.EVENT_PROPAGATE;

        if (key === Clutter.KEY_Escape) {
            this.closePicker();
            return Clutter.EVENT_STOP;
        }

        if ([Clutter.KEY_Up, Clutter.KEY_Down, Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Return, Clutter.KEY_KP_Enter].includes(key)) {
            let targetIndex = this.currentFocusIndex;
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                if (this.currentFocusIndex >= 0) this.activeEmojiButtons[this.currentFocusIndex].emit('clicked', 0);
            } else if (key === Clutter.KEY_Right) {
                targetIndex = (this.currentFocusIndex + 1) % this.activeEmojiButtons.length;
            } else if (key === Clutter.KEY_Left) {
                targetIndex = (this.currentFocusIndex - 1 + this.activeEmojiButtons.length) % this.activeEmojiButtons.length;
            } else if (key === Clutter.KEY_Down) {
                targetIndex = Math.min(this.currentFocusIndex + 8, this.activeEmojiButtons.length - 1);
            } else if (key === Clutter.KEY_Up) {
                targetIndex = Math.max(this.currentFocusIndex - 8, 0);
            }
            this.updateFocus(targetIndex);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    closePicker() {
        if (this.overlay) {
            this.overlay.destroy();
        }
    }

    destroy() {
        if (this._searchTimerId) {
            this.timers.remove(this._searchTimerId);
            this._searchTimerId = null;
        }
        if (this.folderMenu._emojiOverlay === this.overlay) {
            this.folderMenu._emojiOverlay = null;
        }
        if (this.folderMenu.menuContainer) {
            this.folderMenu.menuContainer.show();
        }
    }
}

export class FolderMenuBuilder {
    constructor(folderMenu) {
        this.folderMenu = folderMenu;
        this.dockUI = folderMenu.dockUI;
        this.folderData = folderMenu.folderData;
        this.panel = folderMenu.panel;
        this.timers = folderMenu.timers;
    }

    buildMenu() {
        const titleBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 16px; min-height: 32px;'
        });
        const titleStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true
        });

        const displayBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;'
        });
        const nameLabel = new St.Label({
            text: this.folderData.name,
            style: 'font-weight: bold; font-size: 16px; color: white;',
            y_align: Clutter.ActorAlign.CENTER
        });
        const editBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                icon_size: 14
            }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });
        const iconBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'insert-image-symbolic',
                icon_size: 14
            }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });

        const emojiBtn = new St.Button({
            child: new St.Label({
                text: '😀',
                style: 'font-size: 14px;'
            }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });

        editBtn.connectObject('notify::hover', () => editBtn.set_style(editBtn.hover ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);' : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);'), this);
        iconBtn.connectObject('notify::hover', () => {
            if (!iconBtn.has_style_class_name('selected-image')) iconBtn.set_style(iconBtn.hover ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);' : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);');
        }, this);
        emojiBtn.connectObject('notify::hover', () => emojiBtn.set_style(emojiBtn.hover ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);' : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);'), this);

        displayBox.add_child(nameLabel);
        displayBox.add_child(editBtn);
        displayBox.add_child(iconBtn);
        displayBox.add_child(emojiBtn);

        const editBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px;',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER
        });
        const nameEntry = new St.Entry({
            text: this.folderData.name,
            hint_text: 'Name',
            style: 'font-size: 14px; border-radius: 6px; padding: 4px 8px; color: white; background-color: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); width: 140px;'
        });
        const saveBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 14
            }),
            style: 'background-color: rgba(46, 139, 87, 0.9); color: white; border-radius: 6px; padding: 6px; font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });

        editBox.add_child(nameEntry);
        editBox.add_child(saveBtn);
        titleStack.add_child(displayBox);
        titleStack.add_child(editBox);
        titleBox.add_child(titleStack);
        this.panel.add_child(titleBox);

        let selectedIcon = this.folderData.icon;

        iconBtn.connectObject('clicked', () => {
            this.folderMenu.hide();
            if (this.dockUI) this.dockUI._pauseAutoHide = true;
            const proc = Gio.Subprocess.new(['zenity', '--file-selection', '--title=Select Custom Folder Icon', '--file-filter=Images | *.png *.svg *.ico'], Gio.SubprocessFlags.STDOUT_PIPE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                if (this.dockUI) this.dockUI._pauseAutoHide = false;
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout && stdout.trim()) {
                        const pickedPath = stdout.trim();
                        const ext = pickedPath.split('.').pop().toLowerCase();
                        const configDir = `${GLib.get_user_config_dir()}/dhruva@narkagni/icon`;
                        GLib.mkdir_with_parents(configDir, 0o755);
                        const destPath = `${configDir}/folder_icon_${Date.now()}.${ext}`;
                        Gio.File.new_for_path(pickedPath).copy(Gio.File.new_for_path(destPath), Gio.FileCopyFlags.OVERWRITE, null, null);
                        selectedIcon = destPath;
                        this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, selectedIcon);
                        this.dockUI.queueRender();
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        }, this);

        editBtn.connectObject('clicked', () => {
            displayBox.visible = false;
            editBox.visible = true;
            global.stage.set_key_focus(nameEntry);
        }, this);

        const commitSave = () => {
            const newName = nameEntry.get_text() || 'New Folder';
            this.folderData.name = newName;
            this.dockUI.folderManager.updateFolder(this.folderData.id, newName, selectedIcon);
            nameLabel.set_text(newName);
            displayBox.visible = true;
            editBox.visible = false;
            this.dockUI.queueRender();
        };

        saveBtn.connectObject('clicked', commitSave, this);
        nameEntry.clutter_text.connectObject('activate', commitSave, this);

        emojiBtn.connectObject('clicked', () => {
            this.showEmojiPicker((selectedEmoji) => {
                try {
                    const configDir = `${GLib.get_user_config_dir()}/dhruva@narkagni/icon`;
                    GLib.mkdir_with_parents(configDir, 0o755);
                    const destPath = `${configDir}/emoji_${Date.now()}.png`;

                    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, 128, 128);
                    const cr = new cairo.Context(surface);

                    const layout = PangoCairo.create_layout(cr);
                    layout.set_text(selectedEmoji, -1);
                    const fontDesc = Pango.FontDescription.from_string('Noto Color Emoji 83');
                    layout.set_font_description(fontDesc);

                    const [width, height] = layout.get_pixel_size();
                    cr.moveTo((128 - width) / 2, (128 - height) / 2);
                    PangoCairo.show_layout(cr, layout);

                    surface.writeToPNG(destPath);
                    cr.$dispose();

                    this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, destPath);
                    this.dockUI.queueRender();
                } catch (e) {
                    this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, `emoji:${selectedEmoji}`);
                    this.dockUI.queueRender();
                } finally {
                    this.folderMenu.hide();
                }
            });
        }, this);

        this.folderMenu.gridMasterBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 8px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        this.panel.add_child(this.folderMenu.gridMasterBox);
        this.refreshGrid();
    }

    showEmojiPicker(onSelect) {
        const picker = new EmojiPicker(this.folderMenu, onSelect);
        picker.show().catch();
    }

    refreshGrid() {
        this.folderData = this.folderMenu.folderData;
        const oldPositions = new Map();
        if (this.folderMenu.gridMasterBox.get_n_children() > 0) {
            this.folderMenu.gridMasterBox.get_children().forEach(row => {
                row.get_children().forEach(btn => {
                    if (btn._appId) {
                        const [x, y] = btn.get_transformed_position();
                        oldPositions.set(btn._appId, { x, y });
                    }
                });
            });
        }

        this.folderMenu.gridMasterBox.destroy_all_children();

        if (!this.folderMenu.gridMasterBox._delegate) {
            this.folderMenu.gridMasterBox._delegate = {
                handleDragOver: (source) => {
                    if (source && source.inFolder && source.folderId === this.folderData.id) {
                        return DND.DragMotionResult.MOVE_DROP;
                    }
                    return DND.DragMotionResult.CONTINUE;
                },
                acceptDrop: (source) => {
                    const srcAppId = source.appId;
                    if (!source || !source.inFolder || source.folderId !== this.folderData.id) return false;

                    const toIndex = this.folderMenu._dragCurrentIndex;
                    let appsArray = this.folderData.apps;

                    const fromIndex = appsArray.indexOf(srcAppId);

                    if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                        appsArray.splice(fromIndex, 1);
                        appsArray.splice(toIndex, 0, srcAppId);

                        this.folderData.apps = [...new Set(appsArray)];

                        this.folderMenu._saveFolderState();
                    }
                    this.folderMenu.forceRefresh();
                    return true;
                }
            };
        }

        const iconSize = this.dockUI.settings.get_int('icon-size') || 48;
        const appsPerRow = 5;

        let currentRow = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px;'
        });
        currentRow._delegate = this.folderMenu.gridMasterBox._delegate;
        this.folderMenu.gridMasterBox.add_child(currentRow);

        let count = 0;
        const allFolderBtns = [];

        this.folderData.apps = [...new Set(this.folderData.apps)];

        this.folderData.apps.forEach((appId) => {
            const app = this.dockUI.appManager.appSystem.lookup_app(appId);
            if (!app) return;

            if (count > 0 && count % appsPerRow === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    style: 'spacing: 8px;'
                });
                currentRow._delegate = this.folderMenu.gridMasterBox._delegate;
                this.folderMenu.gridMasterBox.add_child(currentRow);
            }
            count++;

            const iconWrapper = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                width: iconSize,
                height: iconSize + 24
            });

            const iconBin = new St.Bin({
                child: app.create_icon_texture(iconSize),
                reactive: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                width: iconSize,
                height: iconSize
            });
            iconWrapper.add_child(iconBin);

            const isRunning = app.get_state() === Shell.AppState.RUNNING || app.get_windows().length > 0;
            if (isRunning) {
                const indProps = this.dockUI._getIndicatorProps();
                const dotContainer = new St.Widget({
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.END,
                    x_expand: true,
                    y_expand: true,
                    layout_manager: new Clutter.BinLayout()
                });

                const dot = new St.Widget({
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.END,
                    x_expand: false,
                    y_expand: false
                });
                dot.set_size(indProps.dw, indProps.dh);
                dot.set_style(`${indProps.style}`);
                dotContainer.add_child(dot);
                iconWrapper.add_child(dotContainer);
            }

            const btn = new St.Button({
                child: iconWrapper,
                reactive: true,
                style: 'border-radius: 8px; padding: 6px; background-color: transparent;'
            });

            btn._appId = appId;
            btn._inFolder = true;
            btn._folderId = this.folderData.id;
            btn._folderName = this.folderData.name;

            btn.set_pivot_point(0.5, 0.5);

            btn.connectObject('notify::hover', () => {
                if (!btn._isTargetHovered) {
                    btn.set_style(btn.hover ? 'background-color: rgba(255,255,255,0.15); border-radius: 8px; padding: 6px;' : 'background-color: transparent; border-radius: 8px; padding: 6px;');
                }
            }, this);

            btn.connectObject('clicked', () => {
                if (btn._wasDragged) {
                    btn._wasDragged = false;
                    return;
                }
                app.activate();
                this.folderMenu.hide();
            }, this);

            btn.connectObject('button-press-event', (_actor, event) => {
                if (event.get_button() === 3) {
                    if (this.dockUI._activeContextMenu) this.dockUI._activeContextMenu.hide();
                    this.dockUI._activeContextMenu = new AppContextMenu(this.dockUI, app, btn);
                    this.dockUI._activeContextMenu.show(this.dockUI.dockPosition);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            btn._delegate = {
                appId: appId,
                isFolderItem: true,
                inFolder: true,
                folderId: this.folderData.id,
                actor: btn,

                getDragActor: () => {
                    const clone = new Clutter.Clone({ source: iconWrapper });
                    clone.reactive = false;
                    return clone;
                },
                getDragActorSource: () => {
                    return btn;
                },

                handleDragOver: (source) => {
                    const srcAppId = source.appId;
                    const srcFolderId = source.folderId;
                    const srcInFolder = source.inFolder;

                    if (srcInFolder && srcFolderId === this.folderData.id) {
                        if (srcAppId === btn._appId) {
                            return DND.DragMotionResult.NO_DROP;
                        }

                        const toIndex = allFolderBtns.indexOf(btn);
                        const fromIndex = this.folderMenu._dragCurrentIndex;

                        if (toIndex !== -1 && this.folderMenu._dragStartIndex !== undefined && toIndex !== fromIndex) {
                            this.folderMenu._dragCurrentIndex = toIndex;

                            const start = this.folderMenu._dragStartIndex;
                            const end = toIndex;

                            allFolderBtns.forEach((b, i) => {
                                if (i === start) return;

                                let visualIndex = i;
                                if (start < end) {
                                    if (i > start && i <= end) visualIndex = i - 1;
                                } else if (start > end) {
                                    if (i >= end && i < start) visualIndex = i + 1;
                                }

                                const targetBtn = allFolderBtns[visualIndex];
                                if (targetBtn && targetBtn._startX !== undefined && b._startX !== undefined) {
                                    const tx = targetBtn._startX - b._startX;
                                    const ty = targetBtn._startY - b._startY;

                                    b.remove_transition('translation-x');
                                    b.remove_transition('translation-y');

                                    b.ease({
                                        translation_x: tx,
                                        translation_y: ty,
                                        duration: 250,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                                    });
                                }
                            });
                        }

                        if (!btn._isTargetHovered) {
                            btn._isTargetHovered = true;
                        }
                        return DND.DragMotionResult.MOVE_DROP;
                    }
                    return DND.DragMotionResult.CONTINUE;
                },

                handleDragOut: () => {
                    if (btn._isTargetHovered) {
                        btn._isTargetHovered = false;
                    }
                },

                acceptDrop: (source) => {
                    const srcAppId = source.appId;
                    if (!source.inFolder || source.folderId !== this.folderData.id || srcAppId === btn._appId) {
                        return false;
                    }

                    let appsArray = this.folderData.apps;

                    const fromIndex = appsArray.indexOf(srcAppId);
                    const toIndex = allFolderBtns.indexOf(btn);

                    if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                        appsArray.splice(fromIndex, 1);
                        appsArray.splice(toIndex, 0, srcAppId);

                        this.folderData.apps = [...new Set(appsArray)];

                        this.folderMenu._saveFolderState();
                    }
                    this.folderMenu.forceRefresh();
                    return true;
                }
            };

            const draggable = DND.makeDraggable(btn, { restoreOnSuccess: true });

            draggable.connectObject('drag-begin', () => {
                btn._wasDragged = true;
                btn.opacity = 0;

                this.folderMenu._dragStartIndex = allFolderBtns.indexOf(btn);
                this.folderMenu._dragCurrentIndex = this.folderMenu._dragStartIndex;

                allFolderBtns.forEach((b) => {
                    const [absX, absY] = b.get_transformed_position();
                    b._startX = absX;
                    b._startY = absY;
                    b.remove_all_transitions();
                });
            }, this);

            draggable.connectObject('drag-cancelled', () => {
                btn.opacity = 255;
                allFolderBtns.forEach(b => {
                    b.remove_transition('translation-x');
                    b.remove_transition('translation-y');
                    b.ease({
                        translation_x: 0,
                        translation_y: 0,
                        duration: 250,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                });
            }, this);

            draggable.connectObject('drag-end', () => {
                btn.opacity = 255;
            }, this);

            allFolderBtns.push(btn);
            currentRow.add_child(btn);
        });

        this.folderMenu.gridMasterBox.queue_relayout();

        if (oldPositions.size > 0) {
            this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this.folderMenu.gridMasterBox) {
                    return GLib.SOURCE_REMOVE;
                }

                allFolderBtns.forEach(btn => {
                    if (!btn) return;

                    const oldPos = oldPositions.get(btn._appId);
                    if (oldPos) {
                        const [newX, newY] = btn.get_transformed_position();

                        if (Math.abs(oldPos.x - newX) > 1 || Math.abs(oldPos.y - newY) > 1) {
                            btn.translation_x = oldPos.x - newX;
                            btn.translation_y = oldPos.y - newY;

                            btn.ease({
                                translation_x: 0,
                                translation_y: 0,
                                duration: 350,
                                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
                            });
                        }
                    } else {
                        btn.set_scale(0.5, 0.5);
                        btn.opacity = 0;
                        btn.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            opacity: 255,
                            duration: 250,
                            mode: Clutter.AnimationMode.EASE_OUT_BACK
                        });
                    }
                });
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}