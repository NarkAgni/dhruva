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
import cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';
import PangoCairo from 'gi://PangoCairo';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import { userDataDir } from '../core/DataPaths.js';
import {
    fmt, addGroup, addGroupReset, showWhen, bindChoice, addChoiceCards, addSliderRow, addColorRow,
    parseColor, roundedRect, paintBackdrop, MOCK_ICON_COLORS,
} from './PrefsWidgets.js';


const PREVIEW_HEIGHT = 180;
const PREVIEW_RADIUS = 14;
const SOURCE_MAX_WIDTH = 1200;

const PRESETS = () => [
    { key: 'abstract-dark', name: _('Abstract Dark') },
    { key: 'aurora', name: _('Aurora Borealis') },
    { key: 'sunset', name: _('Sunset Glow') },
    { key: 'cyberpunk', name: _('Cyberpunk Neon') },
    { key: 'minimal', name: _('Minimal Slate') },
];

const LOOKS = () => [
    { name: _('Crystal'), values: { 'blur-intensity': 10, 'blur-vibrancy': 1.05, 'blur-brightness': 0.6, 'blur-tint-opacity': 0.05 } },
    { name: _('Frosted'), values: { 'blur-intensity': 30, 'blur-vibrancy': 1.2, 'blur-brightness': 0.55, 'blur-tint-opacity': 0.15 } },
    { name: _('Vivid'), values: { 'blur-intensity': 22, 'blur-vibrancy': 1.8, 'blur-brightness': 0.5, 'blur-tint-opacity': 0.2 } },
    { name: _('Midnight'), values: { 'blur-intensity': 36, 'blur-vibrancy': 0.9, 'blur-brightness': 0.15, 'blur-tint-opacity': 0.35 } },
];

const MATERIAL_KEYS = ['blur-tint-color', 'blur-intensity', 'blur-vibrancy', 'blur-brightness', 'blur-tint-opacity'];
const LIGHT_KEYS = ['blur-border-glow', 'blur-highlight-angle'];

function presetPath(key) {
    const extDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();
    return extDir.get_child('icons').get_child(`glass-preset-${key}.svg`).get_path();
}

function coverPixbuf(source, w, h) {
    const scale = Math.max(w / source.get_width(), h / source.get_height());
    const scaledW = Math.max(w, Math.ceil(source.get_width() * scale));
    const scaledH = Math.max(h, Math.ceil(source.get_height() * scale));
    const scaled = source.scale_simple(scaledW, scaledH, GdkPixbuf.InterpType.BILINEAR);
    return scaled.new_subpixbuf(Math.floor((scaledW - w) / 2), Math.floor((scaledH - h) / 2), w, h);
}

function loadPixbuf(path) {
    if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
    try {
        return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, SOURCE_MAX_WIDTH, -1, true);
    } catch (_e) {
        return null;
    }
}

class BlurPreview {
    constructor(settings, bgSettings, ifaceSettings) {
        this._settings = settings;
        this._bgSettings = bgSettings;
        this._ifaceSettings = ifaceSettings;
        this._source = null;
        this._sourceDirty = true;
        this._cacheKey = '';
        this._sharp = null;
        this._blurred = null;

        this.widget = new Gtk.DrawingArea({
            content_height: PREVIEW_HEIGHT,
            hexpand: true,
        });
        this.widget.set_draw_func((_area, cr, w, h) => this._draw(cr, w, h));
    }

    sourceChanged() {
        this._sourceDirty = true;
        this.widget.queue_draw();
    }

    redraw() {
        this.widget.queue_draw();
    }

    _wallpaperPath() {
        const isDark = this._ifaceSettings.get_string('color-scheme') === 'prefer-dark';
        const uri = this._bgSettings.get_string(isDark ? 'picture-uri-dark' : 'picture-uri') ||
            this._bgSettings.get_string('picture-uri');
        return uri ? Gio.File.new_for_uri(uri).get_path() : null;
    }

    _sourcePath() {
        const s = this._settings;
        if (s.get_string('blur-mode') !== 'static') return this._wallpaperPath();
        if (s.get_string('blur-static-source') === 'custom') return s.get_string('blur-custom-photo');
        return presetPath(s.get_string('blur-static-preset'));
    }

