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
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import { gettext as _, ngettext } from 'resource:///org/gnome/shell/extensions/extension.js';

import { setBoxVertical, isActorAlive } from '../../core/Utils.js';
import { TimeoutTracker } from '../../core/TimeoutTracker.js';


const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const CONTENT_WIDTH = 760;
export const EDGE_PADDING = 18;

const FOLDER_MINI_SIZE = 16;
const PREVIEW_BYTES = 2048;
const PREVIEW_LINES = 14;
const SCROLLBAR_HIDE_MS = 900;
const SCROLLBAR_FADE_MS = 200;
const SCROLLBAR_HOVER_ZONE = 18;
const WHEEL_STEP_PX = 60;

export function vbox(style = '', params = {}) {
    const box = new St.BoxLayout({ style, ...params });
    setBoxVertical(box, true);
    return box;
}

export function hbox(style = '', params = {}) {
    const box = new St.BoxLayout({ style, ...params });
    setBoxVertical(box, false);
    return box;
}

export function label(text, styleClass, params = {}) {
    const actor = new St.Label({ text, style_class: styleClass, ...params });
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return actor;
}

export function sectionLabel(text) {
    return label(text.toUpperCase(), 'dhruva-start-section', { x_expand: true, y_align: Clutter.ActorAlign.CENTER });
}

export function button(styleClass, child, onClick, owner, params = {}) {
    const actor = new St.Button({ style_class: styleClass, child, can_focus: true, ...params });
    actor.connectObject('clicked', onClick, owner);
    return actor;
}

export function fitWidth(count, spacing) {
    return Math.floor((CONTENT_WIDTH - spacing * (count - 1)) / count);
}

