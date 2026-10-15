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
import Clutter from 'gi://Clutter';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { addSeparator } from './ContextMenuItems.js';
import { setBoxVertical, isActorAlive } from '../../core/Utils.js';


const TRASH_BATCH_SIZE = 10;

function emptyTrashAsync() {
    const trashRoot = Gio.File.new_for_uri('trash:///');
    trashRoot.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (file, res) => {
        try {
            const enumerator = file.enumerate_children_finish(res);
            const deleteNext = () => {
                enumerator.next_files_async(TRASH_BATCH_SIZE, GLib.PRIORITY_DEFAULT, null, (e, filesRes) => {
                    try {
                        const files = e.next_files_finish(filesRes);
                        if (!files || files.length === 0) {
                            enumerator.close(null);
                            return;
                        }
                        files.forEach(info => {
                            const child = trashRoot.get_child(info.get_name());
                            child.delete_async(GLib.PRIORITY_DEFAULT, null, () => { });
                        });
                        deleteNext();
                    } catch (_err) {
                        enumerator.close(null);
                    }
                });
            };
            deleteNext();
        } catch (err) {
            console.error('[Dhruva] Failed to enumerate trash:', err);
        }
    });
}

function confirmEmptyTrash() {
    const dialog = new ModalDialog.ModalDialog({ styleClass: 'dhruva-modal-dialog', destroyOnClose: true });
    const content = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 12px; padding: 24px 20px 12px 20px; text-align: center;'
    });
    setBoxVertical(content, true);

    content.add_child(new St.Label({
        text: _('Empty Trash?'),
        style: 'font-weight: 800; font-size: 22px; color: #ffffff; text-align: center;'
    }));

    const descLabel = new St.Label({
        text: _('Are you sure you want to permanently delete all items from the Trash?\nThis action cannot be undone.'),
        style: 'font-size: 15px; color: rgba(255, 255, 255, 0.75); text-align: center; margin-top: 4px;'
    });
    descLabel.clutter_text.line_wrap = true;
    descLabel.clutter_text.justify = true;
    content.add_child(descLabel);

    dialog.contentLayout.add_child(content);
    dialog.addButton({ label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape });
    dialog.addButton({ label: _('Empty Trash'), action: () => { dialog.close(); emptyTrashAsync(); }, isDefault: true });
    dialog.open();
}

export function attachTrashActions(contextMenu) {
    const emptyBtn = new St.Button({
        reactive: false,
        x_expand: true,
        style_class: 'context-menu-action-btn'
    });
    const label = new St.Label({
        text: _('Checking Trash...'),
        style_class: 'context-menu-action-label',
        style: 'color: rgba(255,255,255,0.4);'
    });
    emptyBtn.set_child(label);
    contextMenu.panel.add_child(emptyBtn);
    addSeparator(contextMenu.panel);

    const cancellable = new Gio.Cancellable();
    emptyBtn.connectObject('destroy', () => cancellable.cancel(), emptyBtn);

    const showState = hasItems => {
        if (!isActorAlive(emptyBtn)) return;

        if (hasItems) {
            emptyBtn.reactive = true;
            emptyBtn.style_class = 'context-menu-action-btn-destructive';
            label.set_text(_('Empty Trash'));
            label.style_class = 'context-menu-action-label-destructive';
            label.set_style('');
            emptyBtn.connectObject('clicked', () => {
                contextMenu.hide();
                confirmEmptyTrash();
            }, emptyBtn);
        } else {
            emptyBtn.reactive = false;
            emptyBtn.set_opacity(100);
            label.set_text(_('Trash is Empty'));
            label.set_style('color: rgba(255,255,255,0.25);');
        }
    };

    const trashFile = Gio.File.new_for_uri('trash:///');

    const checkFirstChild = () => {
        trashFile.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (file, res) => {
            let enumerator;
            try {
                enumerator = file.enumerate_children_finish(res);
            } catch (_e) {
                showState(false);
                return;
            }
            enumerator.next_files_async(1, GLib.PRIORITY_DEFAULT, cancellable, (e, filesRes) => {
                let hasItems = false;
                try {
                    hasItems = e.next_files_finish(filesRes).length > 0;
                } catch (_err) {
                    hasItems = false;
                }
                enumerator.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
                showState(hasItems);
            });
        });
    };

    trashFile.query_info_async('trash::item-count', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (file, res) => {
        let info;
        try {
            info = file.query_info_finish(res);
        } catch (_e) {
            if (!cancellable.is_cancelled()) checkFirstChild();
            return;
        }
        if (info.has_attribute('trash::item-count')) showState(info.get_attribute_uint32('trash::item-count') > 0);
        else checkFirstChild();
    });
}