    _ensureImages(w, h) {
        if (this._sourceDirty) {
            this._source = loadPixbuf(this._sourcePath());
            this._sourceDirty = false;
            this._cacheKey = '';
        }
        if (!this._source) {
            this._sharp = null;
            this._blurred = null;
            return;
        }

        const intensity = this._settings.get_double('blur-intensity');
        const vibrancy = this._settings.get_double('blur-vibrancy');
        const key = `${w}x${h}|${Math.round(intensity)}|${vibrancy.toFixed(2)}`;
        if (key === this._cacheKey) return;

        this._sharp = coverPixbuf(this._source, w, h);

        const factor = 1 + intensity / 3;
        const midW = Math.max(1, Math.round(w / Math.sqrt(factor)));
        const midH = Math.max(1, Math.round(h / Math.sqrt(factor)));
        const smallW = Math.max(1, Math.round(w / factor));
        const smallH = Math.max(1, Math.round(h / factor));
        const blurred = this._sharp
            .scale_simple(midW, midH, GdkPixbuf.InterpType.BILINEAR)
            .scale_simple(smallW, smallH, GdkPixbuf.InterpType.BILINEAR)
            .scale_simple(w, h, GdkPixbuf.InterpType.BILINEAR);

        this._blurred = blurred.copy();
        blurred.saturate_and_pixelate(this._blurred, vibrancy, false);
        this._cacheKey = key;
    }

    _draw(cr, w, h) {
        const s = this._settings;
        const isEnabled = s.get_boolean('blur-enabled');
        this._ensureImages(w, h);

        roundedRect(cr, 0, 0, w, h, PREVIEW_RADIUS);
        cr.clip();

        if (this._sharp) {
            Gdk.cairo_set_source_pixbuf(cr, this._sharp, 0, 0);
            cr.paint();
        } else {
            paintBackdrop(cr, w, h);
        }

        const isPanel = s.get_boolean('hybrid-panel-mode');
        const dockH = isPanel ? 50 : 58;
        const dockW = isPanel ? w : Math.min(w - 48, 460);
        const dockX = (w - dockW) / 2;
        const dockY = isPanel ? h - dockH : h - dockH - 22;
        const dockR = isPanel ? 0 : 18;

        cr.save();
        roundedRect(cr, dockX, dockY, dockW, dockH, dockR);
        cr.clip();
        if (isEnabled && this._blurred) {
            Gdk.cairo_set_source_pixbuf(cr, this._blurred, 0, 0);
            cr.paint();

            const brightness = s.get_double('blur-brightness');
            if (brightness < 0.5) cr.setSourceRGBA(0, 0, 0, (0.5 - brightness) * 1.1);
            else cr.setSourceRGBA(1, 1, 1, (brightness - 0.5) * 0.5);
            cr.paint();

            const tint = parseColor(s.get_string('blur-tint-color'));
            cr.setSourceRGBA(tint.red, tint.green, tint.blue, s.get_double('blur-tint-opacity') * 0.7);
            cr.paint();
        } else {
            cr.setSourceRGBA(0.12, 0.12, 0.15, 0.88);
            cr.paint();
        }
        cr.restore();

        this._drawIcons(cr, dockX, dockY, dockW, dockH);
        if (!isPanel) this._drawEdge(cr, dockX, dockY, dockW, dockH, dockR, isEnabled);
        this._drawBadge(cr, isEnabled);
    }

    _drawIcons(cr, x, y, w, h) {
        const size = 34;
        const gap = 12;
        const count = MOCK_ICON_COLORS.length;
        const total = count * size + (count - 1) * gap;
        let iconX = x + (w - total) / 2;
        const iconY = y + (h - size) / 2;

        for (const [r, g, b] of MOCK_ICON_COLORS) {
            roundedRect(cr, iconX, iconY, size, size, 9);
            cr.setSourceRGBA(r, g, b, 0.95);
            cr.fill();
            iconX += size + gap;
        }
    }

