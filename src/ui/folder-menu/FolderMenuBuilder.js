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


export function buildMenu(folderMenu) {
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
        text: folderMenu.folderData.name,
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

    editBtn.connect('notify::hover', () => editBtn.set_style(editBtn.hover ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);' : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);'));
    iconBtn.connect('notify::hover', () => {
        if (!iconBtn.has_style_class_name('selected-image')) iconBtn.set_style(iconBtn.hover ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);' : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);');
    });
    emojiBtn.connect('notify::hover', () => emojiBtn.set_style(emojiBtn.hover ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);' : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);'));

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
        text: folderMenu.folderData.name,
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
    folderMenu.panel.add_child(titleBox);

    let selectedIcon = folderMenu.folderData.icon;

    iconBtn.connect('clicked', () => {
        folderMenu.hide();
        if (folderMenu.dockUI) folderMenu.dockUI._pauseAutoHide = true;
        const proc = Gio.Subprocess.new(['zenity', '--file-selection', '--title=Select Custom Folder Icon', '--file-filter=Images | *.png *.svg *.ico'], Gio.SubprocessFlags.STDOUT_PIPE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            if (folderMenu.dockUI) folderMenu.dockUI._pauseAutoHide = false;
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
                    folderMenu.dockUI.folderManager.updateFolder(folderMenu.folderData.id, folderMenu.folderData.name, selectedIcon);
                    folderMenu.dockUI.queueRender();
                }
            } catch (e) {
                console.error(e);
            }
        });
    });

    editBtn.connect('clicked', () => {
        displayBox.visible = false;
        editBox.visible = true;
        global.stage.set_key_focus(nameEntry);
    });

    const commitSave = () => {
        const newName = nameEntry.get_text() || 'New Folder';
        folderMenu.folderData.name = newName;
        folderMenu.dockUI.folderManager.updateFolder(folderMenu.folderData.id, newName, selectedIcon);
        nameLabel.set_text(newName);
        displayBox.visible = true;
        editBox.visible = false;
        folderMenu.dockUI.queueRender();
    };

    saveBtn.connect('clicked', commitSave);
    nameEntry.clutter_text.connect('activate', commitSave);

    emojiBtn.connect('clicked', () => {
        showEmojiPicker(folderMenu, (selectedEmoji) => {
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

                folderMenu.dockUI.folderManager.updateFolder(folderMenu.folderData.id, folderMenu.folderData.name, destPath);
                folderMenu.dockUI.queueRender();
            } catch (e) {
                folderMenu.dockUI.folderManager.updateFolder(folderMenu.folderData.id, folderMenu.folderData.name, `emoji:${selectedEmoji}`);
                folderMenu.dockUI.queueRender();
            } finally {
                folderMenu.hide();
            }
        }).catch();
    });

    folderMenu.gridMasterBox = new St.BoxLayout({
        vertical: true,
        style: 'spacing: 8px;',
        x_align: Clutter.ActorAlign.CENTER
    });
    folderMenu.panel.add_child(folderMenu.gridMasterBox);
    refreshGrid(folderMenu);
}

