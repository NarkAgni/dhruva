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
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { EmojiPicker } from './EmojiPicker.js';
import { Settings } from '../../core/SettingsManager.js';
import { getIndicatorProps } from '../dock/DockRenderer.js';
import { CrispLabel } from '../modules/music/CrispLabel.js';
import { createIndicatorBox } from '../dock/DockButtonBase.js';
import AppContextMenu from '../context-menu/AppContextMenu.js';
import { setBoxVertical, isActorAlive } from '../../core/Utils.js';
import { iconConfigDir, deleteCustomFolderIcon, pickIconImage } from './FolderIconFiles.js';


const APPS_PER_ROW = 5;
const EMOJI_TEXTURE_DIM = 256;
const ENTRY_DURATION_MS = 260;
const HINT_FADE_MS = 120;
const SECTION_FADE_MS = 160;
const SLIDER_SAVE_DELAY_MS = 150;

const HEADER_ICON_SIZE = 16;
const HEADER_BUTTON_SIZE = 28;
const SWATCH_SIZE = 22;

const DEFAULT_PLATE_COLOR = 'rgba(255, 255, 255, 0.65)';
const DEFAULT_PLATE_OPACITY = 130;
const MIN_PLATE_OPACITY = 0.1;
const DEFAULT_LETTER_SCALE = 0.44;
const MIN_LETTER_SCALE = 0.28;
const MAX_LETTER_SCALE = 0.54;

const ACCENT_COLORS = [
    { name: 'Default', hex: DEFAULT_PLATE_COLOR },
    { name: 'Blue', hex: '#3584e4' },
    { name: 'Green', hex: '#3a944a' },
    { name: 'Yellow', hex: '#e5a50a' },
    { name: 'Orange', hex: '#ed5b00' },
    { name: 'Red', hex: '#e01b24' },
    { name: 'Pink', hex: '#d56199' },
    { name: 'Teal', hex: '#2190a4' },
    { name: 'Purple', hex: '#9141ac' },
    { name: 'Slate', hex: '#627889' },
];

const LETTER_COLORS = [
    { name: 'White', hex: '#ffffff' },
    { name: 'Black', hex: '#111111' },
    { name: 'Yellow', hex: '#f6d32d' },
    { name: 'Green', hex: '#33d17a' },
    { name: 'Red', hex: '#e01b24' },
];


function symbolicIcon(iconName) {
    return new St.Icon({
        icon_name: iconName,
        icon_size: HEADER_ICON_SIZE,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'color: rgba(255,255,255,0.95);'
    });
}

function headerButtonStyle(isHovered, isActive) {
    let alpha = 0.08;
    if (isActive) alpha = 0.28;
    else if (isHovered) alpha = 0.20;
    return `width: ${HEADER_BUTTON_SIZE}px; height: ${HEADER_BUTTON_SIZE}px; padding: 0; border-radius: 8px; ` +
        `background-color: rgba(255,255,255,${alpha}); transition-duration: 150ms;`;
}

function swatchStyle(color, isSelected) {
    const ring = isSelected ? '2px solid rgba(255,255,255,0.95)' : '1px solid rgba(255,255,255,0.18)';
    return `width: ${SWATCH_SIZE}px; height: ${SWATCH_SIZE}px; border-radius: ${SWATCH_SIZE / 2}px; ` +
        `background-color: ${color}; border: ${ring}; transition-duration: 120ms;`;
}

function renderEmojiToPng(emoji, destPath) {
    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, EMOJI_TEXTURE_DIM, EMOJI_TEXTURE_DIM);
    const cr = new cairo.Context(surface);

    const layout = PangoCairo.create_layout(cr);
    layout.set_text(emoji, -1);
    layout.set_font_description(Pango.FontDescription.from_string('Noto Color Emoji 160'));

    const [width, height] = layout.get_pixel_size();
    cr.moveTo((EMOJI_TEXTURE_DIM - width) / 2, (EMOJI_TEXTURE_DIM - height) / 2);
    PangoCairo.show_layout(cr, layout);

    surface.writeToPNG(destPath);
    cr.$dispose();
}

export class FolderMenuBuilder {
    constructor(folderMenu) {
        this.folderMenu = folderMenu;
        this.dockUI = folderMenu.dockUI;
        this.folderData = folderMenu.folderData;
        this.panel = folderMenu.panel;
        this.timers = folderMenu.timers;
        this._saveSoonId = 0;
        this._refreshIdleId = 0;
        this._cancellable = new Gio.Cancellable();
    }

