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


import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { isActorAlive } from '../../core/Utils.js';


export function refreshTrashState(dockUI) {
    const cancellable = (dockUI && dockUI._cancellable) ? dockUI._cancellable : null;
    const trash = Gio.File.new_for_uri('trash:///');
    trash.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable, (file, res) => {
        let enumerator;
        try {
            enumerator = file.enumerate_children_finish(res);
        } catch (_e) {
            return;
        }
        enumerator.next_files_async(1, GLib.PRIORITY_LOW, cancellable, (e, filesRes) => {
            let isFull = false;
            try {
                isFull = e.next_files_finish(filesRes).length > 0;
            } catch (_err) {
                isFull = false;
            }
            enumerator.close_async(GLib.PRIORITY_LOW, cancellable, () => {});

            if (isFull === dockUI.trashIsFull) return;
            dockUI.trashIsFull = isFull;
            if (isActorAlive(dockUI.actor)) dockUI.queueRender('incremental', true);
        });
    });
}

export function buildTrashModule(dockUI, createBtn, toggleAppWindow) {
    const iconName = dockUI.trashIsFull ? 'user-trash-full' : 'user-trash';
    const btn = createBtn(iconName, _('Recycle Bin'), (button) => toggleAppWindow('trash:///', null, _('Recycle Bin'), button), null);
    btn._isTrash = true;

    if (dockUI.trashIsFull === undefined) {
        dockUI.trashIsFull = false;
        refreshTrashState(dockUI);
    }
    return btn;
}