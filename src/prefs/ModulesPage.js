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


import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import { userDataDir } from '../core/DataPaths.js';
import {
    fmt, addGroup, addGroupReset, showWhen, addSwitchRow, addSliderRow, addSegmentedRow, addColorRow,
} from './PrefsWidgets.js';


function getGraphemeCount(str) {
    if (!str) return 0;
    try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(str)).length;
    } catch (_e) {
        return Array.from(str).length;
    }
}

function presentDialog(window, dialog, isGnome45) {
    if (isGnome45) dialog.present();
    else dialog.present(window);
}

function replaceGridIcon(settings, sourceFile, iconDir) {
    const ext = sourceFile.get_basename().split('.').pop().toLowerCase();
    if (!['png', 'svg', 'ico'].includes(ext)) return;

    GLib.mkdir_with_parents(iconDir, 0o755);
    const destPath = GLib.build_filenamev([iconDir, `custom_grid_icon_${Date.now()}.${ext}`]);
    sourceFile.copy(Gio.File.new_for_path(destPath), Gio.FileCopyFlags.OVERWRITE, null, null);

    const oldPath = settings.get_string('custom-grid-icon');
    settings.set_string('custom-grid-icon', destPath);
    if (oldPath && oldPath.startsWith(`${iconDir}/`))
        Gio.File.new_for_path(oldPath).delete_async(GLib.PRIORITY_DEFAULT, null, () => {});
}

function addGridIconRow(group, window, settings, iconDir) {
    const row = new Adw.ActionRow({
        title: _('Your Own Icon'),
        subtitle: _('Square image, 256 or 512 px (.png, .svg, .ico)'),
    });
    const thumb = new Gtk.Image({ pixel_size: 32, valign: Gtk.Align.CENTER });
    row.add_prefix(thumb);

    const chooseBtn = new Gtk.Button({ label: _('Choose…'), valign: Gtk.Align.CENTER });
    const clearBtn = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        tooltip_text: _('Back to the default icon'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
    });
    row.add_suffix(chooseBtn);
    row.add_suffix(clearBtn);

    chooseBtn.connect('clicked', () => {
        const filter = new Gtk.FileFilter();
        filter.set_name(_('Images'));
        for (const mime of ['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']) filter.add_mime_type(mime);
        const filters = Gio.ListStore.new(Gtk.FileFilter);
        filters.append(filter);

        new Gtk.FileDialog({ title: _('Choose a Launcher Icon'), filters }).open(window, null, (dlg, res) => {
            let file;
            try {
                file = dlg.open_finish(res);
            } catch (_e) {
                return;
            }
            replaceGridIcon(settings, file, iconDir);
        });
    });

    clearBtn.connect('clicked', () => {
        const oldPath = settings.get_string('custom-grid-icon');
        settings.set_string('custom-grid-icon', '');
        if (oldPath.startsWith(`${iconDir}/`))
            Gio.File.new_for_path(oldPath).delete_async(GLib.PRIORITY_DEFAULT, null, () => {});
    });

    const sync = () => {
        const path = settings.get_string('custom-grid-icon');
        const hasIcon = path !== '';
        thumb.set_from_file(hasIcon ? path : null);
        thumb.set_visible(hasIcon);
        clearBtn.set_visible(hasIcon);
    };
    onSettingChanged(settings, 'custom-grid-icon', sync);
    sync();

    group.add(row);
    return row;
}