export async function showEmojiPicker(folderMenu, onSelect) {
    if (folderMenu.menuContainer) folderMenu.menuContainer.hide();

    let emojiList = [];
    let categories = ['All'];

    try {
        const emojiFile = Gio.File.new_for_path(`${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/dhruva@narkagni/src/ui/emojis.json`);

        const readContentsAsync = (file) => {
            return new Promise((resolve) => {
                if (!file.query_exists(null)) {
                    resolve(null);
                    return;
                }
                file.load_contents_async(null, (obj, res) => {
                    try {
                        const [success, contents] = obj.load_contents_finish(res);
                        resolve(success ? contents : null);
                    } catch (_e) {
                        resolve(null);
                    }
                });
            });
        };

        const contents = await readContentsAsync(emojiFile);
        if (contents) {
            const decoder = new TextDecoder('utf-8');
            const parsed = JSON.parse(decoder.decode(contents));
            emojiList = parsed.emojis || [];
            const cats = new Set();
            emojiList.forEach(e => {
                if (e.category) cats.add(e.category);
            });
            categories = ['All', ...Array.from(cats)];
        }
    } catch (_e) {
        emojiList = [{
            emoji: '😀',
            name: 'grinning face',
            category: 'Smileys'
        }, {
            emoji: '📁',
            name: 'folder',
            category: 'Objects'
        }];
        categories = ['All', 'Smileys', 'Objects'];
    }

    let currentCategory = 'All';
    let activeEmojiButtons = [];
    let currentFocusIndex = -1;

    const overlay = new St.Widget({
        reactive: true,
        style: 'background-color: rgba(0,0,0,0.6);'
    });
    overlay.add_constraint(new Clutter.BindConstraint({
        source: global.stage,
        coordinate: Clutter.BindCoordinate.ALL
    }));
    overlay.set_layout_manager(new Clutter.BinLayout());
    Main.layoutManager.addChrome(overlay, {
        affectsStruts: false
    });
    folderMenu._emojiOverlay = overlay;

    const clearEmojiSearchTimer = () => {
        if (folderMenu._emojiSearchTimerId) {
            GLib.source_remove(folderMenu._emojiSearchTimerId);
            folderMenu._emojiSearchTimerId = null;
        }
    };

    const closePicker = () => {
        clearEmojiSearchTimer();
        if (folderMenu._emojiOverlay === overlay) folderMenu._emojiOverlay = null;
        overlay.destroy();
        if (folderMenu.menuContainer) folderMenu.menuContainer.show();
    };

    overlay.connect('destroy', () => {
        clearEmojiSearchTimer();
        if (folderMenu._emojiOverlay === overlay) folderMenu._emojiOverlay = null;
    });

    const tooltipCss = folderMenu.dockUI.actor._tooltipBg || 'background-color: rgba(20,20,30,0.97);';

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
    dropdownBox.connect('button-release-event', () => Clutter.EVENT_STOP);

    overlay.connect('button-release-event', () => {
        if (dropdownBox.visible) {
            dropdownBox.visible = false;
            return Clutter.EVENT_STOP;
        }
        closePicker();
        return Clutter.EVENT_STOP;
    });

    picker.connect('button-release-event', () => {
        if (dropdownBox.visible) dropdownBox.visible = false;
        return Clutter.EVENT_STOP;
    });

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

    categories.forEach(cat => {
        const btn = new St.Button({
            child: new St.Label({
                text: cat,
                style: 'color: white; font-size: 14px; font-weight: bold; text-shadow: 0 1px 2px rgba(0,0,0,0.5);'
            }),
            style: 'padding: 8px 14px; border-radius: 6px;',
            reactive: true
        });
        btn.connect('notify::hover', () => btn.set_style(btn.hover ? 'padding: 8px 14px; border-radius: 6px; background-color: rgba(255,255,255,0.15);' : 'padding: 8px 14px; border-radius: 6px; background-color: transparent;'));
        btn.connect('clicked', () => {
            currentCategory = cat;
            catLabel.set_text(cat);
            dropdownBox.visible = false;
            _populateGrid(searchEntry.get_text(), currentCategory);
        });
        ddInnerBox.add_child(btn);
    });

    catBtn.connect('clicked', () => {
        dropdownBox.visible = !dropdownBox.visible;
        if (dropdownBox.visible) {
            const [px, py] = catBtn.get_transformed_position();
            const [, ph] = catBtn.get_transformed_size();
            dropdownBox.set_position(px, py + ph + 8);
        }
    });

    const scrollView = new St.ScrollView({
        style: 'height: 400px;',
        x_expand: true,
        y_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.NEVER
    });

    const gridContainer = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style: 'padding-right: 0px; padding-bottom: 16px;'
    });
    scrollView.add_child(gridContainer);
    picker.add_child(scrollView);

    const detailBox = new St.BoxLayout({
        vertical: false,
        style: 'margin-top: 16px; padding: 10px 14px; border-radius: 10px; background-color: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.05);',
        y_align: Clutter.ActorAlign.CENTER
    });
    const bigEmojiLabel = new St.Label({
        text: '✨',
        style: 'font-size: 32px; margin-right: 14px;'
    });
    const textDetailBox = new St.BoxLayout({
        vertical: true,
        x_expand: true
    });
    const emojiNameLabel = new St.Label({
        text: 'Hover an emoji',
        style: 'font-size: 14px; font-weight: bold; color: white;'
    });
    const emojiCatLabel = new St.Label({
        text: 'Category',
        style: 'font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px;'
    });

    textDetailBox.add_child(emojiNameLabel);
    textDetailBox.add_child(emojiCatLabel);
    detailBox.add_child(bigEmojiLabel);
    detailBox.add_child(textDetailBox);
    picker.add_child(detailBox);

    const updateFocus = (newIndex) => {
        if (activeEmojiButtons.length === 0) return;

        if (currentFocusIndex >= 0 && activeEmojiButtons[currentFocusIndex]) {
            const oldBtn = activeEmojiButtons[currentFocusIndex];
            oldBtn.set_style(oldBtn._baseStyle);
        }

        if (newIndex >= 0 && activeEmojiButtons[newIndex]) {
            currentFocusIndex = newIndex;
            const newBtn = activeEmojiButtons[newIndex];

            newBtn.set_style(`${newBtn._baseStyle} background-color: rgba(255,255,255,0.25); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.4);`);

            bigEmojiLabel.set_text(newBtn._emojiData.emoji);
            emojiNameLabel.set_text(newBtn._emojiData.name);
            emojiCatLabel.set_text(newBtn._emojiData.category);

            let adj = null;
            if (scrollView.get_vadjustment) {
                adj = scrollView.get_vadjustment();
            } else if (scrollView.get_vscroll_bar) {
                adj = scrollView.get_vscroll_bar().get_adjustment();
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
    };

    const handleKeyPress = (_actor, event) => {
        const key = event.get_key_symbol();
        if (activeEmojiButtons.length === 0) return Clutter.EVENT_PROPAGATE;

        if (key === Clutter.KEY_Escape) {
            closePicker();
            return Clutter.EVENT_STOP;
        }

        if ([Clutter.KEY_Up, Clutter.KEY_Down, Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Return, Clutter.KEY_KP_Enter].includes(key)) {
            let targetIndex = currentFocusIndex;
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                if (currentFocusIndex >= 0) activeEmojiButtons[currentFocusIndex].emit('clicked', 0);
            } else if (key === Clutter.KEY_Right) {
                targetIndex = (currentFocusIndex + 1) % activeEmojiButtons.length;
            } else if (key === Clutter.KEY_Left) {
                targetIndex = (currentFocusIndex - 1 + activeEmojiButtons.length) % activeEmojiButtons.length;
            } else if (key === Clutter.KEY_Down) {
                targetIndex = Math.min(currentFocusIndex + 8, activeEmojiButtons.length - 1);
            } else if (key === Clutter.KEY_Up) {
                targetIndex = Math.max(currentFocusIndex - 8, 0);
            }
            updateFocus(targetIndex);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    };

    overlay.connect('key-press-event', handleKeyPress);
    searchEntry.connect('key-press-event', handleKeyPress);

    const _populateGrid = (filterText, filterCat) => {
        gridContainer.destroy_all_children();
        activeEmojiButtons = [];
        currentFocusIndex = -1;
        let filtered = emojiList.filter(e => (filterCat === 'All' || e.category === filterCat));
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
                gridContainer.add_child(currentRow);
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
            btn.connect('notify::hover', () => {
                if (btn.hover) updateFocus(btn._btnIndex);
            });
            btn.connect('clicked', () => {
                onSelect(emoji);
                overlay.destroy();
            });
            activeEmojiButtons.push(btn);
            currentRow.add_child(btn);
        });
        if (activeEmojiButtons.length > 0) updateFocus(0);
    };

    _populateGrid('', currentCategory);
    searchEntry.clutter_text.connect('text-changed', () => {
        if (folderMenu._emojiSearchTimerId) GLib.source_remove(folderMenu._emojiSearchTimerId);
        folderMenu._emojiSearchTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            _populateGrid(searchEntry.get_text(), currentCategory);
            folderMenu._emojiSearchTimerId = null;
            return GLib.SOURCE_REMOVE;
        });
    });

    overlay.add_child(picker);
    overlay.add_child(ddWrapper);
    global.stage.set_key_focus(searchEntry);
}

