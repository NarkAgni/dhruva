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


export function buildTrashModule(_iconSize, createBtn, toggleAppWindow) {
    let trashIconName = 'user-trash';
    const trashFile = Gio.File.new_for_uri('trash:///');
    
    if (trashFile.query_exists(null)) {
        const enumerator = trashFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        if (enumerator && enumerator.next_file(null)) {
            trashIconName = 'user-trash-full';
        }
        if (enumerator) {
            enumerator.close(null);
        }
    }

    return createBtn(trashIconName, 'Recycle Bin', (btn) => toggleAppWindow('trash:///', ['Trash'], btn), ['Trash']);
}