    _drawEdge(cr, x, y, w, h, r, isEnabled) {
        roundedRect(cr, x + 0.5, y + 0.5, w - 1, h - 1, r);
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.14);
        cr.strokePreserve();

        const glow = isEnabled ? this._settings.get_double('blur-border-glow') : 0;
        if (glow <= 0) {
            cr.newPath();
            return;
        }

        const angle = this._settings.get_double('blur-highlight-angle') * Math.PI / 180;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const reach = w / 2;
        const gradient = new cairo.LinearGradient(
            cx - Math.cos(angle) * reach, cy + Math.sin(angle) * reach,
            cx + Math.cos(angle) * reach, cy - Math.sin(angle) * reach);
        gradient.addColorStopRGBA(0, 1, 1, 1, 0);
        gradient.addColorStopRGBA(1, 1, 1, 1, Math.min(1, glow));
        cr.setSource(gradient);
        cr.setLineWidth(1.6);
        cr.stroke();
    }

    _drawBadge(cr, isEnabled) {
        let text = _('Blur off');
        if (isEnabled) text = this._settings.get_string('blur-mode') === 'static' ? _('Static blur') : _('Dynamic blur');

        const layout = PangoCairo.create_layout(cr);
        layout.set_text(text, -1);
        layout.set_font_description(Pango.FontDescription.from_string('Sans Bold 9'));
        const [textW, textH] = layout.get_pixel_size();

        roundedRect(cr, 12, 12, textW + 20, textH + 10, (textH + 10) / 2);
        cr.setSourceRGBA(0, 0, 0, 0.45);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.92);
        cr.moveTo(22, 17);
        PangoCairo.show_layout(cr, layout);
    }
}