export function buildModulesPage(prefs, window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Modules'),
        icon_name: 'application-x-addon-symbolic',
    });

    const uuid = prefs.metadata.uuid;
    const iconDir = userDataDir('icon');
    const isFullBar = () => settings.get_boolean('full-width') || settings.get_boolean('hybrid-panel-mode');

    const gridGroup = addGroup(page, _('App Launcher'), _('Opens your list of applications'));
    const gridSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('show-grid-button', gridSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    gridGroup.set_header_suffix(gridSwitch);

    const hasCustomIcon = () => settings.get_string('custom-grid-icon') !== '';
    const gridRows = [
        addSegmentedRow(gridGroup, settings, 'grid-button-position', _('Position'), null, [
            { name: _('Far Edge'), value: 'LEFT_EDGE' },
            { name: _('Start'), value: 'START' },
            { name: _('End'), value: 'END' },
        ]),
        addGridIconRow(gridGroup, window, settings, iconDir),
    ];
    for (const row of gridRows) showWhen(row, settings, ['show-grid-button'], () => settings.get_boolean('show-grid-button'));

    const showGrid = () => settings.get_boolean('show-grid-button');
    const scaleRow = addSliderRow(gridGroup, settings, 'custom-grid-icon-scale', _('Icon Size'), null,
        { lower: 50, upper: 300, step: 5 }, fmt.percent);
    const oldIconRow = addSwitchRow(gridGroup, settings, 'use-old-grid-icon', _('Classic Grid Icon'),
        _('Dotted grid instead of the Dhruva logo'));
    const gridColorRow = addColorRow(gridGroup, settings, 'grid-icon-color', _('Grid Icon Colour'));
    showWhen(scaleRow, settings, ['show-grid-button', 'custom-grid-icon'], () => showGrid() && hasCustomIcon());
    showWhen(oldIconRow, settings, ['show-grid-button', 'custom-grid-icon'], () => showGrid() && !hasCustomIcon());
    showWhen(gridColorRow, settings, ['show-grid-button', 'custom-grid-icon', 'use-old-grid-icon'],
        () => showGrid() && !hasCustomIcon() && settings.get_boolean('use-old-grid-icon'));

    const desktopGroup = addGroup(page, _('Show Desktop'), _('One click hides every window'));
    const desktopSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('show-desktop-button', desktopSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    desktopGroup.set_header_suffix(desktopSwitch);

    const stripRows = [
        addSliderRow(desktopGroup, settings, 'desktop-btn-width', _('Strip Width'), _('The thin strip at the end of the bar'),
            { lower: 4, upper: 48, step: 1 }, fmt.px),
        addColorRow(desktopGroup, settings, 'desktop-btn-color', _('Strip Colour')),
        addSliderRow(desktopGroup, settings, 'desktop-btn-opacity', _('Strip Opacity'), null,
            { lower: 0, upper: 100, step: 5 }, fmt.percent),
    ];
    for (const row of stripRows) {
        showWhen(row, settings, ['show-desktop-button', 'full-width', 'hybrid-panel-mode'],
            () => settings.get_boolean('show-desktop-button') && isFullBar());
    }

    const placesGroup = addGroup(page, _('Places'), _('Shortcuts that open in your file manager'));
    addSwitchRow(placesGroup, settings, 'show-home', _('Home'));
    addSwitchRow(placesGroup, settings, 'show-downloads', _('Downloads'));
    addSwitchRow(placesGroup, settings, 'show-documents', _('Documents'));
    addSwitchRow(placesGroup, settings, 'show-pictures', _('Pictures'));
    addSwitchRow(placesGroup, settings, 'show-videos', _('Videos'));
    addSwitchRow(placesGroup, settings, 'show-music', _('Music'));
    addSwitchRow(placesGroup, settings, 'show-mounts', _('USB &amp; Other Drives'), _('Appear while they are connected'));
    addSwitchRow(placesGroup, settings, 'show-trash', _('Recycle Bin'));

    const customFoldersGroup = addGroup(page, _('Your Folders'), _('Any folder you like, with its own name and icon'));

    const folderListBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list']
    });
    customFoldersGroup.add(folderListBox);

    let customFolders = [];
    try {
        customFolders = JSON.parse(settings.get_string('custom-folders') || '[]');
    } catch (e) { }

    const iconOptions = [
        { name: _('System Folder (Default)'), value: 'folder' },
        { name: _('Home'), value: 'user-home' },
        { name: _('Downloads'), value: 'folder-download' },
        { name: _('Documents'), value: 'folder-documents' },
        { name: _('Pictures'), value: 'folder-pictures' },
        { name: _('Videos'), value: 'folder-videos' },
        { name: _('Music'), value: 'folder-music' },
        { name: _('Public Share'), value: 'folder-publicshare' },
        { name: _('Templates'), value: 'folder-templates' },
        { name: _('Desktop'), value: 'user-desktop' },
        { name: _('Projects / Code'), value: 'folder-development' },
        { name: _('Cloud / Remote'), value: 'folder-remote' }
    ];

    const openFolderDialog = (editIndex) => {
        const isEditing = (Number.isFinite(editIndex) && editIndex >= 0);
        const folderToEdit = isEditing ? customFolders[editIndex] : null;

        const isGnome45 = !Adw.AlertDialog;
        let dialog;

        const headingTitle = isEditing ? _('Edit Quick Folder') : _('Add Quick Folder');
        const actionLabel = isEditing ? _('Update') : _('Add');

        if (isGnome45) {
            dialog = new Adw.MessageDialog({
                heading: headingTitle,
                transient_for: window,
                modal: true
            });
        } else {
            dialog = new Adw.AlertDialog({
                heading: headingTitle
            });
        }

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('confirm', actionLabel);
        dialog.set_response_appearance('confirm', Adw.ResponseAppearance.SUGGESTED);

        const vbox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12
        });
        const inputGrp = new Adw.PreferencesGroup();

        const nameInput = new Adw.EntryRow({
            title: _('Folder Name (e.g. Workspace)')
        });
        if (folderToEdit && folderToEdit.name) {
            nameInput.set_text(folderToEdit.name);
        }

        const pathInput = new Adw.EntryRow({
            title: _('Folder Path')
        });
        if (folderToEdit && folderToEdit.path) {
            pathInput.set_text(folderToEdit.path);
        }

        const browseFolderBtn = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Browse folder...')
        });

        browseFolderBtn.connect('clicked', () => {
            const fileDialog = new Gtk.FileDialog({
                title: _('Select Folder')
            });
            fileDialog.select_folder(window, null, (dlg, res) => {
                let folder;
                try {
                    folder = dlg.select_folder_finish(res);
                } catch (e) {
                    return;
                }
                if (folder) {
                    const p = folder.get_path();
                    if (p) {
                        pathInput.set_text(p);
                        if (!nameInput.get_text()) {
                            nameInput.set_text(folder.get_basename());
                        }
                    }
                }
            });
        });
        pathInput.add_suffix(browseFolderBtn);

        const modeModel = Gtk.StringList.new([
            _('Preset System Icon'),
            _('Custom Image File'),
            _('Custom Emoji')
        ]);

        const modeRow = new Adw.ComboRow({
            title: _('Icon Type'),
            model: modeModel
        });

        const iconModel = Gtk.StringList.new(iconOptions.map(opt => opt.name));
        const iconInput = new Adw.ComboRow({
            title: _('Select Preset Icon'),
            model: iconModel
        });

        const customImageRow = new Adw.ActionRow({
            title: _('Select Image File'),
            subtitle: _('PNG, SVG, ICO format')
        });

        let customPickedImagePath = (folderToEdit && folderToEdit.icon && folderToEdit.icon.startsWith('/')) ? folderToEdit.icon : '';

        const customImgBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER
        });

        const initialImgLabel = customPickedImagePath ? customPickedImagePath.split('/').pop() : _('None');
        const customImgLabel = new Gtk.Label({
            label: initialImgLabel,
            css_classes: ['dim-label'],
            ellipsize: 3,
            max_width_chars: 14
        });

        const browseImgBtn = new Gtk.Button({
            label: _('Browse...')
        });

        browseImgBtn.connect('clicked', () => {
            const imgDialog = new Gtk.FileDialog({
                title: _('Select Custom Folder Icon Image')
            });
            const filter = new Gtk.FileFilter();
            filter.set_name(_('Images (.png, .svg, .ico)'));
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/svg+xml');
            filter.add_mime_type('image/x-icon');
            filter.add_mime_type('image/vnd.microsoft.icon');

            const filterList = Gio.ListStore.new(Gtk.FileFilter);
            filterList.append(filter);
            imgDialog.set_filters(filterList);

            imgDialog.open(window, null, (dlg, res) => {
                let file;
                try {
                    file = dlg.open_finish(res);
                } catch (e) {
                    return;
                }
                if (file) {
                    const ext = file.get_basename().split('.').pop().toLowerCase();
                    if (!['png', 'svg', 'ico'].includes(ext)) {
                        return;
                    }

                    const iconsDir = userDataDir('folder_icons');
                    GLib.mkdir_with_parents(iconsDir, 0o755);

                    const timestamp = Date.now();
                    const destPath = GLib.build_filenamev([iconsDir, `custom_folder_${timestamp}.${ext}`]);
                    const destFile = Gio.File.new_for_path(destPath);

                    try {
                        file.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                        customPickedImagePath = destPath;
                        customImgLabel.set_text(file.get_basename());
                    } catch (err) { }
                }
            });
        });

        customImgBox.append(customImgLabel);
        customImgBox.append(browseImgBtn);
        customImageRow.add_suffix(customImgBox);

        const emojiInput = new Adw.EntryRow({
            title: _('Enter Emoji (Only 1 emoji allowed)')
        });

        const errorLabel = new Gtk.Label({
            label: _('Only 1 emoji is allowed. Multiple emojis are not supported.'),
            css_classes: ['error'],
            visible: false,
            halign: Gtk.Align.START,
            margin_start: 12,
            margin_top: 4
        });

        emojiInput.connect('changed', () => {
            const val = emojiInput.get_text().replace(/^emoji:/, '').trim();
            const count = getGraphemeCount(val);
            if (count > 1) {
                emojiInput.add_css_class('error');
                errorLabel.set_visible(true);
            } else {
                emojiInput.remove_css_class('error');
                errorLabel.set_visible(false);
            }
        });

        let initialMode = 0;
        if (folderToEdit && folderToEdit.icon) {
            if (folderToEdit.icon.startsWith('emoji:')) {
                initialMode = 2;
                emojiInput.set_text(folderToEdit.icon.replace('emoji:', ''));
            } else if (folderToEdit.icon.startsWith('/')) {
                initialMode = 1;
            } else {
                initialMode = 0;
                const foundIdx = iconOptions.findIndex(opt => opt.value === folderToEdit.icon);
                if (foundIdx >= 0) {
                    iconInput.set_selected(foundIdx);
                }
            }
        }

        const syncModeVisibility = () => {
            const selected = modeRow.get_selected();
            iconInput.set_visible(selected === 0);
            customImageRow.set_visible(selected === 1);
            emojiInput.set_visible(selected === 2);
            if (selected !== 2) {
                errorLabel.set_visible(false);
                emojiInput.remove_css_class('error');
            } else {
                const val = emojiInput.get_text().replace(/^emoji:/, '').trim();
                const isErr = getGraphemeCount(val) > 1;
                errorLabel.set_visible(isErr);
                if (isErr) emojiInput.add_css_class('error');
            }
        };

        modeRow.connect('notify::selected', syncModeVisibility);
        modeRow.set_selected(initialMode);
        syncModeVisibility();

        inputGrp.add(nameInput);
        inputGrp.add(pathInput);
        inputGrp.add(modeRow);
        inputGrp.add(iconInput);
        inputGrp.add(customImageRow);
        inputGrp.add(emojiInput);
        vbox.append(inputGrp);
        vbox.append(errorLabel);
        dialog.set_extra_child(vbox);

        dialog.connect('response', (dlg, response) => {
            if (response === 'confirm') {
                const activeMode = modeRow.get_selected();

                if (activeMode === 2) {
                    const rawEmoji = emojiInput.get_text().replace(/^emoji:/, '').trim();
                    const emojiCount = getGraphemeCount(rawEmoji);

                    if (emojiCount > 1) {
                        emojiInput.add_css_class('error');
                        errorLabel.set_visible(true);
                        if (isGnome45) {
                            dialog.present();
                        } else {
                            dialog.present(window);
                        }
                        return;
                    }
                }

                const folderPath = pathInput.get_text().trim() || GLib.get_home_dir();
                const folderName = nameInput.get_text().trim() || _('Custom Folder');

                let finalIcon = 'folder';

                if (activeMode === 0) {
                    finalIcon = iconOptions[iconInput.get_selected()].value || 'folder';
                } else if (activeMode === 1) {
                    finalIcon = customPickedImagePath || 'folder';
                } else if (activeMode === 2) {
                    const rawEmoji = emojiInput.get_text().replace(/^emoji:/, '').trim();
                    finalIcon = rawEmoji ? `emoji:${rawEmoji}` : 'folder';
                }

                const itemData = {
                    name: folderName,
                    path: folderPath,
                    icon: finalIcon
                };

                if (isEditing) {
                    customFolders[editIndex] = itemData;
                } else {
                    customFolders.push(itemData);
                }

                settings.set_string('custom-folders', JSON.stringify(customFolders));
                buildFolderList();
            }

            if (isGnome45) dlg.close();
        });

        if (isGnome45) {
            dialog.present();
        } else {
            dialog.present(window);
        }
    };

    const buildFolderList = () => {
        let child = folderListBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            folderListBox.remove(child);
            child = next;
        }

        customFolders.forEach((f, idx) => {
            const row = new Adw.ActionRow({
                title: f.name,
                subtitle: f.path
            });

            const iconVal = f.icon || 'folder';

            if (iconVal.startsWith('emoji:')) {
                const cleanEmoji = iconVal.replace('emoji:', '');
                const emojiLabel = new Gtk.Label({
                    label: cleanEmoji,
                    css_classes: ['title-2'],
                    valign: Gtk.Align.CENTER
                });
                row.add_prefix(emojiLabel);
            } else if (iconVal.startsWith('/')) {
                try {
                    const gfile = Gio.File.new_for_path(iconVal);
                    if (gfile.query_exists(null)) {
                        const fileIcon = Gio.FileIcon.new(gfile);
                        const img = Gtk.Image.new_from_gicon(fileIcon);
                        img.set_pixel_size(24);
                        row.add_prefix(img);
                    } else {
                        row.set_icon_name('folder');
                    }
                } catch (e) {
                    row.set_icon_name('folder');
                }
            } else {
                row.set_icon_name(iconVal);
            }

            const actionsBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER
            });

            const editBtn = new Gtk.Button({
                icon_name: 'document-edit-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'circular'],
                tooltip_text: _('Edit folder')
            });

            editBtn.connect('clicked', () => {
                openFolderDialog(idx);
            });

            const delBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'circular', 'destructive-action'],
                tooltip_text: _('Remove folder')
            });

            delBtn.connect('clicked', () => {
                customFolders.splice(idx, 1);
                settings.set_string('custom-folders', JSON.stringify(customFolders));
                buildFolderList();
            });

            actionsBox.append(editBtn);
            actionsBox.append(delBtn);
            row.add_suffix(actionsBox);

            folderListBox.append(row);
        });

        const addRow = new Adw.ActionRow();
        addRow.set_activatable(true);
        const centerLabel = new Gtk.Label({
            label: `<b>+ ${_('Add Quick Folder')}</b>`,
            use_markup: true,
            halign: Gtk.Align.CENTER,
            margin_top: 14,
            margin_bottom: 14,
            css_classes: ['accent']
        });
        addRow.set_child(centerLabel);

        addRow.connect('activated', () => openFolderDialog(-1));
        folderListBox.append(addRow);
    };

    buildFolderList();

    const clockGroup = addGroup(page, _('Clock'), _('Date and time on the dock. Hidden on side docks'));
    const clockSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('show-clock', clockSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    addGroupReset(clockGroup, settings, ['clock-font-size']);
    const clockReset = clockGroup.get_header_suffix();
    const clockSuffix = new Gtk.Box({ spacing: 12, valign: Gtk.Align.CENTER });
    clockGroup.set_header_suffix(clockSuffix);
    clockSuffix.append(clockReset);
    clockSuffix.append(clockSwitch);

    const syncClockPosition = () => {
        const isFullWidth = settings.get_boolean('full-width');
        const position = settings.get_string('clock-position');
        if (!isFullWidth && position === 'RIGHT_END') settings.set_string('clock-position', 'END');
        else if (isFullWidth && position !== 'RIGHT_END') settings.set_string('clock-position', 'RIGHT_END');
    };
    onSettingChanged(settings, 'full-width', syncClockPosition);
    syncClockPosition();

    const clockRows = [
        addSegmentedRow(clockGroup, settings, 'clock-position', _('Position'), null, [
            { name: _('Start'), value: 'START' },
            { name: _('End'), value: 'END' },
        ]),
        addSwitchRow(clockGroup, settings, 'use-24h-clock', _('24-Hour Time')),
        addSliderRow(clockGroup, settings, 'clock-font-size', _('Text Size'), null, { lower: 10, upper: 36, step: 1 }, fmt.px),
    ];
    showWhen(clockRows[0], settings, ['show-clock', 'full-width'],
        () => settings.get_boolean('show-clock') && !settings.get_boolean('full-width'));
    for (const row of clockRows.slice(1)) showWhen(row, settings, ['show-clock'], () => settings.get_boolean('show-clock'));

    const backupGroup = addGroup(page, _('Backup'), _('Your settings, pinned apps and folders in one file'));
    const exportRow = new Adw.ActionRow({ title: _('Export'), subtitle: _('Save everything to a file') });
    const exportBtn = new Gtk.Button({ label: _('Export…'), valign: Gtk.Align.CENTER });
    exportRow.add_suffix(exportBtn);
    exportBtn.connect('clicked', () => exportConfig(window, settings, uuid));
    backupGroup.add(exportRow);

    const importRow = new Adw.ActionRow({ title: _('Import'), subtitle: _('Load a file you exported before') });
    const importBtn = new Gtk.Button({ label: _('Import…'), valign: Gtk.Align.CENTER });
    importRow.add_suffix(importBtn);
    importBtn.connect('clicked', () => importConfig(window, settings, uuid));
    backupGroup.add(importRow);

    const resetGroup = addGroup(page, null);
    const resetRow = new Adw.ActionRow({
        title: _('Start Over'),
        subtitle: _('Put every Dhruva setting back to its default'),
    });
    const resetBtn = new Gtk.Button({ label: _('Reset All…'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
    resetBtn.connect('clicked', () => confirmResetAll(window, settings));
    resetRow.add_suffix(resetBtn);
    resetGroup.add(resetRow);

    window.add(page);
}


function exportConfig(window, settings, uuid) {
    const dialog = new Gtk.FileDialog({ title: _('Export Dhruva Settings'), initial_name: 'dhruva_config.json' });
    dialog.save(window, null, (dlg, res) => {
        let file;
        try {
            file = dlg.save_finish(res);
        } catch (_e) {
            return;
        }

        const isIndependent = settings.get_boolean('independent-dock');
        const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid]);
        const config = { settings: {}, favorites: [], pinnedApps: null, folders: null };

        for (const key of settings.list_keys()) {
            if (isIndependent && key === 'app-folders') continue;
            config.settings[key] = settings.get_value(key).deep_unpack();
        }

        const readJson = name => {
            try {
                const [, contents] = GLib.file_get_contents(GLib.build_filenamev([configDir, name]));
                return JSON.parse(new TextDecoder().decode(contents));
            } catch (_e) {
                return [];
            }
        };

        if (isIndependent) {
            config.pinnedApps = readJson('dhruva-apps.json');
            config.folders = readJson('dhruva-folders.json');
        } else {
            config.favorites = new Gio.Settings({ schema_id: 'org.gnome.shell' }).get_strv('favorite-apps');
        }

        const path = file.get_path();
        if (path) GLib.file_set_contents(path, JSON.stringify(config, null, 2));
    });
}

function importConfig(window, settings, uuid) {
    const filter = new Gtk.FileFilter();
    filter.set_name(_('Dhruva settings (JSON)'));
    filter.add_mime_type('application/json');
    const filters = Gio.ListStore.new(Gtk.FileFilter);
    filters.append(filter);

    new Gtk.FileDialog({ title: _('Import Dhruva Settings'), filters }).open(window, null, (dlg, res) => {
        let file;
        try {
            file = dlg.open_finish(res);
        } catch (_e) {
            return;
        }

        file.load_contents_async(null, (f, r) => {
            let config;
            try {
                const [, contents] = f.load_contents_finish(r);
                config = JSON.parse(new TextDecoder().decode(contents));
            } catch (_e) {
                return;
            }

            const schema = settings.settings_schema;
            for (const [key, value] of Object.entries(config.settings || {})) {
                if (!schema.has_key(key)) continue;
                const type = schema.get_key(key).get_value_type().dup_string();
                settings.set_value(key, new GLib.Variant(type, value));
            }

            const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid]);
            const writeJson = (name, data) => {
                GLib.mkdir_with_parents(configDir, 0o755);
                GLib.file_set_contents(GLib.build_filenamev([configDir, name]), JSON.stringify(data, null, 2));
            };

            if (settings.get_boolean('independent-dock')) {
                if (Array.isArray(config.pinnedApps)) writeJson('dhruva-apps.json', config.pinnedApps);
                if (Array.isArray(config.folders)) writeJson('dhruva-folders.json', config.folders);
            } else if (Array.isArray(config.favorites)) {
                new Gio.Settings({ schema_id: 'org.gnome.shell' }).set_strv('favorite-apps', config.favorites);
            }
        });
    });
}

function confirmResetAll(window, settings) {
    const isGnome45 = !Adw.AlertDialog;
    const heading = _('Reset Every Setting?');
    const body = _('Dhruva goes back to how it looked on day one. This cannot be undone.');
    const dialog = isGnome45
        ? new Adw.MessageDialog({ heading, body, transient_for: window, modal: true })
        : new Adw.AlertDialog({ heading, body });

    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('reset', _('Reset'));
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.connect('response', (dlg, response) => {
        if (response === 'reset') settings.list_keys().forEach(key => settings.reset(key));
        if (isGnome45) dlg.close();
    });
    presentDialog(window, dialog, isGnome45);
}