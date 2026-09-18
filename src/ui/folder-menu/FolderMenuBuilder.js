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
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EmojiPicker } from './EmojiPicker.js';
import { Settings } from '../../core/SettingsManager.js';
import { getIndicatorProps } from '../dock/DockRenderer.js';
import { createIndicatorBox } from '../dock/DockButtonBase.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { setBoxVertical, isActorAlive } from '../../core/Utils.js';


const APPS_PER_ROW = 5;
const EMOJI_TEXTURE_DIM = 128;
const ENTRY_DURATION_MS = 260;

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
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 16px; min-height: 32px;'
        });
        setBoxVertical(titleBox, false);

        const titleStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true
        });

        const displayBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;'
        });
        setBoxVertical(displayBox, false);

        const nameLabel = new St.Label({
            text: this.folderData.name,
            style: 'font-weight: bold; font-size: 16px; color: white;',
            y_align: Clutter.ActorAlign.CENTER
        });

        const editBtn = new St.Button({
            child: new St.Icon({ icon_name: 'document-edit-symbolic', icon_size: 14 }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });

        const iconBtn = new St.Button({
            child: new St.Icon({ icon_name: 'insert-image-symbolic', icon_size: 14 }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });

        const emojiBtn = new St.Button({
            child: new St.Label({ text: '😀', style: 'font-size: 14px;' }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true
        });

        editBtn.connectObject('notify::hover', () => {
            if (!isActorAlive(editBtn)) return;
            editBtn.set_style(editBtn.hover
                ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);'
                : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);');
        }, this);

        iconBtn.connectObject('notify::hover', () => {
            if (!isActorAlive(iconBtn)) return;
            if (!iconBtn.has_style_class_name('selected-image')) {
                iconBtn.set_style(iconBtn.hover
                    ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);'
                    : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);');
            }
        }, this);

        emojiBtn.connectObject('notify::hover', () => {
            if (!isActorAlive(emojiBtn)) return;
            emojiBtn.set_style(emojiBtn.hover
                ? 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.25);'
                : 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.08);');
        }, this);

        displayBox.add_child(nameLabel);
        displayBox.add_child(editBtn);
        displayBox.add_child(iconBtn);
        displayBox.add_child(emojiBtn);

        const editBox = new St.BoxLayout({
            style: 'spacing: 8px;',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER
        });
        setBoxVertical(editBox, false);

        const nameEntry = new St.Entry({
            text: this.folderData.name,
            hint_text: _('Name'),
            style: 'font-size: 14px; border-radius: 6px; padding: 4px 8px; color: white; background-color: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); width: 140px;'
        });

        const saveBtn = new St.Button({
            child: new St.Icon({ icon_name: 'object-select-symbolic', icon_size: 14 }),
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
        const uuid = (this.dockUI.appManager && this.dockUI.appManager.uuid) || 'dhruva@narkagni';
        const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid, 'icon']);

        iconBtn.connectObject('clicked', () => {
            this.folderMenu.hide();
            const zenityPath = GLib.find_program_in_path('zenity');
            if (!zenityPath) {
                Main.notifyError('Dhruva', _('zenity is required for file selection dialogs.'));
                return;
            }

            const proc = Gio.Subprocess.new(['zenity', '--file-selection', '--title=Select Custom Folder Icon', '--file-filter=Images | *.png *.svg *.ico'], Gio.SubprocessFlags.STDOUT_PIPE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout && stdout.trim()) {
                        const pickedPath = stdout.trim();
                        const ext = pickedPath.split('.').pop().toLowerCase();
                        GLib.mkdir_with_parents(configDir, 0o755);
                        const destPath = GLib.build_filenamev([configDir, `folder_icon_${Date.now()}.${ext}`]);

                        const srcFile = Gio.File.new_for_path(pickedPath);
                        const destFile = Gio.File.new_for_path(destPath);

                        srcFile.copy_async(destFile, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (f, copyRes) => {
                            try {
                                f.copy_finish(copyRes);
                                selectedIcon = destPath;
                                this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, selectedIcon);
                                this.dockUI.queueRender('incremental');
                            } catch (err) {
                                console.error('[Dhruva]', err);
                            }
                        });
                    }
                } catch (e) {
                    console.error('[Dhruva]', e);
                }
            });
        }, this);

        editBtn.connectObject('clicked', () => {
            displayBox.visible = false;
            editBox.visible = true;
            global.stage.set_key_focus(nameEntry);
        }, this);

        const commitSave = () => {
            const newName = nameEntry.get_text() || _('New Folder');
            this.folderData.name = newName;
            this.dockUI.folderManager.updateFolder(this.folderData.id, newName, selectedIcon);
            nameLabel.set_text(newName);
            displayBox.visible = true;
            editBox.visible = false;
            this.dockUI.queueRender('incremental');
        };

        saveBtn.connectObject('clicked', commitSave, this);
        nameEntry.clutter_text.connectObject('activate', commitSave, this);

        emojiBtn.connectObject('clicked', () => {
            this.showEmojiPicker((selectedEmoji) => {
                try {
                    GLib.mkdir_with_parents(configDir, 0o755);
                    const destPath = GLib.build_filenamev([configDir, `emoji_${Date.now()}.png`]);

                    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, EMOJI_TEXTURE_DIM, EMOJI_TEXTURE_DIM);
                    const cr = new cairo.Context(surface);

                    const layout = PangoCairo.create_layout(cr);
                    layout.set_text(selectedEmoji, -1);
                    layout.set_font_description(Pango.FontDescription.from_string('Noto Color Emoji 83'));

                    const [width, height] = layout.get_pixel_size();
                    cr.moveTo((EMOJI_TEXTURE_DIM - width) / 2, (EMOJI_TEXTURE_DIM - height) / 2);
                    PangoCairo.show_layout(cr, layout);

                    surface.writeToPNG(destPath);
                    cr.$dispose();

                    this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, destPath);
                    this.dockUI.queueRender('incremental');
                } catch (_e) {
                    this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, `emoji:${selectedEmoji}`);
                    this.dockUI.queueRender('incremental');
                } finally {
                    this.folderMenu.hide();
                }
            });
        }, this);

        this.folderMenu.gridMasterBox = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        setBoxVertical(this.folderMenu.gridMasterBox, true);
        this.panel.add_child(this.folderMenu.gridMasterBox);
        this.refreshGrid(true);
    }

    showEmojiPicker(onSelect) {
        const picker = new EmojiPicker(this.folderMenu, onSelect);
        picker.show().catch(() => {});
    }

    refreshGrid(skipEntryAnimation = false, animatedAppId = null) {
        this.folderData = this.folderMenu.folderData;
        const oldPositions = new Map();

        if (this.folderMenu.gridMasterBox.get_n_children() > 0) {
            this.folderMenu.gridMasterBox.get_children().forEach(row => {
                row.get_children().forEach(btn => {
                    if (btn._appId && isActorAlive(btn)) {
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
                    const appsArray = this.folderData.apps;
                    const fromIndex = appsArray.indexOf(srcAppId);

                    if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                        appsArray.splice(fromIndex, 1);
                        appsArray.splice(toIndex, 0, srcAppId);
                        this.folderData.apps = [...new Set(appsArray)];
                        this.folderMenu._saveFolderState();
                    }
                    this.folderMenu.forceRefresh(true);
                    return true;
                }
            };
        }

        const iconSize = Settings.iconSize || 48;
        let currentRow = new St.BoxLayout({ style: 'spacing: 8px;' });
        setBoxVertical(currentRow, false);
        currentRow._delegate = this.folderMenu.gridMasterBox._delegate;
        this.folderMenu.gridMasterBox.add_child(currentRow);

        let count = 0;
        const allFolderBtns = [];
        this.folderData.apps = [...new Set(this.folderData.apps)];

        this.folderData.apps.forEach((appId) => {
            const app = this.dockUI.appManager.appSystem.lookup_app(appId);
            if (!app) return;

            if (count > 0 && count % APPS_PER_ROW === 0) {
                currentRow = new St.BoxLayout({ style: 'spacing: 8px;' });
                setBoxVertical(currentRow, false);
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
            if (isRunning && Settings.showRunningIndicators) {
                const indProps = getIndicatorProps(this.dockUI, app);
                const windows = app.get_windows();
                const focusWin = global.display.get_focus_window();
                const isFocused = Array.isArray(windows) && windows.some(w => w === focusWin);

                const indStyle = Settings.indicatorStyle || 'dot';
                const count = (indStyle === 'line' || indStyle === 'windows') ? 1 : Math.max(1, windows.length);
                const dotBox = createIndicatorBox(
                    this.dockUI.dockPosition,
                    false,
                    indProps,
                    count,
                    iconSize + 12,
                    isFocused
                );

                iconWrapper.add_child(dotBox);
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

            const isJustAdded = Boolean(animatedAppId && animatedAppId === appId);
            if (isJustAdded) {
                btn.opacity = 0;
                btn.set_scale(0.1, 0.1);
                btn.translation_y = 12;
            } else {
                btn.opacity = 255;
                btn.set_scale(1.0, 1.0);
                btn.translation_y = 0;
            }

            btn.connectObject('notify::hover', () => {
                if (!isActorAlive(btn)) return;
                if (!btn._isTargetHovered) {
                    btn.set_style(btn.hover
                        ? 'background-color: rgba(255,255,255,0.15); border-radius: 8px; padding: 6px;'
                        : 'background-color: transparent; border-radius: 8px; padding: 6px;');
                }
            }, this);

            btn.connectObject('clicked', () => {
                if (!isActorAlive(btn)) return;
                if (btn._wasDragged) {
                    btn._wasDragged = false;
                    return;
                }
                app.activate();
                this.folderMenu.hide();
            }, this);

            btn.connectObject('button-press-event', (_actor, event) => {
                if (!isActorAlive(btn)) return Clutter.EVENT_PROPAGATE;
                if (event.get_button() === 3) {
                    if (this.dockUI._activeContextMenu) this.dockUI._activeContextMenu.hide();
                    this.dockUI._activeContextMenu = new AppContextMenu(this.dockUI, app, btn);
                    this.dockUI._activeContextMenu.show(this.dockUI.dockPosition);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            btn._delegate = {
                appId,
                isFolderItem: true,
                inFolder: true,
                folderId: this.folderData.id,
                actor: btn,
                getDragActor: () => {
                    const clone = new Clutter.Clone({ source: iconWrapper });
                    clone.reactive = false;
                    return clone;
                },
                getDragActorSource: () => btn,
                handleDragOver: (source) => {
                    if (source.inFolder && source.folderId === this.folderData.id) {
                        if (source.appId === btn._appId) return DND.DragMotionResult.NO_DROP;

                        const toIndex = allFolderBtns.indexOf(btn);
                        const fromIndex = this.folderMenu._dragCurrentIndex;

                        if (toIndex !== -1 && this.folderMenu._dragStartIndex !== undefined && toIndex !== fromIndex) {
                            this.folderMenu._dragCurrentIndex = toIndex;
                            const start = this.folderMenu._dragStartIndex;
                            const end = toIndex;

                            allFolderBtns.forEach((b, i) => {
                                if (i === start || !isActorAlive(b)) return;

                                let visualIndex = i;
                                if (start < end) {
                                    if (i > start && i <= end) visualIndex = i - 1;
                                } else if (start > end) {
                                    if (i >= end && i < start) visualIndex = i + 1;
                                }

                                const targetBtn = allFolderBtns[visualIndex];
                                if (targetBtn && isActorAlive(targetBtn) && targetBtn._startX !== undefined && b._startX !== undefined) {
                                    b.remove_transition('translation-x');
                                    b.remove_transition('translation-y');
                                    b.ease({
                                        translation_x: targetBtn._startX - b._startX,
                                        translation_y: targetBtn._startY - b._startY,
                                        duration: 220,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                                    });
                                }
                            });
                        }

                        if (!btn._isTargetHovered) btn._isTargetHovered = true;
                        return DND.DragMotionResult.MOVE_DROP;
                    }
                    return DND.DragMotionResult.CONTINUE;
                },
                handleDragOut: () => {
                    if (isActorAlive(btn) && btn._isTargetHovered) btn._isTargetHovered = false;
                },
                acceptDrop: (source) => {
                    if (!source.inFolder || source.folderId !== this.folderData.id || source.appId === btn._appId) {
                        return false;
                    }

                    const appsArray = this.folderData.apps;
                    const fromIndex = appsArray.indexOf(source.appId);
                    const toIndex = allFolderBtns.indexOf(btn);

                    if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                        appsArray.splice(fromIndex, 1);
                        appsArray.splice(toIndex, 0, source.appId);
                        this.folderData.apps = [...new Set(appsArray)];
                        this.folderMenu._saveFolderState();
                    }
                    this.folderMenu.forceRefresh(true);
                    return true;
                }
            };

            const draggable = DND.makeDraggable(btn, { restoreOnSuccess: true });

            draggable.connectObject('drag-begin', () => {
                if (isActorAlive(btn)) {
                    btn._wasDragged = true;
                    btn.opacity = 0;
                }
                this.folderMenu._dragStartIndex = allFolderBtns.indexOf(btn);
                this.folderMenu._dragCurrentIndex = this.folderMenu._dragStartIndex;

                allFolderBtns.forEach((b) => {
                    if (!isActorAlive(b)) return;
                    const [absX, absY] = b.get_transformed_position();
                    b._startX = absX;
                    b._startY = absY;
                    b.remove_all_transitions();
                });
            }, this);

            draggable.connectObject('drag-cancelled', () => {
                if (isActorAlive(btn)) btn.opacity = 255;
                allFolderBtns.forEach(b => {
                    if (!isActorAlive(b)) return;
                    b.remove_transition('translation-x');
                    b.remove_transition('translation-y');
                    b.ease({
                        translation_x: 0,
                        translation_y: 0,
                        duration: 220,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                });
            }, this);

            draggable.connectObject('drag-end', () => {
                if (isActorAlive(btn)) {
                    btn.opacity = 255;
                }
            }, this);

            allFolderBtns.push(btn);
            currentRow.add_child(btn);
        });

        this.folderMenu.gridMasterBox.queue_relayout();

        this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this.folderMenu.gridMasterBox || !isActorAlive(this.folderMenu.gridMasterBox)) return GLib.SOURCE_REMOVE;

            allFolderBtns.forEach(btn => {
                if (!btn || !isActorAlive(btn)) return;

                if (animatedAppId === btn._appId) {
                    btn.opacity = 0;
                    btn.set_scale(0.1, 0.1);
                    btn.translation_y = 12;
                    btn.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        translation_y: 0,
                        opacity: 255,
                        duration: ENTRY_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC
                    });
                } else {
                    const oldPos = oldPositions.get(btn._appId);
                    if (oldPos) {
                        const [newX, newY] = btn.get_transformed_position();
                        if (Math.abs(oldPos.x - newX) > 1 || Math.abs(oldPos.y - newY) > 1) {
                            btn.translation_x = oldPos.x - newX;
                            btn.translation_y = oldPos.y - newY;
                            btn.ease({
                                translation_x: 0,
                                translation_y: 0,
                                duration: 240,
                                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
                            });
                        }
                    } else {
                        btn.opacity = 255;
                        btn.set_scale(1.0, 1.0);
                        btn.translation_y = 0;
                    }
                }
            });

            if (this.folderMenu && this.folderMenu._updatePosition) {
                this.folderMenu._updatePosition();
            }

            return GLib.SOURCE_REMOVE;
        });
    }
}