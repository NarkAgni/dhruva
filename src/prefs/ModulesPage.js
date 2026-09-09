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

import { makeResetBtn } from './ResetButtons.js';
import { addSwitchRow, addSegmentedRow, addColorRow, addCustomSpinRow } from './PrefsWidgets.js';


function getGraphemeCount(str) {
    if (!str) return 0;
    try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        return Array.from(segmenter.segment(str)).length;
    } catch (e) {
        return Array.from(str).length;
    }
}

export function buildModulesPage(prefs, window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Modules',
        icon_name: 'application-x-addon-symbolic'
    });
    window.add(page);

    const modGroup = new Adw.PreferencesGroup({
        title: 'Dock Modules',
        description: 'Enable extra shortcuts on your dock'
    });
    page.add(modGroup);

    addSwitchRow(modGroup, settings, 'show-trash', 'Recycle Bin (Trash)', 'Show a shortcut to the trash folder', 'user-trash-symbolic', null);
    addSwitchRow(modGroup, settings, 'show-desktop-button', 'Show Desktop Button', 'Quickly minimize all windows', 'computer-symbolic', null);
    addSwitchRow(modGroup, settings, 'show-grid-button', 'Show Applications Button', 'App drawer launcher', 'view-app-grid-symbolic', null);
    const gridPosRow = addSegmentedRow(modGroup, settings, 'grid-button-position', 'Application Button Position', 'Where to place the launcher', 'go-next-symbolic', [
        { name: 'Left Edge', value: 'LEFT_EDGE' },
        { name: 'Start', value: 'START' },
        { name: 'End', value: 'END' }
    ]);

    const gridColorRow = addColorRow(modGroup, settings, 'grid-icon-color', 'App Grid Button Color', 'preferences-desktop-appearance-symbolic');

    const oldGridIconRow = addSwitchRow(modGroup, settings, 'use-old-grid-icon', 'Use Old App Grid Icon', 'Show default dotted grid icon instead of Dhruva logo', 'view-app-grid-symbolic', null);

    const customIconRow = new Adw.ActionRow({
        title: 'Custom App Grid Icon',
        subtitle: 'Size: 256x256 or 512x512 (.png, .svg, .ico)',
        icon_name: 'image-x-generic-symbolic'
    });

    const iconBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER
    });
    const chooseBtn = new Gtk.Button({
        label: 'Browse...'
    });

    chooseBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
            title: 'Select App Custom Grid Icon'
        });
        const filter = new Gtk.FileFilter();
        filter.set_name('Images (.png, .svg, .ico)');
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/svg+xml');
        filter.add_mime_type('image/x-icon');
        filter.add_mime_type('image/vnd.microsoft.icon');

        const filterList = Gio.ListStore.new(Gtk.FileFilter);
        filterList.append(filter);
        dialog.set_filters(filterList);

        dialog.open(window, null, (dlg, res) => {
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

                const uuid = prefs.metadata.uuid || 'dhruva@narkagni';
                const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid, 'icon']);
                GLib.mkdir_with_parents(configDir, 0o755);
                const dir = Gio.File.new_for_path(configDir);
                const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let fileInfo;
                while ((fileInfo = enumerator.next_file(null))) {
                    dir.get_child(fileInfo.get_name()).delete(null);
                }

                const timestamp = Date.now();
                const destPath = `${configDir}/custom_grid_icon_${timestamp}.${ext}`;
                const destFile = Gio.File.new_for_path(destPath);

                file.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                settings.set_string('custom-grid-icon', destPath);
            }
        });
    });

    const resetIconBtn = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        css_classes: ['flat', 'circular'],
        tooltip_text: 'Reset to default icon'
    });
    resetIconBtn.connect('clicked', () => {
        settings.set_string('custom-grid-icon', '');
    });

    iconBox.append(chooseBtn);
    iconBox.append(resetIconBtn);
    customIconRow.add_suffix(iconBox);
    modGroup.add(customIconRow);

    const customIconScaleRow = addCustomSpinRow(
        modGroup,
        settings,
        'custom-grid-icon-scale',
        'Custom Icon Scale (%)',
        'Adjust size multiplier (Default: 125)',
        'zoom-in-symbolic', {
        lower: 50,
        upper: 300,
        step_increment: 5
    },
        makeResetBtn(settings)
    );

    const syncGridSettingsVisibility = () => {
        const showGrid = settings.get_boolean('show-grid-button');
        const hasCustomIcon = settings.get_string('custom-grid-icon') !== '';
        const useOldIcon = settings.get_boolean('use-old-grid-icon');

        gridPosRow.set_visible(showGrid);
        customIconRow.set_visible(showGrid);

        oldGridIconRow.set_visible(showGrid && !hasCustomIcon);
        customIconScaleRow.set_visible(showGrid && hasCustomIcon);

        gridColorRow.set_visible(showGrid && !hasCustomIcon && useOldIcon);

        resetIconBtn.set_sensitive(hasCustomIcon);
    };

    settings.connect('changed::custom-grid-icon', syncGridSettingsVisibility);
    settings.connect('changed::show-grid-button', syncGridSettingsVisibility);
    settings.connect('changed::use-old-grid-icon', syncGridSettingsVisibility);
    settings.connect('changed::full-width', syncGridSettingsVisibility);

    syncGridSettingsVisibility();

    const syncGridBtn = () => {
        gridPosRow.set_visible(settings.get_boolean('show-grid-button'));
    };
    settings.connect('changed::show-grid-button', syncGridBtn);
    settings.connect('changed::full-width', syncGridBtn);
    syncGridBtn();

    const defaultFolderGroup = new Adw.PreferencesGroup({
        title: 'Standard Folders',
        description: 'Add quick access folders to the dock'
    });
    page.add(defaultFolderGroup);

    addSwitchRow(defaultFolderGroup, settings, 'show-home', 'Home', 'Shortcut to Home directory', 'user-home', null);
    addSwitchRow(defaultFolderGroup, settings, 'show-downloads', 'Downloads', 'Shortcut to Downloads', 'folder-download', null);
    addSwitchRow(defaultFolderGroup, settings, 'show-documents', 'Documents', 'Shortcut to Documents', 'folder-documents', null);
    addSwitchRow(defaultFolderGroup, settings, 'show-pictures', 'Pictures', 'Shortcut to Pictures', 'folder-pictures', null);
    addSwitchRow(defaultFolderGroup, settings, 'show-videos', 'Videos', 'Shortcut to Videos', 'folder-videos', null);
    addSwitchRow(defaultFolderGroup, settings, 'show-music', 'Music', 'Shortcut to Music', 'folder-music', null);

    const mountRow = new Adw.ActionRow({
        title: 'Show USB &amp; Mounted Drives',
        subtitle: 'Automatically show connected drives and partitions on the dock',
        icon_name: 'drive-harddisk'
    });

    const mountToggle = new Gtk.Switch({
        active: settings.get_boolean('show-mounts'),
        valign: Gtk.Align.CENTER,
    });

    settings.bind(
        'show-mounts',
        mountToggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    mountRow.add_suffix(mountToggle);
    defaultFolderGroup.add(mountRow);

    const customFoldersGroup = new Adw.PreferencesGroup({
        title: 'Custom Quick Folders',
        description: 'Add your own directory shortcuts to the dock'
    });
    page.add(customFoldersGroup);

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
        { name: 'System Folder (Default)', value: 'folder' },
        { name: 'Home', value: 'user-home' },
        { name: 'Downloads', value: 'folder-download' },
        { name: 'Documents', value: 'folder-documents' },
        { name: 'Pictures', value: 'folder-pictures' },
        { name: 'Videos', value: 'folder-videos' },
        { name: 'Music', value: 'folder-music' },
        { name: 'Public Share', value: 'folder-publicshare' },
        { name: 'Templates', value: 'folder-templates' },
        { name: 'Desktop', value: 'user-desktop' },
        { name: 'Projects / Code', value: 'folder-development' },
        { name: 'Cloud / Remote', value: 'folder-remote' }
    ];

    const openFolderDialog = (editIndex) => {
        const isEditing = (typeof editIndex === 'number' && editIndex >= 0);
        const folderToEdit = isEditing ? customFolders[editIndex] : null;

        const isGnome45 = !Adw.AlertDialog;
        let dialog;

        const headingTitle = isEditing ? 'Edit Quick Folder' : 'Add Quick Folder';
        const actionLabel = isEditing ? 'Update' : 'Add';

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

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('confirm', actionLabel);
        dialog.set_response_appearance('confirm', Adw.ResponseAppearance.SUGGESTED);

        const vbox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12
        });
        const inputGrp = new Adw.PreferencesGroup();

        const nameInput = new Adw.EntryRow({
            title: 'Folder Name (e.g. Workspace)'
        });
        if (folderToEdit && folderToEdit.name) {
            nameInput.set_text(folderToEdit.name);
        }

        const pathInput = new Adw.EntryRow({
            title: 'Folder Path'
        });
        if (folderToEdit && folderToEdit.path) {
            pathInput.set_text(folderToEdit.path);
        }

        const browseFolderBtn = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Browse folder...'
        });

        browseFolderBtn.connect('clicked', () => {
            const fileDialog = new Gtk.FileDialog({
                title: 'Select Folder'
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
            'Preset System Icon',
            'Custom Image File',
            'Custom Emoji'
        ]);

        const modeRow = new Adw.ComboRow({
            title: 'Icon Type',
            model: modeModel
        });

        const iconModel = Gtk.StringList.new(iconOptions.map(opt => opt.name));
        const iconInput = new Adw.ComboRow({
            title: 'Select Preset Icon',
            model: iconModel
        });

        const customImageRow = new Adw.ActionRow({
            title: 'Select Image File',
            subtitle: 'PNG, SVG, ICO format'
        });

        let customPickedImagePath = (folderToEdit && folderToEdit.icon && folderToEdit.icon.startsWith('/')) ? folderToEdit.icon : '';

        const customImgBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER
        });

        const initialImgLabel = customPickedImagePath ? customPickedImagePath.split('/').pop() : 'None';
        const customImgLabel = new Gtk.Label({
            label: initialImgLabel,
            css_classes: ['dim-label'],
            ellipsize: 3,
            max_width_chars: 14
        });

        const browseImgBtn = new Gtk.Button({
            label: 'Browse...'
        });

        browseImgBtn.connect('clicked', () => {
            const imgDialog = new Gtk.FileDialog({
                title: 'Select Custom Folder Icon Image'
            });
            const filter = new Gtk.FileFilter();
            filter.set_name('Images (.png, .svg, .ico)');
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

                    const uuid = prefs.metadata.uuid || 'dhruva@narkagni';
                    const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid, 'folder_icons']);
                    GLib.mkdir_with_parents(configDir, 0o755);

                    const timestamp = Date.now();
                    const destPath = GLib.build_filenamev([configDir, `custom_folder_${timestamp}.${ext}`]);
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
            title: 'Enter Emoji (Only 1 emoji allowed)'
        });

        const errorLabel = new Gtk.Label({
            label: 'Only 1 emoji is allowed. Multiple emojis are not supported.',
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
                const folderName = nameInput.get_text().trim() || 'Custom Folder';

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
                tooltip_text: 'Edit folder'
            });

            editBtn.connect('clicked', () => {
                openFolderDialog(idx);
            });

            const delBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'circular', 'destructive-action'],
                tooltip_text: 'Remove folder'
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
            label: '<b>+ Add Quick Folder</b>',
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

    const clockGroup = new Adw.PreferencesGroup({
        title: 'Clock &amp; Date',
        description: 'Display time on horizontal docks'
    });
    page.add(clockGroup);

    addSwitchRow(clockGroup, settings, 'show-clock', 'Show Clock', 'Hidden automatically on left/right docks', 'document-open-recent-symbolic', null);

    const use24hRow = addSwitchRow(clockGroup, settings, 'use-24h-clock', 'Use 24-Hour Clock', 'Display time in 24-hour format', 'preferences-system-time-symbolic', null);

    const clockSizeRow = addCustomSpinRow(clockGroup, settings, 'clock-font-size', 'Clock Text Size', 'Adjust font size', 'format-text-direction-symbolic', {
        lower: 10,
        upper: 36,
        step_increment: 1
    }, makeResetBtn(settings));

    let clockPosRow = null;

    const syncClockVisibility = () => {
        const showClock = settings.get_boolean('show-clock');
        const isFullWidth = settings.get_boolean('full-width');
        const currentPos = settings.get_string('clock-position');

        if (!isFullWidth && currentPos === 'RIGHT_END') {
            settings.set_string('clock-position', 'END');
        } else if (isFullWidth && currentPos !== 'RIGHT_END') {
            settings.set_string('clock-position', 'RIGHT_END');
        }

        if (clockPosRow) {
            clockGroup.remove(clockPosRow);
        }

        const clockOptions = [
            { name: 'Start', value: 'START' },
            { name: 'End', value: 'END' }
        ];

        if (isFullWidth) {
            clockOptions.push({ name: 'Right Edge', value: 'RIGHT_END' });
        }

        clockPosRow = addSegmentedRow(clockGroup, settings, 'clock-position', 'Clock Position', 'Separate from App Grid', 'format-justify-right-symbolic', clockOptions);

        clockPosRow.set_visible(showClock);
        clockSizeRow.set_visible(showClock);
        use24hRow.set_visible(showClock);
    };

    settings.connect('changed::show-clock', syncClockVisibility);
    settings.connect('changed::full-width', syncClockVisibility);
    syncClockVisibility();

    const dangerGroup = new Adw.PreferencesGroup({
        title: 'Danger Zone',
        description: 'Master controls for your settings'
    });
    page.add(dangerGroup);

    const backupGroup = new Adw.PreferencesGroup({
        title: 'Backup &amp; Restore',
        description: 'Import or export your dock layout, themes, custom folders, and pinned apps'
    });
    page.add(backupGroup);

    const exportRow = new Adw.ActionRow({
        title: 'Export Configuration',
        subtitle: 'Save your current settings and apps to a file',
        icon_name: 'document-export-symbolic'
    });

    const exportBtn = new Gtk.Button({
        label: 'Export',
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
        width_request: 100
    });
    exportRow.add_suffix(exportBtn);

    exportBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: 'Export Dock Configuration' });
        dialog.set_initial_name('dhruva_config.json');

        dialog.save(window, null, (dlg, res) => {
            let file;
            try { file = dlg.save_finish(res); } catch (_) { return; }
            if (!file) return;

            const isIndependent = settings.get_boolean('independent-dock');
            const uuid = prefs.metadata.uuid || 'dhruva@narkagni';
            const extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid]);

            const config = { settings: {}, favorites: [], pinnedApps: null, folders: null };

            settings.list_keys().forEach(key => {
                if (isIndependent && key === 'app-folders') return;
                config.settings[key] = settings.get_value(key).deep_unpack();
            });

            if (isIndependent) {
                try {
                    const appsPath = GLib.build_filenamev([extConfigDir, 'dhruva-apps.json']);
                    const [ok, contents] = GLib.file_get_contents(appsPath);
                    if (ok) config.pinnedApps = JSON.parse(new TextDecoder().decode(contents));
                } catch (_) { config.pinnedApps = []; }

                try {
                    const foldersPath = GLib.build_filenamev([extConfigDir, 'dhruva-folders.json']);
                    const [ok, contents] = GLib.file_get_contents(foldersPath);
                    if (ok) config.folders = JSON.parse(new TextDecoder().decode(contents));
                } catch (_) { config.folders = []; }
            } else {
                try {
                    const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
                    config.favorites = shellSettings.get_strv('favorite-apps');
                } catch (_) { }
            }

            const jsonStr = JSON.stringify(config, null, 2);
            const path = file.get_path();
            if (path) GLib.file_set_contents(path, jsonStr);
        });
    });
    backupGroup.add(exportRow);

    const importRow = new Adw.ActionRow({
        title: 'Import Configuration',
        subtitle: 'Load a previously saved configuration file',
        icon_name: 'document-import-symbolic'
    });

    const importBtn = new Gtk.Button({
        label: 'Import',
        valign: Gtk.Align.CENTER,
        width_request: 100
    });
    importRow.add_suffix(importBtn);

    importBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: 'Import Dock Configuration' });
        const filter = new Gtk.FileFilter();
        filter.set_name('JSON Files');
        filter.add_mime_type('application/json');

        const filterList = Gio.ListStore.new(Gtk.FileFilter);
        filterList.append(filter);
        dialog.set_filters(filterList);

        dialog.open(window, null, (dlg, res) => {
            let file;
            try { file = dlg.open_finish(res); } catch (_) { return; }
            if (!file) return;

            file.load_contents_async(null, (f, r) => {
                let success, contents;
                try { [success, contents] = f.load_contents_finish(r); } catch (_) { return; }
                if (!success) return;

                let config;
                try { config = JSON.parse(new TextDecoder().decode(contents)); } catch (_) { return; }

                const isIndependent = settings.get_boolean('independent-dock');
                const uuid = prefs.metadata.uuid || 'dhruva@narkagni';
                const extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), uuid]);

                if (config.settings) {
                    Object.keys(config.settings).forEach(key => {
                        try {
                            if (settings.settings_schema.has_key(key)) {
                                const typeStr = settings.settings_schema.get_key(key).get_value_type().dup_string();
                                const variant = new GLib.Variant(typeStr, config.settings[key]);
                                settings.set_value(key, variant);
                            }
                        } catch (_) { }
                    });
                }

                if (isIndependent) {
                    if (config.pinnedApps && Array.isArray(config.pinnedApps)) {
                        GLib.mkdir_with_parents(extConfigDir, 0o755);
                        const appsPath = GLib.build_filenamev([extConfigDir, 'dhruva-apps.json']);
                        GLib.file_set_contents(appsPath, JSON.stringify(config.pinnedApps, null, 2));
                    }
                    if (config.folders && Array.isArray(config.folders)) {
                        GLib.mkdir_with_parents(extConfigDir, 0o755);
                        const foldersPath = GLib.build_filenamev([extConfigDir, 'dhruva-folders.json']);
                        GLib.file_set_contents(foldersPath, JSON.stringify(config.folders, null, 2));
                    }
                } else {
                    if (config.favorites && Array.isArray(config.favorites)) {
                        try {
                            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
                            shellSettings.set_strv('favorite-apps', config.favorites);
                        } catch (_) { }
                    }
                }
            });
        });
    });
    backupGroup.add(importRow);

    const resetAllRow = new Adw.ActionRow({
        title: 'Reset All Settings',
        subtitle: 'Restore all Dhruva Dock settings to their default values',
        icon_name: 'edit-delete-symbolic'
    });

    const resetAllBtn = new Gtk.Button({
        label: 'Reset Defaults',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action']
    });

    resetAllBtn.connect('clicked', () => {
        const isGnome45 = !Adw.AlertDialog;
        let dialog;

        if (isGnome45) {
            dialog = new Adw.MessageDialog({
                heading: 'Reset All Settings?',
                body: 'Are you sure you want to reset all settings to default? This action cannot be undone.',
                transient_for: window,
                modal: true
            });
        } else {
            dialog = new Adw.AlertDialog({
                heading: 'Reset All Settings?',
                body: 'Are you sure you want to reset all settings to default? This action cannot be undone.'
            });
        }

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('reset', 'Reset Settings');
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);

        dialog.connect('response', (dlg, response) => {
            if (response === 'reset') {
                settings.list_keys().forEach(k => settings.reset(k));
            }
            if (isGnome45) dlg.close();
        });

        if (isGnome45) {
            dialog.present();
        } else {
            dialog.present(window);
        }
    });

    resetAllRow.add_suffix(resetAllBtn);
    dangerGroup.add(resetAllRow);
}