export function buildBlurPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Blur'),
        icon_name: 'view-paged-symbolic',
    });

    let cancellable = new Gio.Cancellable();
    window.connect('close-request', () => {
        if (cancellable) {
            cancellable.cancel();
            cancellable = null;
        }
        return false;
    });

    const bgSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });
    const ifaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
    const preview = new BlurPreview(settings, bgSettings, ifaceSettings);

    const heroGroup = addGroup(page, _('Blur Material'), _('Frosted glass behind the dock, menus and panels'));
    const enableSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind('blur-enabled', enableSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    heroGroup.set_header_suffix(enableSwitch);
    heroGroup.add(preview.widget);

    const isBlurOn = () => settings.get_boolean('blur-enabled');

    const modeGroup = addGroup(page, _('Mode'));
    addChoiceCards(modeGroup, settings, 'blur-mode', [
        {
            value: 'dynamic',
            icon: 'view-refresh-symbolic',
            title: _('Dynamic'),
            description: _('Follows windows and wallpaper behind the dock in real time'),
        },
        {
            value: 'static',
            icon: 'image-x-generic-symbolic',
            title: _('Static'),
            description: _('Blurs a fixed image once. Lightest on battery and GPU'),
        },
    ]);
    showWhen(modeGroup, settings, ['blur-enabled'], isBlurOn);

    const sourceGroup = addGroup(page, _('Background'), _('The image that static blur is made from'));
    const sourceSwitcher = new Gtk.Box({ valign: Gtk.Align.CENTER, css_classes: ['linked'] });
    const presetBtn = new Gtk.ToggleButton({ label: _('Presets') });
    const customBtn = new Gtk.ToggleButton({ label: _('Your Photo'), group: presetBtn });
    sourceSwitcher.append(presetBtn);
    sourceSwitcher.append(customBtn);
    sourceGroup.set_header_suffix(sourceSwitcher);
    bindChoice(settings, 'blur-static-source', new Map([['preset', presetBtn], ['custom', customBtn]]));

    const presetFlow = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.SINGLE,
        homogeneous: true,
        min_children_per_line: 2,
        max_children_per_line: 5,
        column_spacing: 6,
        row_spacing: 6,
    });
    const presetChildren = new Map();
    for (const { key, name } of PRESETS()) {
        const picture = Gtk.Picture.new_for_filename(presetPath(key));
        picture.set_content_fit(Gtk.ContentFit.COVER);
        picture.set_size_request(112, 64);
        picture.set_overflow(Gtk.Overflow.HIDDEN);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_top: 6,
            margin_bottom: 6,
            margin_start: 6,
            margin_end: 6,
        });
        box.append(picture);
        box.append(new Gtk.Label({ label: name, css_classes: ['caption'], ellipsize: Pango.EllipsizeMode.END }));

        const child = new Gtk.FlowBoxChild({ child: box });
        child._presetKey = key;
        presetChildren.set(key, child);
        presetFlow.append(child);
    }

    let isSyncingPreset = false;
    const syncPresetSelection = () => {
        const child = presetChildren.get(settings.get_string('blur-static-preset'));
        if (!child || child.is_selected()) return;
        isSyncingPreset = true;
        presetFlow.select_child(child);
        isSyncingPreset = false;
    };
    presetFlow.connect('selected-children-changed', () => {
        if (isSyncingPreset) return;
        const [selected] = presetFlow.get_selected_children();
        if (selected) settings.set_string('blur-static-preset', selected._presetKey);
    });
    onSettingChanged(settings, 'blur-static-preset', syncPresetSelection);
    syncPresetSelection();
    sourceGroup.add(presetFlow);

    const photoRow = new Adw.ActionRow({ title: _('Your Photo') });
    const photoThumb = new Gtk.Picture({
        content_fit: Gtk.ContentFit.COVER,
        width_request: 72,
        height_request: 40,
        valign: Gtk.Align.CENTER,
    });
    photoThumb.set_overflow(Gtk.Overflow.HIDDEN);
    photoRow.add_prefix(photoThumb);

    const browseBtn = new Gtk.Button({ label: _('Choose…'), valign: Gtk.Align.CENTER });
    const clearBtn = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
        tooltip_text: _('Remove photo'),
    });
    photoRow.add_suffix(browseBtn);
    photoRow.add_suffix(clearBtn);
    sourceGroup.add(photoRow);

    const syncPhoto = () => {
        const path = settings.get_string('blur-custom-photo');
        const hasPhoto = Boolean(path) && GLib.file_test(path, GLib.FileTest.EXISTS);
        photoThumb.set_filename(hasPhoto ? path : null);
        photoThumb.set_visible(hasPhoto);
        clearBtn.set_visible(hasPhoto);
        photoRow.set_subtitle(hasPhoto
            ? _('Pick another image to replace it')
            : _('Pick an image and choose which strip of it sits behind the dock'));
    };
    onSettingChanged(settings, 'blur-custom-photo', syncPhoto);
    syncPhoto();

    browseBtn.connect('clicked', () => pickCustomPhoto(window, settings, cancellable));
    clearBtn.connect('clicked', () => replaceCustomPhoto(settings, '', cancellable));

    const isCustomSource = () => settings.get_string('blur-static-source') === 'custom';
    showWhen(presetFlow, settings, ['blur-static-source'], () => !isCustomSource());
    showWhen(photoRow, settings, ['blur-static-source'], isCustomSource);
    showWhen(sourceGroup, settings, ['blur-enabled', 'blur-mode'],
        () => isBlurOn() && settings.get_string('blur-mode') === 'static');

    const materialGroup = addGroup(page, _('Glass'), _('Start from a look, then fine-tune'));
    addGroupReset(materialGroup, settings, MATERIAL_KEYS);

    const looksBox = new Gtk.Box({
        spacing: 8,
        homogeneous: true,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
    });

    const looks = LOOKS();
    const lookButtons = [];

    for (const { name, values } of looks) {
        const button = new Gtk.Button({ label: name, css_classes: ['pill'] });
        button.connect('clicked', () => {
            for (const [key, value] of Object.entries(values)) {
                settings.set_double(key, value);
            }
        });
        looksBox.append(button);
        lookButtons.push({ button, values });
    }

    const customLookBtn = new Gtk.Button({
        label: _('Custom'),
        css_classes: ['pill'],
    });
    looksBox.append(customLookBtn);

    const setLookActive = (btn, active) => {
        if (active) btn.add_css_class('suggested-action');
        else btn.remove_css_class('suggested-action');
    };

    const syncLookHighlight = () => {
        let matched = false;
        for (const { button, values } of lookButtons) {
            const isMatch = Object.entries(values).every(
                ([key, val]) => Math.abs(settings.get_double(key) - val) < 0.005
            );
            setLookActive(button, isMatch && !matched);
            if (isMatch) matched = true;
        }
        setLookActive(customLookBtn, !matched);
    };

    customLookBtn.connect('clicked', () => {
        for (const { button } of lookButtons) setLookActive(button, false);
        setLookActive(customLookBtn, true);
    });

    for (const key of ['blur-intensity', 'blur-vibrancy', 'blur-brightness', 'blur-tint-opacity']) {
        onSettingChanged(settings, key, syncLookHighlight);
    }
    syncLookHighlight();

    materialGroup.add(new Adw.PreferencesRow({ child: looksBox, activatable: false }));

    addColorRow(materialGroup, settings, 'blur-tint-color', _('Tint'), _('Colour washed over the glass'));
    addSliderRow(materialGroup, settings, 'blur-tint-opacity', _('Tint Strength'), _('How much of the tint shows'),
        { lower: 0, upper: 1, step: 0.01 }, fmt.fraction);
    addSliderRow(materialGroup, settings, 'blur-intensity', _('Blur'), _('How soft the background becomes'),
        { lower: 0, upper: 64, step: 1 }, fmt.px);
    addSliderRow(materialGroup, settings, 'blur-vibrancy', _('Vibrancy'), _('Colour saturation seen through the glass'),
        { lower: 0.5, upper: 2, step: 0.05 }, fmt.times);
    addSliderRow(materialGroup, settings, 'blur-brightness', _('Brightness'), _('Darker glass on the left, lighter on the right'),
        { lower: 0, upper: 1, step: 0.01 }, fmt.fraction);
    showWhen(materialGroup, settings, ['blur-enabled'], isBlurOn);

    const lightGroup = addGroup(page, _('Edge Light'), _('A thin highlight along the rim of the glass'));
    addGroupReset(lightGroup, settings, LIGHT_KEYS);
    addSliderRow(lightGroup, settings, 'blur-border-glow', _('Glow'), _('Strength of the rim highlight'),
        { lower: 0, upper: 1, step: 0.05 }, fmt.fraction);
    addSliderRow(lightGroup, settings, 'blur-highlight-angle', _('Light Direction'), _('Where the light falls from'),
        { lower: 0, upper: 360, step: 5 }, fmt.deg);
    showWhen(lightGroup, settings, ['blur-enabled', 'hybrid-panel-mode'],
        () => isBlurOn() && !settings.get_boolean('hybrid-panel-mode'));

    for (const key of ['blur-mode', 'blur-static-source', 'blur-static-preset', 'blur-custom-photo'])
        onSettingChanged(settings, key, () => preview.sourceChanged());
    for (const key of ['picture-uri', 'picture-uri-dark'])
        onSettingChanged(bgSettings, key, () => preview.sourceChanged());
    onSettingChanged(ifaceSettings, 'color-scheme', () => preview.sourceChanged());
    for (const key of ['blur-enabled', 'hybrid-panel-mode', ...MATERIAL_KEYS, ...LIGHT_KEYS])
        onSettingChanged(settings, key, () => preview.redraw());

    window.add(page);
}