export function refreshGrid(folderMenu) {
    const oldPositions = new Map();
    if (folderMenu.gridMasterBox.get_n_children() > 0) {
        folderMenu.gridMasterBox.get_children().forEach(row => {
            row.get_children().forEach(btn => {
                if (btn._appId) {
                    const [x, y] = btn.get_transformed_position();
                    oldPositions.set(btn._appId, { x, y });
                }
            });
        });
    }

    folderMenu.gridMasterBox.destroy_all_children();

    if (!folderMenu.gridMasterBox._delegate) {
        folderMenu.gridMasterBox._delegate = {
            handleDragOver: function(source) {
                if (source && source.inFolder && source.folderId === folderMenu.folderData.id) {
                    return DND.DragMotionResult.MOVE_DROP;
                }
                return DND.DragMotionResult.CONTINUE;
            },
            acceptDrop: function(source) {
                const srcAppId = source.appId;
                if (!source || !source.inFolder || source.folderId !== folderMenu.folderData.id) return false;

                const toIndex = folderMenu._dragCurrentIndex;
                let appsArray = folderMenu.folderData.apps;
 
                const fromIndex = appsArray.indexOf(srcAppId);

                if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                    appsArray.splice(fromIndex, 1);
                    appsArray.splice(toIndex, 0, srcAppId);

                    folderMenu.folderData.apps = [...new Set(appsArray)];
                    
                    folderMenu._saveFolderState();
                }
                folderMenu.forceRefresh(); 
                return true;
            }
        };
    }

    const iconSize = folderMenu.dockUI.settings.get_int('icon-size') || 48;
    const appsPerRow = 5;
    
    let currentRow = new St.BoxLayout({
        vertical: false,
        style: 'spacing: 8px;'
    });
    currentRow._delegate = folderMenu.gridMasterBox._delegate;
    folderMenu.gridMasterBox.add_child(currentRow);

    let count = 0;
    const allFolderBtns = [];

    folderMenu.folderData.apps = [...new Set(folderMenu.folderData.apps)];

    folderMenu.folderData.apps.forEach((appId) => {
        const app = folderMenu.dockUI.appManager.appSystem.lookup_app(appId);
        if (!app) return;

        if (count > 0 && count % appsPerRow === 0) {
            currentRow = new St.BoxLayout({
                vertical: false,
                style: 'spacing: 8px;'
            });
            currentRow._delegate = folderMenu.gridMasterBox._delegate;
            folderMenu.gridMasterBox.add_child(currentRow);
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
            const indProps = folderMenu.dockUI._getIndicatorProps();
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
        btn._folderId = folderMenu.folderData.id;
        btn._folderName = folderMenu.folderData.name;
        
        btn.set_pivot_point(0.5, 0.5);

        btn.connect('notify::hover', () => {
            if (!btn._isTargetHovered) {
                btn.set_style(btn.hover ? 'background-color: rgba(255,255,255,0.15); border-radius: 8px; padding: 6px;' : 'background-color: transparent; border-radius: 8px; padding: 6px;');
            }
        });

        btn.connect('clicked', () => {
            if (btn._wasDragged) {
                btn._wasDragged = false;
                return;
            }
            app.activate();
            folderMenu.hide();
        });

        btn.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                if (folderMenu.dockUI._activeContextMenu) folderMenu.dockUI._activeContextMenu.hide();
                folderMenu.dockUI._activeContextMenu = new AppContextMenu(folderMenu.dockUI, app, btn);
                folderMenu.dockUI._activeContextMenu.show(folderMenu.dockUI.dockPosition);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        btn._delegate = {
            appId: appId,
            isFolderItem: true,
            inFolder: true,
            folderId: folderMenu.folderData.id,
            actor: btn,
            
            getDragActor: function() {
                const clone = new Clutter.Clone({ source: iconWrapper });
                clone.reactive = false; 
                return clone;
            },
            getDragActorSource: function() { 
                return btn; 
            },

            handleDragOver: function(source) {
                const srcAppId = source.appId;
                const srcFolderId = source.folderId;
                const srcInFolder = source.inFolder;
                
                if (srcInFolder && srcFolderId === folderMenu.folderData.id) {
                    if (srcAppId === btn._appId) {
                        return DND.DragMotionResult.NO_DROP;
                    }
                    
                    const toIndex = allFolderBtns.indexOf(btn);
                    const fromIndex = folderMenu._dragCurrentIndex;
                    
                    if (toIndex !== -1 && folderMenu._dragStartIndex !== undefined && toIndex !== fromIndex) {
                        folderMenu._dragCurrentIndex = toIndex;
                        
                        const start = folderMenu._dragStartIndex;
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

            handleDragOut: function() {
                if (btn._isTargetHovered) {
                    btn._isTargetHovered = false;
                }
            },
            
            acceptDrop: function(source) {
                const srcAppId = source.appId;
                if (!source.inFolder || source.folderId !== folderMenu.folderData.id || srcAppId === btn._appId) {
                    return false;
                }

                let appsArray = folderMenu.folderData.apps;

                const fromIndex = appsArray.indexOf(srcAppId);
                const toIndex = allFolderBtns.indexOf(btn);

                if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                    appsArray.splice(fromIndex, 1);
                    appsArray.splice(toIndex, 0, srcAppId);
  
                    folderMenu.folderData.apps = [...new Set(appsArray)];
                    
                    folderMenu._saveFolderState();
                }
                folderMenu.forceRefresh(); 
                return true;
            }
        };

        const draggable = DND.makeDraggable(btn, { restoreOnSuccess: true });
        
        draggable.connect('drag-begin', () => {
            btn._wasDragged = true;
            btn.opacity = 0; 
            
            folderMenu._dragStartIndex = allFolderBtns.indexOf(btn);
            folderMenu._dragCurrentIndex = folderMenu._dragStartIndex;
            
            allFolderBtns.forEach((b) => {
                const [absX, absY] = b.get_transformed_position();
                b._startX = absX;
                b._startY = absY;
                b.remove_all_transitions();
            });
        });

        draggable.connect('drag-cancelled', () => {
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
        });

        draggable.connect('drag-end', () => {
            btn.opacity = 255;
        });

        allFolderBtns.push(btn);
        currentRow.add_child(btn);
    });

    folderMenu.gridMasterBox.queue_relayout();

    if (oldPositions.size > 0) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!folderMenu.gridMasterBox || (folderMenu.gridMasterBox.is_destroyed && folderMenu.gridMasterBox.is_destroyed())) {
                return GLib.SOURCE_REMOVE;
            }
            
            allFolderBtns.forEach(btn => {
                if (!btn || (btn.is_destroyed && btn.is_destroyed())) return;
                
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