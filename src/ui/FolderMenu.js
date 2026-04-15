/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
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

import AppContextMenu from './ContextMenu.js';
import {
    setMagnifierPauseState
} from './Magnifier.js';


function traceMenuPath(cr, w, h, r, ah, aw, dockPos, ax, ay) {
    ax = Math.max(r + aw / 2, Math.min(ax, w - r - aw / 2));
    ay = Math.max(r + aw / 2, Math.min(ay, h - r - aw / 2));

    cr.newPath();
    if (dockPos === 'BOTTOM') {
        cr.moveTo(r, 0);
        cr.lineTo(w - r, 0);
        cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - ah - r);
        cr.arc(w - r, h - ah - r, r, 0, Math.PI / 2);
        cr.lineTo(ax + aw / 2, h - ah);
        cr.lineTo(ax + 2, h - 2);
        cr.curveTo(ax, h, ax, h, ax - 2, h - 2);
        cr.lineTo(ax - aw / 2, h - ah);
        cr.lineTo(r, h - ah);
        cr.arc(r, h - ah - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, r);
        cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'TOP') {
        cr.moveTo(r, ah);
        cr.lineTo(ax - aw / 2, ah);
        cr.lineTo(ax - 2, 2);
        cr.curveTo(ax, 0, ax, 0, ax + 2, 2);
        cr.lineTo(ax + aw / 2, ah);
        cr.lineTo(w - r, ah);
        cr.arc(w - r, ah + r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r);
        cr.arc(w - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(r, h);
        cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, ah + r);
        cr.arc(r, ah + r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'RIGHT') {
        cr.moveTo(r, 0);
        cr.lineTo(w - ah - r, 0);
        cr.arc(w - ah - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w - ah, ay - aw / 2);
        cr.lineTo(w - 2, ay - 2);
        cr.curveTo(w, ay, w, ay, w - 2, ay + 2);
        cr.lineTo(w - ah, ay + aw / 2);
        cr.lineTo(w - ah, h - r);
        cr.arc(w - ah - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(r, h);
        cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(0, r);
        cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'LEFT') {
        cr.moveTo(ah + r, 0);
        cr.lineTo(w - r, 0);
        cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r);
        cr.arc(w - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(ah + r, h);
        cr.arc(ah + r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(ah, ay + aw / 2);
        cr.lineTo(2, ay + 2);
        cr.curveTo(0, ay, 0, ay, 2, ay - 2);
        cr.lineTo(ah, ay - aw / 2);
        cr.lineTo(ah, r);
        cr.arc(ah + r, r, r, Math.PI, 3 * Math.PI / 2);
    }
    cr.closePath();
}

function dropDelegate(source) {
    if (!source) return {};
    if (source._delegate) return source._delegate;
    if (source.button?._delegate) return source.button._delegate;
    if (source.sourceActor?._delegate) return source.sourceActor._delegate;
    if (source.actor?._delegate) return source.actor._delegate;
    return source;
}

function dropButton(source) {
    const delegate = dropDelegate(source);
    return delegate.button ||
        source?.button ||
        source?.sourceActor ||
        source?.actor ||
        (source?.get_parent ? source : null);
}

function dropAppId(source) {
    const delegate = dropDelegate(source);
    if (delegate.appId) return delegate.appId;
    if (delegate.app && typeof delegate.app.get_id === 'function') return delegate.app.get_id();
    if (source?.app && typeof source.app.get_id === 'function') return source.app.get_id();
    return null;
}

export default class FolderMenu {
    constructor(dockUI, folderData, buttonActor) {
        this.dockUI = dockUI;
        this.folderData = folderData;
        this.buttonActor = buttonActor;
        this._emojiSearchTimerId = null;
        this._emojiOverlay = null;

        this.actor = new St.Widget({
            style_class: 'context-menu-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true
        });
        this.actor.connect('button-release-event', () => {
            this.hide();
            return Clutter.EVENT_STOP;
        });

        this.menuContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            style: 'background-color: transparent;'
        });
        this.bgDrawingArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            style: 'background-color: transparent;'
        });
        this.menuContainer.add_child(this.bgDrawingArea);

        this.panel = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style_class: 'context-menu-panel',
            style: 'background-color: transparent; border: none; box-shadow: none;'
        });
        this.panel.connect('button-release-event', () => Clutter.EVENT_STOP);

        const handleExternalAppDrop = (source) => {
            const delegate = dropDelegate(source);
            if (delegate.isFolderItem) return false;

            const draggedId = dropAppId(source);
            const srcBtn = dropButton(source);
            const draggedApp = delegate.app || source?.app || srcBtn?._delegate?.app;
            if (draggedApp && draggedId && !this.folderData.apps.includes(draggedId)) {
                this.dockUI.folderManager.addAppToFolder(this.folderData.id, draggedId);
                if (srcBtn) srcBtn._wasMerged = true;
                this._refreshGrid();
                this.dockUI.queueRender();
                return true;
            }

            return false;
        };

        this.panel._delegate = {
            acceptDrop: (source) => !!(source && !dropDelegate(source).isFolderItem && dropAppId(source)),
            handleDragOver: (source) => (source && !dropDelegate(source).isFolderItem && dropAppId(source)) ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE,
            handleDragDrop: handleExternalAppDrop
        };
        this._handleExternalAppDrop = handleExternalAppDrop;

        this.menuContainer.add_child(this.panel);
        this._applyThemeStyle(this.panel);
        this._buildMenu();

        this.actor.add_child(this.menuContainer);
    }

    _applyThemeStyle(panel) {
        if (!this.dockUI?.settings) return;
        const settings = this.dockUI.settings;
        const themeId = settings.get_string('dock-theme') || 'default';
        const opacity = settings.get_int('background-opacity') / 100.0;
        const sWidth = settings.get_int('stroke-width');
        const sColor = settings.get_string('stroke-color') || '#ffffff';
        const sOpacity = settings.get_int('stroke-opacity') / 100.0;

        const _hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16),
                g = parseInt(hex.slice(3, 5), 16),
                b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        let bgRgba = _hexToRgba(settings.get_string('background-color') || '#000000', opacity);

        if (themeId === 'chameleon') {
            const {
                r,
                g,
                b
            } = this.dockUI._chameleonColor?.bg || {
                r: 30,
                g: 30,
                b: 45
            };
            bgRgba = `rgba(${r}, ${g}, ${b}, 0.88)`;
        } else if (this.dockUI.actor._tooltipBg) {
            let css = this.dockUI.actor._tooltipBg;

            let match = css.match(/background-gradient-start:\s*(rgba?\([^)]+\))/);
            if (!match) match = css.match(/background-color:\s*(rgba?\([^)]+\))/);

            if (match) {
                let color = match[1];
                if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {

                    let allColors = css.match(/rgba?\([^)]+\)/g);
                    if (allColors) {
                        bgRgba = allColors.find(c => c !== 'rgba(0, 0, 0, 0)' && c.replace(/\s/g, '') !== 'rgba(0,0,0,0)') || bgRgba;
                    }
                } else {
                    bgRgba = color;
                }
            }
        }

        panel.set_style(`background-color: transparent; border: none;`);
        this.bgDrawingArea._bgRgba = bgRgba;
        this.bgDrawingArea._strokeRgba = sWidth > 0 ? _hexToRgba(sColor, sOpacity) : 'transparent';
        this.bgDrawingArea._sWidth = sWidth;

        this.bgDrawingArea.connect('repaint', (area) => {
            if (!this._dockPos) return;
            const cr = area.get_context();
            const [fullW, fullH] = area.get_surface_size();
            const r = 18;
            const ah = 12;
            const aw = 24;
            const sw = area._sWidth || 0;
            const half = sw / 2;
            const w = fullW - sw;
            const h = fullH - sw;

            let ax = (area._arrowCenter || fullW / 2) - half;
            let ay = (area._arrowCenter || fullH / 2) - half;

            const parseRgba = (str) => {
                let m = (str || '').match(/[\d.]+/g);
                return m ? m.map(Number) : [0, 0, 0, 0];
            };

            cr.save();
            cr.setOperator(cairo.Operator.CLEAR);
            cr.paint();
            cr.restore();
            cr.translate(half, half);
            traceMenuPath(cr, w, h, r, ah, aw, this._dockPos, ax, ay);

            const [br, bg, bb, ba] = parseRgba(area._bgRgba);
            cr.setSourceRGBA(br / 255, bg / 255, bb / 255, ba);
            cr.fillPreserve();

            if (sw > 0) {
                const [sr, sg, sb, sa] = parseRgba(area._strokeRgba);
                cr.setSourceRGBA(sr / 255, sg / 255, sb / 255, sa);
                cr.setLineWidth(sw);
                cr.setLineJoin(cairo.LineJoin.ROUND);
                cr.stroke();
            } else {
                cr.newPath();
            }
            cr.$dispose();
        });
    }

    _saveFolderState() {
        if (typeof this.dockUI.folderManager.saveFolders === 'function') {
            this.dockUI.folderManager.saveFolders();
        } else if (typeof this.dockUI.folderManager._saveFolders === 'function') {
            this.dockUI.folderManager._saveFolders();
        } else {
            this.dockUI.settings.set_string('app-folders', JSON.stringify(this.dockUI.folderManager.getFolders()));
        }
        this.dockUI.queueRender();
    }

    _buildMenu() {
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
            text: this.folderData.name,
            hint_text: "Name",
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

        iconBtn.connect('clicked', () => {
            this.hide();
            try {
                if (this.dockUI) this.dockUI._pauseAutoHide = true;
                const proc = Gio.Subprocess.new(['zenity', '--file-selection', '--title=Select Custom Folder Icon', '--file-filter=Images | *.png *.svg *.ico'], Gio.SubprocessFlags.STDOUT_PIPE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    if (this.dockUI) this.dockUI._pauseAutoHide = false;
                    try {
                        const [, stdout] = p.communicate_utf8_finish(res);
                        if (stdout && stdout.trim()) {
                            const pickedPath = stdout.trim();
                            const ext = pickedPath.split('.').pop().toLowerCase();
                            const configDir = GLib.get_user_config_dir() + '/dhruva@narkagni/icon';
                            GLib.mkdir_with_parents(configDir, 0o755);
                            const destPath = `${configDir}/folder_icon_${Date.now()}.${ext}`;
                            Gio.File.new_for_path(pickedPath).copy(Gio.File.new_for_path(destPath), Gio.FileCopyFlags.OVERWRITE, null, null);
                            selectedIcon = destPath;
                            this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, selectedIcon);
                            this.dockUI.queueRender();
                        }
                    } catch (e) {}
                });
            } catch (e) {}
        });

        editBtn.connect('clicked', () => {
            displayBox.visible = false;
            editBox.visible = true;
            global.stage.set_key_focus(nameEntry);
        });

        const commitSave = () => {
            const newName = nameEntry.get_text() || 'New Folder';
            this.folderData.name = newName;
            this.dockUI.folderManager.updateFolder(this.folderData.id, newName, selectedIcon);
            nameLabel.set_text(newName);
            displayBox.visible = true;
            editBox.visible = false;
            this.dockUI.queueRender();
        };

        saveBtn.connect('clicked', commitSave);
        nameEntry.clutter_text.connect('activate', commitSave);



        emojiBtn.connect('clicked', () => {
            this._showEmojiPicker((selectedEmoji) => {
                try {
                    const configDir = GLib.get_user_config_dir() + '/dhruva@narkagni/icon';
                    GLib.mkdir_with_parents(configDir, 0o755);
                    const destPath = `${configDir}/emoji_${Date.now()}.png`;

                    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, 128, 128);
                    const cr = new cairo.Context(surface);

                    const layout = PangoCairo.create_layout(cr);
                    layout.set_text(selectedEmoji, -1);
                    const fontDesc = Pango.FontDescription.from_string("Noto Color Emoji 83");
                    layout.set_font_description(fontDesc);

                    const [width, height] = layout.get_pixel_size();
                    cr.moveTo((128 - width) / 2, (128 - height) / 2);
                    PangoCairo.show_layout(cr, layout);

                    surface.writeToPNG(destPath);
                    cr.$dispose();

                    this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, destPath);
                    this.dockUI.queueRender();

                } catch (e) {
                    console.error('[Dhruva-Debug] Emoji to PNG conversion failed:', e);
                    this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, `emoji:${selectedEmoji}`);
                    this.dockUI.queueRender();
                } finally {
                    this.hide();
                }
            }).catch(e => console.error('[Dhruva-Debug] Picker Promise Rejection:', e));
        });

        this.gridMasterBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 8px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        this.panel.add_child(this.gridMasterBox);
        this._refreshGrid();
    }

    async _showEmojiPicker(onSelect) {
        if (this.menuContainer) this.menuContainer.hide();

        let emojiList = [];
        let categories = ['All'];

        try {
            const emojiFile = Gio.File.new_for_path(GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/dhruva@narkagni/src/ui/emojis.json');

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
                        } catch (e) {
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
                let cats = new Set();
                emojiList.forEach(e => {
                    if (e.category) cats.add(e.category);
                });
                categories = ['All', ...Array.from(cats)];
            }
        } catch (e) {
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
        this._emojiOverlay = overlay;

        const clearEmojiSearchTimer = () => {
            if (this._emojiSearchTimerId) {
                GLib.source_remove(this._emojiSearchTimerId);
                this._emojiSearchTimerId = null;
            }
        };

        const closePicker = () => {
            clearEmojiSearchTimer();
            if (this._emojiOverlay === overlay) this._emojiOverlay = null;
            overlay.destroy();
            if (this.menuContainer) this.menuContainer.show();
        };

        overlay.connect('destroy', () => {
            clearEmojiSearchTimer();
            if (this._emojiOverlay === overlay) this._emojiOverlay = null;
        });

        overlay.connect('button-release-event', () => {
            if (dropdownBox.visible) {
                dropdownBox.visible = false;
                return Clutter.EVENT_STOP;
            }
            closePicker();
            return Clutter.EVENT_STOP;
        });
        const tooltipCss = this.dockUI.actor._tooltipBg || 'background-color: rgba(20,20,30,0.97);';

        const picker = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: `border-radius: 16px; padding: 16px 24px; border: 1px solid rgba(255,255,255,0.12); width: 680px; ${tooltipCss}`,
            reactive: true
        });

        picker.connect('button-release-event', () => {
            if (dropdownBox.visible) dropdownBox.visible = false;
            return Clutter.EVENT_STOP;
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
                try {
                    adj = typeof scrollView.get_vadjustment === 'function' ? scrollView.get_vadjustment() : scrollView.get_vscroll_bar().get_adjustment();
                } catch (e) {}

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


        const handleKeyPress = (actor, event) => {
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
                btn._emojiData = {
                    emoji,
                    name,
                    category: item.category
                };
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
            if (this._emojiSearchTimerId) GLib.source_remove(this._emojiSearchTimerId);
            this._emojiSearchTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                _populateGrid(searchEntry.get_text(), currentCategory);
                this._emojiSearchTimerId = null;
                return GLib.SOURCE_REMOVE;
            });
        });

        overlay.add_child(picker);
        overlay.add_child(ddWrapper);
        global.stage.set_key_focus(searchEntry);
    }

    _refreshGrid() {
        this.gridMasterBox.destroy_all_children();

        const iconSize = this.dockUI.settings.get_int('icon-size') || 48;
        const appsPerRow = 5;
        let currentRow = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 8px;'
        });
        this.gridMasterBox.add_child(currentRow);

        let count = 0;

        this.folderData.apps.forEach((appId, index) => {
            const app = this.dockUI.appManager.appSystem.lookup_app(appId);
            if (!app) return;

            if (count > 0 && count % appsPerRow === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    style: 'spacing: 8px;'
                });
                this.gridMasterBox.add_child(currentRow);
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

            btn.connect('notify::hover', () => {
                btn.set_style(btn.hover ? 'background-color: rgba(255,255,255,0.15); border-radius: 8px; padding: 6px;' : 'background-color: transparent; border-radius: 8px; padding: 6px;');
            });

            btn.connect('clicked', () => {
                app.activate();
                this.hide();
            });

            btn.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 3) {
                    btn._inFolder = true;
                    btn._folderId = this.folderData.id;
                    btn._folderName = this.folderData.name;
                    
                    if (this.dockUI._activeContextMenu) this.dockUI._activeContextMenu.hide();
                    this.dockUI._activeContextMenu = new AppContextMenu(this.dockUI, app, btn);
                    this.dockUI._activeContextMenu.show(this.dockUI.dockPosition);
                    return Clutter.EVENT_STOP;
                }
            });



            currentRow.add_child(btn);
        });

        this.gridMasterBox.queue_relayout();
    }

    show(dockPosition) {
        this._dockPos = dockPosition;

        if (this.dockUI && this.dockUI.actor && typeof setMagnifierPauseState === 'function') {
            setMagnifierPauseState(this.dockUI.actor, 'folder-menu', true);
        }

        if (this._showDelayId) GLib.source_remove(this._showDelayId);
        this._showDelayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._showDelayId = null;
            if (this._isHiding || !this.actor) return GLib.SOURCE_REMOVE;

            Main.layoutManager.addChrome(this.actor, {
                affectsStruts: false
            });
            if (this.dockUI && this.dockUI.actor) {
                try {
                    const parent = this.actor.get_parent();
                    const sibling = this.dockUI.actor;
                    const siblingParent = sibling?.get_parent?.();
                    if (parent && sibling && parent === siblingParent)
                        parent.set_child_below_sibling(this.actor, sibling);
                } catch (_e) {}
            }
            this.actor.set_position(0, 0);
            this.actor.set_size(global.stage.width, global.stage.height);

            const ah = 12;
            let padBottom = 16,
                padTop = 16,
                padLeft = 16,
                padRight = 16;
            if (dockPosition === 'BOTTOM') padBottom += ah;
            else if (dockPosition === 'TOP') padTop += ah;
            else if (dockPosition === 'LEFT') padLeft += ah;
            else if (dockPosition === 'RIGHT') padRight += ah;

            this.panel.set_style(`background-color: transparent; border: none; box-shadow: none; padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`);

            const [, panelW] = this.menuContainer.get_preferred_width(-1);
            const [, panelH] = this.menuContainer.get_preferred_height(-1);

            const [btnX, btnY] = this.buttonActor.get_transformed_position();
            const [btnW, btnH] = this.buttonActor.get_transformed_size();

            const gap = 20;

            let posX = btnX + (btnW / 2) - (panelW / 2);
            let posY = btnY;

            if (dockPosition === 'BOTTOM') {
                posY = btnY - panelH - gap;
                this.menuContainer.set_pivot_point(0.5, 1.0);
            } else if (dockPosition === 'TOP') {
                posY = btnY + btnH + gap;
                this.menuContainer.set_pivot_point(0.5, 0.0);
            } else if (dockPosition === 'LEFT') {
                posX = btnX + btnW + gap;
                posY = btnY + (btnH / 2) - (panelH / 2);
                this.menuContainer.set_pivot_point(0.0, 0.5);
            } else if (dockPosition === 'RIGHT') {
                posX = btnX - panelW - gap;
                posY = btnY + (btnH / 2) - (panelH / 2);
                this.menuContainer.set_pivot_point(1.0, 0.5);
            }

            if (posX < 10) posX = 10;
            if (posX + panelW > global.stage.width - 10) posX = global.stage.width - panelW - 10;
            if (dockPosition !== 'BOTTOM' && posY + panelH > global.stage.height - gap) posY = global.stage.height - panelH - gap;

            if (dockPosition === 'BOTTOM' || dockPosition === 'TOP') {
                this.bgDrawingArea._arrowCenter = (btnX + btnW / 2) - posX;
            } else {
                this.bgDrawingArea._arrowCenter = (btnY + btnH / 2) - posY;
            }
            this.bgDrawingArea.queue_repaint();

            this.menuContainer.opacity = 0;
            this.menuContainer.set_position(posX, posY);
            this.menuContainer.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    hide() {
        if (this._isHiding) return;
        this._isHiding = true;

        if (this._showDelayId) {
            GLib.source_remove(this._showDelayId);
            this._showDelayId = null;
        }

        if (this._emojiSearchTimerId) {
            GLib.source_remove(this._emojiSearchTimerId);
            this._emojiSearchTimerId = null;
        }
        if (this._emojiOverlay) {
            try {
                this._emojiOverlay.destroy();
            } catch (_e) {}
            this._emojiOverlay = null;
        }

        if (this.dockUI && this.dockUI.actor && typeof setMagnifierPauseState === 'function') {
            setMagnifierPauseState(this.dockUI.actor, 'folder-menu', false);
        }

        if (this.dockUI._activeFolderMenu === this) this.dockUI._activeFolderMenu = null;

        if (this.menuContainer) {
            this.menuContainer.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this.actor && this.actor.get_parent()) Main.layoutManager.removeChrome(this.actor);
                    if (this.actor) this.actor.destroy();
                }
            });
        }
    }
}