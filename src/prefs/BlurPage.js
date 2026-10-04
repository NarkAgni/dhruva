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
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import { Settings } from '../core/SettingsManager.js';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export function buildBlurPage(window, settings) {
    if (!Settings.raw && settings) {
        Settings.init(settings);
    }

    const page = new Adw.PreferencesPage({
        title: _('Blur'),
        icon_name: 'view-paged-symbolic',
    });

    const masterGroup = new Adw.PreferencesGroup({
        title: _('Blur Material'),
        description: _('Apply refractive backdrop blur to Dhruva dock, menus and panels'),
    });
    page.add(masterGroup);

    const enableRow = new Adw.SwitchRow({
        title: _('Enable Blur'),
        subtitle: _('Overrides current theme with clean refractive blur material'),
    });
    settings.bind('blur-enabled', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    masterGroup.add(enableRow);

    const blurModeRow = new Adw.ActionRow({
        title: _('Blur Mode'),
        subtitle: _('Choose between live real-time tracking or static performance blur'),
    });

    const pillBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        valign: Gtk.Align.CENTER,
    });
    pillBox.add_css_class('linked');

    const dynamicBtn = new Gtk.ToggleButton({
        label: _('Dynamic'),
    });

    const staticBtn = new Gtk.ToggleButton({
        label: _('Static'),
        group: dynamicBtn,
    });

    if (Settings.blurMode === 'static') {
        staticBtn.set_active(true);
    } else {
        dynamicBtn.set_active(true);
    }

    dynamicBtn.connect('toggled', () => {
        if (dynamicBtn.get_active()) {
            Settings.blurMode = 'dynamic';
            Gio.Settings.sync();
        }
    });

    staticBtn.connect('toggled', () => {
        if (staticBtn.get_active()) {
            Settings.blurMode = 'static';
            Gio.Settings.sync();
        }
    });

    pillBox.append(dynamicBtn);
    pillBox.append(staticBtn);
    blurModeRow.add_suffix(pillBox);
    masterGroup.add(blurModeRow);

    const sourceRow = new Adw.ActionRow({
        title: _('Static Background Source'),
        subtitle: _('Choose between built-in vector presets or custom photo'),
    });

    const sourceBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        valign: Gtk.Align.CENTER,
    });
    sourceBox.add_css_class('linked');

    const presetBtn = new Gtk.ToggleButton({
        label: _('Preset'),
    });

    const customBtn = new Gtk.ToggleButton({
        label: _('Custom Photo'),
        group: presetBtn,
    });

    const currentSource = settings.get_string('blur-static-source') || 'preset';
    if (currentSource === 'custom') {
        customBtn.set_active(true);
    } else {
        presetBtn.set_active(true);
    }

    presetBtn.connect('toggled', () => {
        if (presetBtn.get_active()) {
            settings.set_string('blur-static-source', 'preset');
            Gio.Settings.sync();
            updateStaticVisibility();
        }
    });

    customBtn.connect('toggled', () => {
        if (customBtn.get_active()) {
            settings.set_string('blur-static-source', 'custom');
            Gio.Settings.sync();
            updateStaticVisibility();
        }
    });

    sourceBox.append(presetBtn);
    sourceBox.append(customBtn);
    sourceRow.add_suffix(sourceBox);
    masterGroup.add(sourceRow);

    const presetRow = new Adw.ComboRow({
        title: _('Static Blur Preset'),
        subtitle: _('Select an abstract background texture for static blur'),
        model: new Gtk.StringList({
            strings: [
                _('Abstract Dark'),
                _('Aurora Borealis'),
                _('Sunset Glow'),
                _('Cyberpunk Neon'),
                _('Minimal Slate'),
            ],
        }),
    });

    const presetKeys = [
        'abstract-dark',
        'aurora',
        'sunset',
        'cyberpunk',
        'minimal',
    ];

    const currentPreset = settings.get_string('blur-static-preset');
    const currentIdx = presetKeys.indexOf(currentPreset);
    if (currentIdx >= 0) presetRow.set_selected(currentIdx);

    presetRow.connect('notify::selected', () => {
        const idx = presetRow.get_selected();
        settings.set_string('blur-static-preset', presetKeys[idx]);
        Gio.Settings.sync();
    });
    masterGroup.add(presetRow);

    const showImageCropperDialog = (sourceFilePath, onCropped) => {
        let pixbuf;
        try {
            pixbuf = GdkPixbuf.Pixbuf.new_from_file(sourceFilePath);
        } catch (_) {
            return;
        }

        const origW = pixbuf.get_width();
        const origH = pixbuf.get_height();

        const iconSize = settings.get_int('icon-size') || 48;
        const spacing = settings.get_int('icon-spacing') || 6;
        const padding = settings.get_int('dock-padding') || 10;
        const dockHeightPad = settings.get_int('dock-height') || 6;

        let totalIcons = 14;
        try {
            const pinned = JSON.parse(settings.get_string('pinned-apps') || '[]');
            if (Array.isArray(pinned) && pinned.length > 0) totalIcons = pinned.length + 3;
        } catch (_) {}

        const realDockW = (totalIcons * iconSize) + ((totalIcons - 1) * spacing) + (padding * 2);
        const realDockH = iconSize + (Math.max(dockHeightPad, 4) * 2);
        const targetAspect = Math.max(6.0, realDockW / Math.max(1, realDockH));

        let cropW = origW;
        let cropH = Math.round(cropW / targetAspect);
        if (cropH > origH) {
            cropH = origH;
            cropW = Math.round(cropH * targetAspect);
        }

        const maxCropY = Math.max(0, origH - cropH);
        let cropX = Math.round((origW - cropW) / 2);
        let cropY = Math.round(maxCropY / 2);

        const isGnome45 = !Adw.AlertDialog;
        let dialog;
        const dialogTitle = _('Adjust Dock Banner Area');

        if (isGnome45) {
            dialog = new Adw.MessageDialog({
                heading: dialogTitle,
                transient_for: window,
                modal: true,
            });
        } else {
            dialog = new Adw.AlertDialog({
                heading: dialogTitle,
            });
        }

        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('apply', _('Apply'));
        dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);

        const contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8,
        });

        const helpLabel = new Gtk.Label({
            label: _('Use the slider to adjust vertical crop position'),
            css_classes: ['dim-label'],
            halign: Gtk.Align.CENTER,
        });
        contentBox.append(helpLabel);

        const previewW = 480;
        const scale = previewW / origW;
        const previewH = Math.round(origH * scale);

        const drawingArea = new Gtk.DrawingArea({
            content_width: previewW,
            content_height: previewH,
            halign: Gtk.Align.CENTER,
        });

        const previewPixbuf = pixbuf.scale_simple(previewW, previewH, GdkPixbuf.InterpType.BILINEAR);

        drawingArea.set_draw_func((area, cr, width, height) => {
            Gdk.cairo_set_source_pixbuf(cr, previewPixbuf, 0, 0);
            cr.paint();

            cr.setSourceRGBA(0, 0, 0, 0.65);
            cr.paint();

            const selX = cropX * scale;
            const selY = cropY * scale;
            const selW = cropW * scale;
            const selH = cropH * scale;

            cr.save();
            cr.rectangle(selX, selY, selW, selH);
            cr.clip();
            Gdk.cairo_set_source_pixbuf(cr, previewPixbuf, 0, 0);
            cr.paint();
            cr.restore();

            cr.setSourceRGBA(0.0, 0.85, 1.0, 0.95);
            cr.setLineWidth(2.5);
            cr.rectangle(selX, selY, selW, selH);
            cr.stroke();
        });

        const sliderBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            halign: Gtk.Align.CENTER,
        });

        const sliderLabel = new Gtk.Label({ label: _('Position:'), css_classes: ['dim-label'] });
        const scaleWidget = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, maxCropY, 1);
        scaleWidget.set_size_request(320, -1);
        scaleWidget.set_draw_value(false);
        scaleWidget.set_value(cropY);

        scaleWidget.connect('value-changed', () => {
            cropY = Math.round(scaleWidget.get_value());
            drawingArea.queue_draw();
        });

        sliderBox.append(sliderLabel);
        sliderBox.append(scaleWidget);

        contentBox.append(drawingArea);
        contentBox.append(sliderBox);
        dialog.set_extra_child(contentBox);

        dialog.connect('response', (dlg, response) => {
            if (response === 'apply') {
                const subPixbuf = pixbuf.new_subpixbuf(cropX, cropY, cropW, cropH);
                onCropped(subPixbuf);
            }
            if (isGnome45) dlg.close();
        });

        if (isGnome45) {
            dialog.present();
        } else {
            dialog.present(window);
        }
    };

    const customPhotoRow = new Adw.ActionRow({
        title: _('Custom Static Background'),
        subtitle: _('Choose and crop custom image (.png, .jpg, .jpeg, .svg, .webp)'),
        icon_name: 'image-x-generic-symbolic',
    });

    const photoBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER,
    });

    const currentCustomPath = settings.get_string('blur-custom-photo');
    const photoNameLabel = new Gtk.Label({
        label: currentCustomPath ? currentCustomPath.split('/').pop() : _('None'),
        css_classes: ['dim-label'],
        ellipsize: 3,
        max_width_chars: 14,
    });

    const browsePhotoBtn = new Gtk.Button({
        label: _('Browse...'),
    });

    browsePhotoBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
            title: _('Select Blur Background Image'),
        });
        const filter = new Gtk.FileFilter();
        filter.set_name(_('Images (.png, .jpg, .svg, .webp)'));
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/jpeg');
        filter.add_mime_type('image/svg+xml');
        filter.add_mime_type('image/webp');

        const filterList = Gio.ListStore.new(Gtk.FileFilter);
        filterList.append(filter);
        dialog.set_filters(filterList);

        dialog.open(window, null, (dlg, res) => {
            let file;
            try {
                file = dlg.open_finish(res);
            } catch (_) {
                return;
            }
            if (!file) return;

            const filePath = file.get_path();
            if (!filePath) return;

            showImageCropperDialog(filePath, (croppedPixbuf) => {
                const uuid = 'dhruva@narkagni';
                const userConfigDir = GLib.get_user_config_dir();
                const configDir = GLib.build_filenamev([userConfigDir, uuid, 'blur_bg']);
                GLib.mkdir_with_parents(configDir, 0o755);

                const timestamp = Date.now();
                const filename = `custom_blur_${timestamp}.png`;
                const destPath = GLib.build_filenamev([configDir, filename]);

                croppedPixbuf.savev(destPath, 'png', [], []);
                settings.set_string('blur-custom-photo', destPath);
                Gio.Settings.sync();
                photoNameLabel.set_text(file.get_basename());
            });
        });
    });

    const resetPhotoBtn = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        css_classes: ['flat', 'circular'],
        tooltip_text: _('Clear custom photo'),
    });

    resetPhotoBtn.connect('clicked', () => {
        settings.set_string('blur-custom-photo', '');
        Gio.Settings.sync();
        photoNameLabel.set_text(_('None'));
    });

    photoBox.append(photoNameLabel);
    photoBox.append(browsePhotoBtn);
    photoBox.append(resetPhotoBtn);
    customPhotoRow.add_suffix(photoBox);
    masterGroup.add(customPhotoRow);

    const updateStaticVisibility = () => {
        const isStatic = settings.get_string('blur-mode') === 'static';
        const isPreset = (settings.get_string('blur-static-source') || 'preset') !== 'custom';

        sourceRow.set_visible(isStatic);
        presetRow.set_visible(isStatic && isPreset);
        customPhotoRow.set_visible(isStatic && !isPreset);
    };

    updateStaticVisibility();
    staticBtn.connect('toggled', () => updateStaticVisibility());
    dynamicBtn.connect('toggled', () => updateStaticVisibility());

    const colorRow = new Adw.ActionRow({
        title: _('Tint Color'),
        subtitle: _('Surface tint accent for blur and background tone'),
    });

    const initialColor = new Gdk.RGBA();
    const currentHex = Settings.blurTintColor || '#ffffff';
    if (!initialColor.parse(currentHex)) {
        initialColor.parse('#ffffff');
    }

    const colorDialog = new Gtk.ColorDialog({ with_alpha: false });
    const colorButton = new Gtk.ColorDialogButton({
        dialog: colorDialog,
        rgba: initialColor,
        valign: Gtk.Align.CENTER,
    });

    colorButton.connect('notify::rgba', () => {
        const rgba = colorButton.get_rgba();
        const r = Math.round(rgba.red * 255).toString(16).padStart(2, '0');
        const g = Math.round(rgba.green * 255).toString(16).padStart(2, '0');
        const b = Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
        Settings.blurTintColor = `#\({r}\){g}${b}`;
        Gio.Settings.sync();
    });

    colorRow.add_suffix(colorButton);
    masterGroup.add(colorRow);

    const createSlider = (targetGroup, title, subtitle, key, min, max, step, digits) => {
        const row = new Adw.ActionRow({ title, subtitle });
        const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, min, max, step);
        scale.set_hexpand(true);
        scale.set_draw_value(true);
        scale.set_digits(digits);
        scale.set_value(settings.get_double(key));

        scale.connect('value-changed', () => {
            settings.set_double(key, scale.get_value());
            Gio.Settings.sync();
        });

        row.add_suffix(scale);
        targetGroup.add(row);
        return scale;
    };

    createSlider(masterGroup, _('Blur Intensity'), _('Radius diffusion spread'), 'blur-intensity', 0.0, 64.0, 1.0, 0);
    createSlider(masterGroup, _('Vibrancy'), _('Saturation behind blur'), 'blur-vibrancy', 0.5, 2.0, 0.05, 2);
    createSlider(masterGroup, _('Brightness'), _('0.0 dark tone, 1.0 bright tone'), 'blur-brightness', 0.0, 1.0, 0.01, 2);
    createSlider(masterGroup, _('Tint Opacity'), _('Color tint blend strength'), 'blur-tint-opacity', 0.0, 1.0, 0.01, 2);

    const opticsGroup = new Adw.PreferencesGroup({
        title: _('Optics & Dispersion'),
        description: _('Specular light angle and surface outline reflections'),
    });
    page.add(opticsGroup);

    createSlider(opticsGroup, _('Border Highlight Glow'), _('Edge outline shine reflection'), 'blur-border-glow', 0.0, 1.0, 0.05, 2);
    createSlider(opticsGroup, _('Highlight Angle'), _('Specular light angle in degrees'), 'blur-highlight-angle', 0.0, 360.0, 5.0, 0);

    window.add(page);
}