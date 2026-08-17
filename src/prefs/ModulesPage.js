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

    addSwitchRow(prefs, modGroup, settings, 'show-trash', 'Recycle Bin (Trash)', 'Show a shortcut to the trash folder', 'user-trash-symbolic', null);
    addSwitchRow(prefs, modGroup, settings, 'show-desktop-button', 'Show Desktop Button', 'Quickly minimize all windows', 'computer-symbolic', null);

    addSwitchRow(prefs, modGroup, settings, 'show-grid-button', 'Show Applications Button', 'App drawer launcher', 'view-app-grid-symbolic', null);
    const gridPosRow = addSegmentedRow(prefs, modGroup, settings, 'grid-button-position', 'Application Button Position', 'Where to place the launcher', 'go-next-symbolic', [{
        name: 'Start',
        value: 'START'
    },
    {
        name: 'End',
        value: 'END'
    }
    ]);

    const gridColorRow = addColorRow(prefs, modGroup, settings, 'grid-icon-color', 'App Grid Button Color', 'preferences-desktop-appearance-symbolic');

    const oldGridIconRow = addSwitchRow(prefs, modGroup, settings, 'use-old-grid-icon', 'Use Old App Grid Icon', 'Show default dotted grid icon instead of Dhruva logo', 'view-app-grid-symbolic', null);

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
            const file = dlg.open_finish(res);
            if (file) {
                const ext = file.get_basename().split('.').pop().toLowerCase();

                if (!['png', 'svg', 'ico'].includes(ext)) {
                    return;
                }

                const configDir = GLib.get_user_config_dir() + '/dhruva@narkagni/icon';
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
        prefs,
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
        makeResetBtn(prefs, settings)
    );

    const syncGridSettingsVisibility = () => {
        const showGrid = settings.get_boolean('show-grid-button');
        const hasCustomIcon = settings.get_string('custom-grid-icon') !== '';
        const useOldIcon = settings.get_boolean('use-old-grid-icon');
        const isFullWidth = settings.get_boolean('full-width');

        gridPosRow.set_visible(showGrid && !isFullWidth);
        customIconRow.set_visible(showGrid);

        oldGridIconRow.set_visible(showGrid && !hasCustomIcon);
        customIconScaleRow.set_visible(showGrid && hasCustomIcon);

        gridColorRow.set_visible(showGrid && !hasCustomIcon && useOldIcon);

        resetIconBtn.set_sensitive(hasCustomIcon);
    };

    prefs._settingsSignals.push(settings.connect('changed::custom-grid-icon', syncGridSettingsVisibility));
    prefs._settingsSignals.push(settings.connect('changed::show-grid-button', syncGridSettingsVisibility));
    prefs._settingsSignals.push(settings.connect('changed::use-old-grid-icon', syncGridSettingsVisibility));
    prefs._settingsSignals.push(settings.connect('changed::full-width', syncGridSettingsVisibility));

    syncGridSettingsVisibility();

    const syncGridBtn = () => {
        const isFullWidth = settings.get_boolean('full-width');
        gridPosRow.set_visible(settings.get_boolean('show-grid-button') && !isFullWidth);
    };
    prefs._settingsSignals.push(settings.connect('changed::show-grid-button', syncGridBtn));
    prefs._settingsSignals.push(settings.connect('changed::full-width', syncGridBtn));
    syncGridBtn();

    const defaultFolderGroup = new Adw.PreferencesGroup({
        title: 'Standard Folders',
        description: 'Add quick access folders to the dock'
    });
    page.add(defaultFolderGroup);

    addSwitchRow(prefs, defaultFolderGroup, settings, 'show-home', 'Home', 'Shortcut to Home directory', 'user-home-symbolic', null);
    addSwitchRow(prefs, defaultFolderGroup, settings, 'show-downloads', 'Downloads', 'Shortcut to Downloads', 'folder-download-symbolic', null);
    addSwitchRow(prefs, defaultFolderGroup, settings, 'show-documents', 'Documents', 'Shortcut to Documents', 'folder-documents-symbolic', null);
    addSwitchRow(prefs, defaultFolderGroup, settings, 'show-pictures', 'Pictures', 'Shortcut to Pictures', 'folder-pictures-symbolic', null);
    addSwitchRow(prefs, defaultFolderGroup, settings, 'show-videos', 'Videos', 'Shortcut to Videos', 'folder-videos-symbolic', null);
    addSwitchRow(prefs, defaultFolderGroup, settings, 'show-music', 'Music', 'Shortcut to Music', 'folder-music-symbolic', null);

    const mountRow = new Adw.ActionRow({
        title: 'Show USB &amp; Mounted Drives',
        subtitle: 'Automatically show connected drives and partitions on the dock',
        icon_name: 'drive-harddisk-symbolic'
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

    let customFolders = [];
    try {
        customFolders = JSON.parse(settings.get_string('custom-folders') || '[]');
    } catch (e) { }

    const buildFolderList = () => {
        if (customFoldersGroup._rows) {
            customFoldersGroup._rows.forEach(r => customFoldersGroup.remove(r));
        }
        customFoldersGroup._rows = [];

        customFolders.forEach((f, idx) => {
            const row = new Adw.ActionRow({
                title: f.name,
                subtitle: f.path,
                icon_name: f.icon || 'folder-symbolic'
            });

            const delBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'circular', 'destructive-action']
            });

            delBtn.connect('clicked', () => {
                customFolders.splice(idx, 1);
                settings.set_string('custom-folders', JSON.stringify(customFolders));
                buildFolderList();
            });

            row.add_suffix(delBtn);
            customFoldersGroup.add(row);
            customFoldersGroup._rows.push(row);
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

        addRow.connect('activated', () => {
            const isGnome45 = !Adw.AlertDialog;
            let dialog;

            if (isGnome45) {
                dialog = new Adw.MessageDialog({
                    heading: 'Add Quick Folder',
                    transient_for: window,
                    modal: true
                });
            } else {
                dialog = new Adw.AlertDialog({
                    heading: 'Add Quick Folder'
                });
            }

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('add', 'Add');
            dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

            const vbox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 12
            });
            const inputGrp = new Adw.PreferencesGroup();

            const nameInput = new Adw.EntryRow({
                title: 'Name (e.g. Projects)'
            });
            const pathInput = new Adw.EntryRow({
                title: 'Path (e.g. /home/user/Projects)'
            });

            const iconOptions = [{
                name: 'Default Folder',
                value: 'folder-symbolic'
            },
            {
                name: 'Downloads',
                value: 'folder-download-symbolic'
            },
            {
                name: 'Documents',
                value: 'folder-documents-symbolic'
            },
            {
                name: 'Pictures',
                value: 'folder-pictures-symbolic'
            },
            {
                name: 'Videos',
                value: 'folder-videos-symbolic'
            },
            {
                name: 'Music',
                value: 'folder-music-symbolic'
            },
            {
                name: 'Public Share',
                value: 'folder-publicshare-symbolic'
            },
            {
                name: 'Templates',
                value: 'folder-templates-symbolic'
            },
            {
                name: 'Desktop',
                value: 'user-desktop-symbolic'
            },
            {
                name: 'Favorite (Heart)',
                value: 'emblem-favorite-symbolic'
            },
            {
                name: 'Star / Bookmark',
                value: 'bookmark-symbolic'
            },
            {
                name: 'Games',
                value: 'applications-games-symbolic'
            },
            {
                name: 'Code / Projects',
                value: 'applications-engineering-symbolic'
            },
            {
                name: 'Cloud / Remote',
                value: 'folder-remote-symbolic'
            }
            ];

            const iconModel = Gtk.StringList.new(iconOptions.map(opt => opt.name));
            const iconInput = new Adw.ComboRow({
                title: 'Folder Icon',
                model: iconModel
            });

            inputGrp.add(nameInput);
            inputGrp.add(pathInput);
            inputGrp.add(iconInput);
            vbox.append(inputGrp);
            dialog.set_extra_child(vbox);

            dialog.connect('response', (dlg, response) => {
                if (response === 'add') {
                    customFolders.push({
                        name: nameInput.get_text().trim() || 'Custom Folder',
                        path: pathInput.get_text().trim() || '/',
                        icon: iconOptions[iconInput.get_selected()].value
                    });
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
        });

        customFoldersGroup.add(addRow);
        customFoldersGroup._rows.push(addRow);
    };

    buildFolderList();

    const clockGroup = new Adw.PreferencesGroup({
        title: 'Clock &amp; Date',
        description: 'Display time on horizontal docks'
    });
    page.add(clockGroup);

    addSwitchRow(prefs, clockGroup, settings, 'show-clock', 'Show Clock', 'Hidden automatically on left/right docks', 'document-open-recent-symbolic', null);

    const use24hRow = addSwitchRow(prefs, clockGroup, settings, 'use-24h-clock', 'Use 24-Hour Clock', 'Display time in 24-hour format', 'preferences-system-time-symbolic', null);

    const clockSizeRow = addCustomSpinRow(prefs, clockGroup, settings, 'clock-font-size', 'Clock Text Size', 'Adjust font size', 'format-text-direction-symbolic', {
        lower: 10,
        upper: 36,
        step_increment: 1
    }, makeResetBtn(prefs, settings));
    
    let clockPosRow = null;

    const syncClockVisibility = () => {
        const showClock = settings.get_boolean('show-clock');
        const isFullWidth = settings.get_boolean('full-width');
        const currentPos = settings.get_string('clock-position');

        if (!isFullWidth && currentPos === 'RIGHT_END') {
            settings.set_string('clock-position', 'END');
        } 
        else if (isFullWidth && currentPos !== 'RIGHT_END') {
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

        clockPosRow = addSegmentedRow(prefs, clockGroup, settings, 'clock-position', 'Clock Position', 'Separate from App Grid', 'format-justify-right-symbolic', clockOptions);

        clockPosRow.set_visible(showClock);
        clockSizeRow.set_visible(showClock);
        use24hRow.set_visible(showClock);
    };

    prefs._settingsSignals.push(settings.connect('changed::show-clock', syncClockVisibility));
    prefs._settingsSignals.push(settings.connect('changed::full-width', syncClockVisibility)); 
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