export function iconButton(iconName, accessibleName, onClick, owner) {
    return button('dhruva-start-round', new St.Icon({ icon_name: iconName, icon_size: 16 }), onClick, owner, {
        accessible_name: accessibleName,
        x_expand: false,
        y_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

export function pillButton(text, iconName, onClick, owner, isIconAtEnd = false) {
    const content = hbox('spacing: 6px;');
    const icon = iconName ? new St.Icon({ icon_name: iconName, icon_size: 14, y_align: Clutter.ActorAlign.CENTER }) : null;
    if (icon && !isIconAtEnd) content.add_child(icon);
    content.add_child(new St.Label({ text, y_align: Clutter.ActorAlign.CENTER }));
    if (icon && isIconAtEnd) content.add_child(icon);
    return button('dhruva-start-pill', content, onClick, owner);
}

function isSecondary(event) {
    return event.get_button() === Clutter.BUTTON_SECONDARY;
}

export function onSecondaryClick(actor, callback, owner) {
    actor.connectObject(
        'button-press-event', (_actor, event) => {
            if (!isSecondary(event)) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            callback(x, y);
            return Clutter.EVENT_STOP;
        },
        'button-release-event', (_actor, event) => (isSecondary(event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE),
        owner
    );
}

function verticalScrollbar(view) {
    return view.get_children().find(child => child !== view.child && child.vertical === true && Boolean(child.adjustment)) || null;
}

export class AutoHideScrollbar {
    constructor(scrollView) {
        this._timers = new TimeoutTracker();
        this._hideId = 0;
        this._view = scrollView;
        this._bar = verticalScrollbar(scrollView);
        this._adjustment = scrollView.vadjustment ? scrollView.vadjustment : (this._bar ? this._bar.adjustment : null);
        if (!this._bar || !this._adjustment) return;

        this._bar.opacity = 0;
        this._adjustment.connectObject('notify::value', () => this._reveal(), this);
        scrollView.connectObject('motion-event', (_actor, event) => {
            const [x] = event.get_coords();
            const [viewX] = scrollView.get_transformed_position();
            if (x >= viewX + scrollView.width - SCROLLBAR_HOVER_ZONE) this._reveal();
            return Clutter.EVENT_PROPAGATE;
        }, this);
    }

    _reveal() {
        this._bar.remove_transition('opacity');
        this._bar.opacity = 255;
        if (this._hideId) this._timers.remove(this._hideId);
        this._hideId = this._timers.addTimeout(GLib.PRIORITY_DEFAULT, SCROLLBAR_HIDE_MS, () => {
            this._hideId = 0;
            if (isActorAlive(this._bar)) this._bar.ease({ opacity: 0, duration: SCROLLBAR_FADE_MS });
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._timers.destroy();
        if (this._adjustment) this._adjustment.disconnectObject(this);
        if (isActorAlive(this._view)) this._view.disconnectObject(this);
    }
}

export function edgeScrollView(child) {
    const view = new St.ScrollView({
        style_class: 'dhruva-start-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        style: '-st-vfade-offset: 24px;',
    });
    child.set_style(`${child.get_style() || ''} padding-right: ${EDGE_PADDING}px;`);
    view.set_child(child);
    return view;
}

export function horizontalScroller(child, owner) {
    const view = new St.ScrollView({
        x_expand: true,
        hscrollbar_policy: St.PolicyType.EXTERNAL,
        vscrollbar_policy: St.PolicyType.NEVER,
        style: '-st-hfade-offset: 24px;',
    });
    view.set_child(child);
    view.connectObject('scroll-event', (_actor, event) => {
        const adjustment = view.hadjustment ? view.hadjustment : view.hscroll.adjustment;
        const direction = event.get_scroll_direction();
        let delta = 0;
        if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) delta = -WHEEL_STEP_PX;
        else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) delta = WHEEL_STEP_PX;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * WHEEL_STEP_PX;
        }
        if (delta === 0) return Clutter.EVENT_PROPAGATE;
        adjustment.value = Math.max(adjustment.lower, Math.min(adjustment.upper - adjustment.page_size, adjustment.value + delta));
        return Clutter.EVENT_STOP;
    }, owner);
    return view;
}

export function rowContent(params = {}) {
    return hbox('spacing: 12px;', { x_expand: true, x_align: Clutter.ActorAlign.START, ...params });
}

export function sectionHeader(text, action = null) {
    const row = hbox('spacing: 8px; padding: 0 4px;');
    row.add_child(sectionLabel(text));
    if (action) row.add_child(action);
    return row;
}

export function appIcon(app, size) {
    return new St.Icon({ gicon: app.get_icon(), icon_size: size, x_align: Clutter.ActorAlign.CENTER });
}

export function folderIcon(apps, size) {
    const grid = new St.Widget({
        style_class: 'dhruva-start-folder',
        layout_manager: new Clutter.GridLayout({ row_spacing: 4, column_spacing: 4 }),
        width: size,
        height: size,
        x_align: Clutter.ActorAlign.CENTER,
    });
    apps.slice(0, 4).forEach((app, index) => {
        grid.layout_manager.attach(new St.Icon({ gicon: app.get_icon(), icon_size: FOLDER_MINI_SIZE }), index % 2, Math.floor(index / 2), 1, 1);
    });
    return grid;
}

function codePreview(text, height) {
    const preview = new St.Label({
        text,
        style_class: 'dhruva-start-code',
        style: `font-size: ${Math.max(4, Math.round(height / 13))}px;`,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
    });
    preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return preview;
}

function showCode(bin, text, height, radius) {
    bin.set_style(`border-radius: ${radius}px; padding: ${Math.round(height / 12)}px;`);
    bin.add_style_class_name('dhruva-start-thumb-code');
    bin.set_child(codePreview(text, height));
}

function isTextFile(entry) {
    return !entry.isDirectory && Gio.content_type_is_a(entry.contentType, 'text/plain');
}

function readPreview(entry, done) {
    const file = Gio.File.new_for_uri(entry.uri);
    file.read_async(GLib.PRIORITY_DEFAULT, null, (_file, readRes) => {
        let stream;
        try {
            stream = file.read_finish(readRes);
        } catch (_e) {
            return;
        }
        stream.read_bytes_async(PREVIEW_BYTES, GLib.PRIORITY_DEFAULT, null, (_stream, bytesRes) => {
            let bytes = null;
            try {
                bytes = stream.read_bytes_finish(bytesRes);
            } catch (_e) {
                bytes = null;
            }
            stream.close_async(GLib.PRIORITY_LOW, null, () => { });
            if (!bytes) return;

            entry.previewText = new TextDecoder().decode(bytes.toArray())
                .replace(/\t/g, '  ').split('\n').slice(0, PREVIEW_LINES).join('\n');
            done();
        });
    });
}

export function preloadPreviews(entries) {
    entries.filter(entry => !entry.previewText && isTextFile(entry)).forEach(entry => readPreview(entry, () => { }));
}

function imageActor(file, width, height) {
    const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    return St.TextureCache.get_default().load_file_async(file, width, height, scaleFactor, 1.0);
}

export function thumbnail(entry, width, height, radius) {
    const bin = new St.Bin({
        width,
        height,
        style_class: 'dhruva-start-thumb',
        style: `border-radius: ${radius}px;`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    if (entry.thumbnail) {
        bin.set_child(imageActor(Gio.File.new_for_path(entry.thumbnail), width, height));
    } else if (entry.contentType.startsWith('image/')) {
        bin.set_child(imageActor(Gio.File.new_for_uri(entry.uri), width, height));
    } else if (entry.previewText) {
        showCode(bin, entry.previewText, height, radius);
    } else {
        bin.set_child(new St.Icon({ gicon: entry.gicon, icon_size: Math.round(Math.min(width, height) * 0.5) }));
        if (isTextFile(entry)) {
            readPreview(entry, () => {
                if (isActorAlive(bin)) showCode(bin, entry.previewText, height, radius);
            });
        }
    }
    return bin;
}

export function relativeTime(unixSeconds) {
    const elapsed = Math.max(0, Math.floor(GLib.get_real_time() / 1000000) - unixSeconds);
    if (elapsed < MINUTE) return _('Just now');
    if (elapsed < HOUR) {
        const minutes = Math.floor(elapsed / MINUTE);
        return ngettext('%d min ago', '%d min ago', minutes).format(minutes);
    }
    if (elapsed < DAY) {
        const hours = Math.floor(elapsed / HOUR);
        return ngettext('%d hour ago', '%d hours ago', hours).format(hours);
    }
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? _('Yesterday') : ngettext('%d day ago', '%d days ago', days).format(days);
}

export function prettyLocation(path) {
    const home = GLib.get_home_dir();
    return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}