    buildMenu() {
        this._sections = [];
        this._hintText = '';

        this.panel.add_child(this._buildHeader());
        this._plateSection = this._buildPlateSection();
        this._letterSection = this._buildLetterSection();
        this.panel.add_child(this._plateSection);
        this.panel.add_child(this._letterSection);

        this._updateHeaderState();

        this.folderMenu.gridMasterBox = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_align: Clutter.ActorAlign.CENTER
        });
        setBoxVertical(this.folderMenu.gridMasterBox, true);
        this.panel.add_child(this.folderMenu.gridMasterBox);
        this.refreshGrid(true);
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 12px; spacing: 6px;'
        });
        setBoxVertical(header, true);

        const titleStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            style: 'min-height: 32px;'
        });

        this._displayRow = new St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 6px;' });
        setBoxVertical(this._displayRow, false);

        this._nameLabel = new CrispLabel({
            font_desc: 'Sans Bold 12',
            color: '#ffffff',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 4px;'
        });
        this._nameLabel.text = this.folderData.name;

        this._renameBtn = this._makeHeaderButton(symbolicIcon('document-edit-symbolic'), _('Rename folder'),
            () => this._beginRename());
        this._plateBtn = this._makeHeaderButton(symbolicIcon('color-select-symbolic'), _('Background color'),
            () => this._toggleSection(this._plateSection));
        this._letterBtn = this._makeHeaderButton(symbolicIcon('folder-symbolic'), _('Letter style'),
            () => this._openLetterStyle());
        this._imageBtn = this._makeHeaderButton(symbolicIcon('insert-image-symbolic'), _('Custom image'),
            () => this._pickImageIcon());
        this._emojiBtn = this._makeHeaderButton(new St.Label({
            text: '😀',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 15px;'
        }), _('Emoji icon'),
            () => this._pickEmojiIcon());
        this._resetBtn = this._makeHeaderButton(symbolicIcon('edit-undo-symbolic'), _('Reset style'),
            () => this._resetStyle());

        [this._nameLabel, this._renameBtn, this._plateBtn, this._letterBtn, this._imageBtn, this._emojiBtn, this._resetBtn]
            .forEach(child => this._displayRow.add_child(child));

        titleStack.add_child(this._displayRow);
        titleStack.add_child(this._buildRenameRow());

        this._hintLabel = new CrispLabel({
            font_desc: 'Sans 9',
            color: 'rgba(255,255,255,0.88)',
            align: 'center',
            x_align: Clutter.ActorAlign.CENTER,
            opacity: 0
        });

        header.add_child(titleStack);
        header.add_child(this._hintLabel);
        return header;
    }

    _makeHeaderButton(child, hint, onClick) {
        const btn = new St.Button({
            child,
            style: headerButtonStyle(false, false),
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            accessible_name: hint
        });
        btn._isActive = false;

        btn.connectObject(
            'notify::hover', () => {
                btn.set_style(headerButtonStyle(btn.hover, btn._isActive));
                this._showHint(btn.hover ? hint : '');
            },
            'clicked', onClick,
            this
        );
        return btn;
    }

    _setHeaderActive(btn, isActive) {
        btn._isActive = isActive;
        btn.set_style(headerButtonStyle(btn.hover, isActive));
    }

    _showHint(text) {
        if (text) this._hintLabel.text = text;
        this._hintLabel.remove_transition('opacity');
        this._hintLabel.ease({
            opacity: text ? 255 : 0,
            duration: HINT_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _updateHeaderState() {
        const icon = this.folderData.icon || 'folder';
        const isLetterStyle = icon === 'system-folder';
        const isCustomMedia = icon.startsWith('/') || icon.startsWith('file://');
        const hasCustomPlate = (this.folderData.plateColor && this.folderData.plateColor !== DEFAULT_PLATE_COLOR) ||
            (this.folderData.plateOpacity !== undefined && this.folderData.plateOpacity !== DEFAULT_PLATE_OPACITY);

        this._plateBtn.visible = !isLetterStyle && !isCustomMedia;
        this._resetBtn.visible = isLetterStyle || isCustomMedia || hasCustomPlate;

        this._setHeaderActive(this._plateBtn, this._plateSection.visible);
        this._setHeaderActive(this._letterBtn, isLetterStyle || this._letterSection.visible);
    }

    _buildRenameRow() {
        this._renameRow = new St.BoxLayout({ style: 'spacing: 6px;', visible: false, y_align: Clutter.ActorAlign.CENTER });
        setBoxVertical(this._renameRow, false);

        this._nameEntry = new St.Entry({
            hint_text: _('Folder name'),
            can_focus: true,
            style: 'font-size: 14px; border-radius: 8px; padding: 4px 10px; color: white; ' +
                'background-color: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); width: 160px;'
        });

        const saveBtn = new St.Button({
            child: symbolicIcon('object-select-symbolic'),
            style: 'background-color: rgba(46, 139, 87, 0.9); color: white; border-radius: 8px; padding: 6px;',
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Save')
        });
        const cancelBtn = new St.Button({
            child: symbolicIcon('window-close-symbolic'),
            style: headerButtonStyle(false, false),
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Cancel')
        });

        saveBtn.connectObject('clicked', () => this._commitRename(), this);
        cancelBtn.connectObject('clicked', () => this._endRename(), this);
        this._nameEntry.clutter_text.connectObject(
            'activate', () => this._commitRename(),
            'key-press-event', (_actor, event) => {
                if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE;
                this._endRename();
                return Clutter.EVENT_STOP;
            },
            this
        );

        this._renameRow.add_child(this._nameEntry);
        this._renameRow.add_child(saveBtn);
        this._renameRow.add_child(cancelBtn);
        return this._renameRow;
    }

    _beginRename() {
        this._nameEntry.text = this.folderData.name;
        this._displayRow.visible = false;
        this._renameRow.visible = true;
        this._showHint('');
        this._nameEntry.grab_key_focus();
        this._nameEntry.clutter_text.set_selection(0, -1);
    }

    _endRename() {
        this._renameRow.visible = false;
        this._displayRow.visible = true;
        global.stage.set_key_focus(null);
    }

    _commitRename() {
        const newName = this._nameEntry.get_text().trim();
        if (newName && newName !== this.folderData.name) {
            this.folderData.name = newName;
            this._nameLabel.text = newName;
            this.dockUI.folderManager.updateFolder(this.folderData.id, newName, this.folderData.icon);
            this.folderMenu._saveFolderState();
        }
        this._endRename();
    }

    _makeSection() {
        const section = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin: 2px 0 14px 0; spacing: 10px;',
            visible: false
        });
        setBoxVertical(section, true);
        this._sections.push(section);
        return section;
    }

    _toggleSection(section) {
        const willOpen = !section.visible;
        this._sections.forEach(other => { other.visible = false; });

        if (willOpen) {
            section.opacity = 0;
            section.visible = true;
            section.ease({ opacity: 255, duration: SECTION_FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }

        this.folderMenu.gridMasterBox.visible = !willOpen;
        this._updateHeaderState();
    }

    _buildSwatchRow(colors, selectedColor, onPick) {
        const row = new St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER, style: 'spacing: 8px; padding: 4px 2px;' });
        setBoxVertical(row, false);

        const swatches = colors.map(color => {
            const swatch = new St.Button({
                style: swatchStyle(color.hex, color.hex === selectedColor),
                y_align: Clutter.ActorAlign.CENTER,
                accessible_name: color.name
            });
            swatch.connectObject('clicked', () => {
                swatches.forEach((other, i) => other.set_style(swatchStyle(colors[i].hex, other === swatch)));
                onPick(color.hex);
            }, this);
            row.add_child(swatch);
            return swatch;
        });
        return row;
    }

    _buildSlider(value, onChange) {
        const slider = new Slider(Math.max(0, Math.min(1, value)));
        slider.x_expand = true;
        slider.x_align = Clutter.ActorAlign.FILL;
        slider.y_align = Clutter.ActorAlign.CENTER;
        slider.connectObject('notify::value', () => onChange(slider.value), this);
        return slider;
    }

    _buildPlateSection() {
        const section = this._makeSection();

        section.add_child(this._buildSwatchRow(ACCENT_COLORS, this.folderData.plateColor || DEFAULT_PLATE_COLOR, hex => {
            this.folderData.plateColor = hex;
            this._saveStyle();
        }));

        const opacity = this.folderData.plateOpacity !== undefined ? this.folderData.plateOpacity : DEFAULT_PLATE_OPACITY;
        const sliderRow = new St.BoxLayout({ x_expand: true, style: 'margin-top: 6px; padding: 0 2px; spacing: 8px;' });
        setBoxVertical(sliderRow, false);
        sliderRow.add_child(symbolicIcon('display-brightness-symbolic'));
        sliderRow.add_child(this._buildSlider(opacity / 255, value => {
            this.folderData.plateOpacity = Math.round(Math.max(MIN_PLATE_OPACITY, value) * 255);
            this._saveStyleSoon();
        }));
        section.add_child(sliderRow);

        return section;
    }

    _buildLetterSection() {
        const section = this._makeSection();

        section.add_child(this._buildSwatchRow(ACCENT_COLORS, this.folderData.folderTintColor || DEFAULT_PLATE_COLOR, hex => {
            this.folderData.folderTintColor = hex;
            this._saveStyle(true);
        }));

        const scale = this.folderData.letterScale !== undefined ? this.folderData.letterScale : DEFAULT_LETTER_SCALE;
        const sliderRow = new St.BoxLayout({ x_expand: true, style: 'margin-top: 6px; padding: 0 4px; spacing: 8px;' });
        setBoxVertical(sliderRow, false);
        sliderRow.add_child(new St.Label({
            text: 'A',
            style: 'font-weight: 800; font-size: 13px; color: rgba(255,255,255,0.7);',
            y_align: Clutter.ActorAlign.CENTER
        }));
        sliderRow.add_child(this._buildSlider((scale - MIN_LETTER_SCALE) / (MAX_LETTER_SCALE - MIN_LETTER_SCALE), value => {
            this.folderData.letterScale = parseFloat((MIN_LETTER_SCALE + value * (MAX_LETTER_SCALE - MIN_LETTER_SCALE)).toFixed(2));
            this._saveStyleSoon();
        }));
        section.add_child(sliderRow);

        section.add_child(this._buildSwatchRow(LETTER_COLORS, this.folderData.letterColor || LETTER_COLORS[0].hex, hex => {
            this.folderData.letterColor = hex;
            this._saveStyle();
        }));

        return section;
    }

    _saveStyle(fullRender = false) {
        if (this._saveSoonId) {
            this.timers.remove(this._saveSoonId);
            this._saveSoonId = 0;
        }
        this.folderMenu._saveFolderState();
        if (fullRender) this.dockUI.queueRender('full', true);
        if (this.folderMenu.actor) this._updateHeaderState();
    }

    _saveStyleSoon() {
        if (this._saveSoonId) {
            this.timers.remove(this._saveSoonId);
            this._saveSoonId = 0;
        }
        this._saveSoonId = this.timers.addTimeout(GLib.PRIORITY_DEFAULT, SLIDER_SAVE_DELAY_MS, () => {
            this._saveSoonId = 0;
            this._saveStyle();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setFolderIcon(icon) {
        const oldIcon = this.folderData.icon;
        this.folderData.icon = icon;
        this.dockUI.folderManager.updateFolder(this.folderData.id, this.folderData.name, icon);
        this._saveStyle(true);
        if (oldIcon !== icon) deleteCustomFolderIcon(this.dockUI, oldIcon, this._cancellable);
    }

    _openLetterStyle() {
        this._toggleSection(this._letterSection);
        if (this._letterSection.visible && this.folderData.icon !== 'system-folder') this._setFolderIcon('system-folder');
    }

    _resetStyle() {
        delete this.folderData.folderTintColor;
        delete this.folderData.letterColor;
        delete this.folderData.letterScale;
        delete this.folderData.plateColor;
        delete this.folderData.plateOpacity;

        this._sections.forEach(section => { section.visible = false; });
        this.folderMenu.gridMasterBox.visible = true;
        this._setFolderIcon('folder');
    }

    _pickImageIcon() {
        this.folderMenu.hide();
        if (!GLib.find_program_in_path('zenity')) {
            Main.notifyError('Dhruva', _('zenity is required for file selection dialogs.'));
            return;
        }

        pickIconImage(_('Select Custom Folder Icon'), pickedPath => {
            if (!this._cancellable) return;
            const ext = pickedPath.split('.').pop().toLowerCase();
            const destPath = GLib.build_filenamev([iconConfigDir(this.dockUI), `folder_icon_${this.folderData.id}_${Date.now()}.${ext}`]);

            Gio.File.new_for_path(pickedPath).copy_async(Gio.File.new_for_path(destPath), Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, this._cancellable, null, (f, copyRes) => {
                try {
                    f.copy_finish(copyRes);
                } catch (err) {
                    console.error('[Dhruva] Folder icon copy failed:', err);
                    return;
                }
                if (!this.dockUI.folderManager) {
                    Gio.File.new_for_path(destPath).delete_async(GLib.PRIORITY_DEFAULT, this._cancellable, () => {});
                    return;
                }
                this._setFolderIcon(destPath);
            });
        });
    }

    _pickEmojiIcon() {
        this.showEmojiPicker(selectedEmoji => {
            const destPath = GLib.build_filenamev([iconConfigDir(this.dockUI), `emoji_${this.folderData.id}_${Date.now()}.png`]);
            renderEmojiToPng(selectedEmoji, destPath);
            this._setFolderIcon(destPath);
            this.folderMenu.hide();
        });
    }

    showEmojiPicker(onSelect) {
        const picker = new EmojiPicker(this.folderMenu, onSelect);
        picker.show();
    }

    _isPointerInsideMenu(px, py, margin = 18) {
        if (!this.folderMenu || !this.folderMenu.menuContainer || !isActorAlive(this.folderMenu.menuContainer)) {
            return false;
        }
        const [mx, my] = this.folderMenu.menuContainer.get_transformed_position();
        const [mw, mh] = this.folderMenu.menuContainer.get_transformed_size();
        return px >= mx - margin && px <= mx + mw + margin &&
               py >= my - margin && py <= my + mh + margin;
    }

    _findClosestSlotIndex(px, py, slots) {
        if (!slots || slots.length === 0) return -1;
        let closestIdx = -1;
        let minDistSq = Infinity;

        slots.forEach((slot, i) => {
            const dx = px - slot.cx;
            const dy = py - slot.cy;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                closestIdx = i;
            }
        });
        return closestIdx;
    }

    _applyVisualSlotShift(allFolderBtns, slots, startIdx, currentIdx, isOutsideMenu = false) {
        allFolderBtns.forEach((b, i) => {
            if (i === startIdx || !isActorAlive(b) || !slots[i]) return;

            let targetSlotIdx = i;
            if (isOutsideMenu) {
                if (i > startIdx) targetSlotIdx = i - 1;
            } else if (currentIdx !== -1 && startIdx !== -1) {
                if (startIdx < currentIdx) {
                    if (i > startIdx && i <= currentIdx) targetSlotIdx = i - 1;
                } else if (startIdx > currentIdx) {
                    if (i >= currentIdx && i < startIdx) targetSlotIdx = i + 1;
                }
            }

            const targetSlot = slots[targetSlotIdx];
            const homeSlot = slots[i];
            if (!targetSlot || !homeSlot) return;

            const tx = targetSlot.x - homeSlot.x;
            const ty = targetSlot.y - homeSlot.y;

            if (b._targetTx === tx && b._targetTy === ty) return;
            b._targetTx = tx;
            b._targetTy = ty;

            b.remove_transition('translation-x');
            b.remove_transition('translation-y');
            b.ease({
                translation_x: tx,
                translation_y: ty,
                duration: 190,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
            });
        });
    }

    _commitInternalReorder(srcAppId) {
        if (!srcAppId) return false;
        const toIndex = this.folderMenu._dragCurrentIndex;
        const appsArray = [...this.folderData.apps];
        const fromIndex = appsArray.indexOf(srcAppId);

        this.folderMenu._dragCommitted = true;

        if (fromIndex > -1 && toIndex !== undefined && toIndex > -1 && fromIndex !== toIndex) {
            appsArray.splice(fromIndex, 1);
            appsArray.splice(toIndex, 0, srcAppId);
            this.folderData.apps = [...new Set(appsArray)];
            this.folderMenu._saveFolderState();
        }
        this.folderMenu.forceRefresh(true);
        return true;
    }

    _stopFolderDragMonitor() {
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
    }

    refreshGrid(skipEntryAnimation = false, animatedAppId = null) {
        this._stopFolderDragMonitor();
        this.folderData = this.folderMenu.folderData;
        const oldPositions = new Map();

        if (this._draggables) {
            this._draggables.forEach(d => d.disconnectObject(this));
        }
        this._draggables = [];

        if (this.folderMenu.gridMasterBox.get_n_children() > 0) {
            this.folderMenu.gridMasterBox.get_children().forEach(row => {
                row.get_children().forEach(btn => {
                    btn.disconnectObject(this);
                    if (btn._appId && isActorAlive(btn)) {
                        const [x, y] = btn.get_transformed_position();
                        oldPositions.set(btn._appId, { x, y });
                    }
                });
            });
        }

        this.folderMenu.gridMasterBox.destroy_all_children();

        const sharedGridDelegate = {
            handleDragOver: (source) => {
                if (!source) return DND.DragMotionResult.CONTINUE;
                if (source.inFolder && source.folderId === this.folderData.id) {
                    return DND.DragMotionResult.MOVE_DROP;
                }
                if (this.folderMenu._handleExternalAppDrop && !source.inFolder && !source.isFolder) {
                    return DND.DragMotionResult.COPY_DROP;
                }
                return DND.DragMotionResult.CONTINUE;
            },
            acceptDrop: (source) => {
                if (!source) return false;
                if (source.inFolder && source.folderId === this.folderData.id) {
                    return this._commitInternalReorder(source.appId);
                }
                if (this.folderMenu._handleExternalAppDrop) {
                    return this.folderMenu._handleExternalAppDrop(source);
                }
                return false;
            }
        };

        this.folderMenu.gridMasterBox._delegate = sharedGridDelegate;

        const iconSize = Settings.iconSize;
        let currentRow = new St.BoxLayout({ style: 'spacing: 8px;' });
        setBoxVertical(currentRow, false);
        currentRow._delegate = sharedGridDelegate;
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
                currentRow._delegate = sharedGridDelegate;
                this.folderMenu.gridMasterBox.add_child(currentRow);
            }
            count++;

            const btnSize = iconSize + 12;

            const iconWrapper = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                width: iconSize,
                height: iconSize,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });

            const iconBin = new St.Bin({
                child: app.create_icon_texture(iconSize),
                reactive: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
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
                const indCount = (indStyle === 'line' || indStyle === 'windows') ? 1 : Math.max(1, windows.length);
                const dotBox = createIndicatorBox(
                    this.dockUI.dockPosition,
                    false,
                    indProps,
                    indCount,
                    iconSize,
                    isFocused
                );
                dotBox.y_align = Clutter.ActorAlign.END;
                iconWrapper.add_child(dotBox);
            }

            const btn = new St.Button({
                child: iconWrapper,
                width: btnSize,
                height: btnSize,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                style: 'border-radius: 10px; background-color: transparent; transition-duration: 120ms;'
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
                if (!isActorAlive(btn) || this.folderMenu._isInternalDragging) return;
                btn.set_style(btn.hover
                    ? 'background-color: rgba(255,255,255,0.15); border-radius: 10px; transition-duration: 120ms;'
                    : 'background-color: transparent; border-radius: 10px; transition-duration: 120ms;');
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
                app,
                appId,
                isFolderItem: true,
                inFolder: true,
                folderId: this.folderData.id,
                actor: btn,
                button: btn,
                getDragActor: () => {
                    const clone = new Clutter.Clone({ source: iconWrapper });
                    clone.set_size(iconSize, iconSize);
                    clone.reactive = false;
                    return clone;
                },
                getDragActorSource: () => btn,
                handleDragOver: (source) => sharedGridDelegate.handleDragOver(source),
                acceptDrop: (source) => sharedGridDelegate.acceptDrop(source)
            };

            if (!Settings.lockIcons) {
                const draggable = DND.makeDraggable(btn, {
                    restoreOnSuccess: false,
                    dragActorOpacity: 235
                });
                this._draggables.push(draggable);

                draggable.connectObject('drag-begin', () => {
                    this._stopFolderDragMonitor();

                    this.folderMenu._isInternalDragging = true;
                    this.folderMenu._dragCommitted = false;
                    this.folderMenu._draggedOutOfFolder = false;

                    const startIdx = allFolderBtns.indexOf(btn);
                    this.folderMenu._dragStartIndex = startIdx;
                    this.folderMenu._dragCurrentIndex = startIdx;

                    const slots = allFolderBtns.map(b => {
                        if (!isActorAlive(b)) return null;
                        b.remove_all_transitions();
                        b.translation_x = 0;
                        b.translation_y = 0;
                        b._targetTx = 0;
                        b._targetTy = 0;
                        b.set_style('background-color: transparent; border-radius: 10px;');
                        const [x, y] = b.get_transformed_position();
                        const [w, h] = b.get_transformed_size();
                        return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
                    });
                    this.folderMenu._dragSlots = slots;

                    if (isActorAlive(btn)) {
                        btn._wasDragged = true;
                        btn.opacity = 0;
                    }

                    this._dragMonitor = {
                        dragMotion: () => {
                            if (!this.folderMenu || !this.folderMenu.actor || !isActorAlive(this.folderMenu.actor)) {
                                return DND.DragMotionResult.CONTINUE;
                            }
                            const [px, py] = global.get_pointer();
                            const insideMenu = this._isPointerInsideMenu(px, py, 20);

                            if (!insideMenu) {
                                this.folderMenu._draggedOutOfFolder = true;
                                this._applyVisualSlotShift(allFolderBtns, slots, startIdx, startIdx, true);
                                return DND.DragMotionResult.MOVE_DROP;
                            }

                            this.folderMenu._draggedOutOfFolder = false;
                            const closestSlot = this._findClosestSlotIndex(px, py, slots);
                            if (closestSlot !== -1 && closestSlot !== this.folderMenu._dragCurrentIndex) {
                                this.folderMenu._dragCurrentIndex = closestSlot;
                                this._applyVisualSlotShift(allFolderBtns, slots, startIdx, closestSlot, false);
                            }
                            return DND.DragMotionResult.MOVE_DROP;
                        }
                    };
                    DND.addDragMonitor(this._dragMonitor);
                }, this);

                const finishFolderItemDrag = () => {
                    this._stopFolderDragMonitor();
                    this.folderMenu._isInternalDragging = false;

                    if (draggable._dragActor && isActorAlive(draggable._dragActor)) {
                        draggable._dragActor.opacity = 0;
                    }

                    if (this.folderMenu._dragCommitted) {
                        return;
                    }

                    const [px, py] = global.get_pointer();
                    const insideMenu = this._isPointerInsideMenu(px, py, 24);

                    if (!insideMenu && this.folderMenu._draggedOutOfFolder) {
                        this.folderMenu._dragCommitted = true;
                        const remainingCount = this.folderData.apps.length - 1;
                        if (this.dockUI && this.dockUI.folderManager) {
                            this.dockUI.folderManager.removeAppFromFolder(this.folderData.id, appId);
                        }
                        if (remainingCount <= 1) {
                            this.folderMenu.hide();
                        } else {
                            this.folderMenu.forceRefresh(false);
                        }
                        return;
                    }

                    if (insideMenu) {
                        this._commitInternalReorder(appId);
                        return;
                    }

                    if (isActorAlive(btn)) btn.opacity = 255;
                    allFolderBtns.forEach(b => {
                        if (!isActorAlive(b)) return;
                        b._targetTx = 0;
                        b._targetTy = 0;
                        b.remove_transition('translation-x');
                        b.remove_transition('translation-y');
                        b.ease({
                            translation_x: 0,
                            translation_y: 0,
                            duration: 200,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC
                        });
                    });
                };

                draggable.connectObject('drag-cancelled', finishFolderItemDrag, this);
                draggable.connectObject('drag-end', finishFolderItemDrag, this);
            }

            allFolderBtns.push(btn);
            currentRow.add_child(btn);
        });

        this.folderMenu.gridMasterBox.queue_relayout();

        if (this._refreshIdleId) {
            this.timers.remove(this._refreshIdleId);
            this._refreshIdleId = 0;
        }
        this._refreshIdleId = this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshIdleId = 0;
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

    destroy() {
        this._stopFolderDragMonitor();

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._saveSoonId && this.timers) {
            this.timers.remove(this._saveSoonId);
            this._saveSoonId = 0;
        }

        if (this._refreshIdleId && this.timers) {
            this.timers.remove(this._refreshIdleId);
            this._refreshIdleId = 0;
        }

        if (this._draggables) {
            this._draggables.forEach(d => d.disconnectObject(this));
            this._draggables = [];
        }

        if (this._nameEntry && this._nameEntry.clutter_text) {
            this._nameEntry.clutter_text.disconnectObject(this);
        }

        [this._renameBtn, this._plateBtn, this._letterBtn, this._imageBtn, this._emojiBtn, this._resetBtn].forEach(btn => {
            if (btn) btn.disconnectObject(this);
        });

        if (this.folderMenu && this.folderMenu.gridMasterBox && isActorAlive(this.folderMenu.gridMasterBox)) {
            this.folderMenu.gridMasterBox.get_children().forEach(row => {
                row.get_children().forEach(btn => btn.disconnectObject(this));
            });
        }
    }
}