function replaceCustomPhoto(settings, newPath, cancellable = null) {
    const oldPath = settings.get_string('blur-custom-photo');
    settings.set_string('blur-custom-photo', newPath);

    const ownDir = userDataDir('blur_bg');
    if (oldPath && oldPath !== newPath && oldPath.startsWith(`${ownDir}/`)) {
        Gio.File.new_for_path(oldPath).delete_async(GLib.PRIORITY_DEFAULT, cancellable, () => {});
    }
}

function pickCustomPhoto(window, settings, cancellable = null) {
    if (cancellable && cancellable.is_cancelled()) return;
    const filter = new Gtk.FileFilter();
    filter.set_name(_('Images'));
    for (const mime of ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']) filter.add_mime_type(mime);
    const filters = Gio.ListStore.new(Gtk.FileFilter);
    filters.append(filter);

    const dialog = new Gtk.FileDialog({ title: _('Choose a Background Photo'), filters });
    dialog.open(window, cancellable, (dlg, res) => {
        let file;
        try {
            file = dlg.open_finish(res);
        } catch (_e) {
            return;
        }
        if (cancellable && cancellable.is_cancelled()) return;
        const path = file.get_path();
        if (!path) return;

        showCropDialog(window, settings, path, cropped => {
            if (cancellable && cancellable.is_cancelled()) return;
            const dir = userDataDir('blur_bg');
            GLib.mkdir_with_parents(dir, 0o755);
            const destPath = GLib.build_filenamev([dir, `custom_blur_${Date.now()}.png`]);
            cropped.savev(destPath, 'png', [], []);
            replaceCustomPhoto(settings, destPath, cancellable);
        });
    });
}

function showCropDialog(window, settings, sourcePath, onCropped) {
    let pixbuf;
    try {
        pixbuf = GdkPixbuf.Pixbuf.new_from_file(sourcePath);
    } catch (_e) {
        return;
    }

    const origW = pixbuf.get_width();
    const origH = pixbuf.get_height();

    const iconSize = settings.get_int('icon-size');
    const spacing = settings.get_int('icon-spacing');
    const padding = settings.get_int('dock-padding');
    const thickness = Math.max(settings.get_int('dock-height'), 4);
    const iconCount = 14;
    const dockW = iconCount * iconSize + (iconCount - 1) * spacing + padding * 2;
    const dockH = iconSize + thickness * 2;
    const aspect = Math.max(6, dockW / Math.max(1, dockH));

    let cropW = origW;
    let cropH = Math.round(cropW / aspect);
    if (cropH > origH) {
        cropH = origH;
        cropW = Math.round(cropH * aspect);
    }
    const cropX = Math.round((origW - cropW) / 2);
    const maxCropY = Math.max(0, origH - cropH);
    let cropY = Math.round(maxCropY / 2);

    const isGnome45 = !Adw.AlertDialog;
    const heading = _('Choose the Strip Behind the Dock');
    const dialog = isGnome45
        ? new Adw.MessageDialog({ heading, transient_for: window, modal: true })
        : new Adw.AlertDialog({ heading });
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('apply', _('Use This'));
    dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);

    const previewW = 480;
    const scale = previewW / origW;
    const previewH = Math.round(origH * scale);
    const previewPixbuf = pixbuf.scale_simple(previewW, previewH, GdkPixbuf.InterpType.BILINEAR);

    const area = new Gtk.DrawingArea({ content_width: previewW, content_height: previewH, halign: Gtk.Align.CENTER });
    area.set_draw_func((_area, cr) => {
        Gdk.cairo_set_source_pixbuf(cr, previewPixbuf, 0, 0);
        cr.paint();
        cr.setSourceRGBA(0, 0, 0, 0.6);
        cr.paint();

        roundedRect(cr, cropX * scale, cropY * scale, cropW * scale, cropH * scale, 6);
        cr.save();
        cr.clip();
        Gdk.cairo_set_source_pixbuf(cr, previewPixbuf, 0, 0);
        cr.paint();
        cr.restore();

        roundedRect(cr, cropX * scale, cropY * scale, cropW * scale, cropH * scale, 6);
        cr.setSourceRGBA(1, 1, 1, 0.9);
        cr.setLineWidth(2);
        cr.stroke();
    });

    const slider = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, Math.max(1, maxCropY), 1);
    slider.set_draw_value(false);
    slider.set_value(cropY);
    slider.set_sensitive(maxCropY > 0);
    slider.connect('value-changed', () => {
        cropY = Math.round(slider.get_value());
        area.queue_draw();
    });

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
    content.append(area);
    content.append(slider);
    dialog.set_extra_child(content);

    dialog.connect('response', (dlg, response) => {
        if (response === 'apply') onCropped(pixbuf.new_subpixbuf(cropX, cropY, cropW, cropH));
        if (isGnome45) dlg.close();
    });

    if (isGnome45) dialog.present();
    else dialog.present(window);
}