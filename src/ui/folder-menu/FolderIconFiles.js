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

import { userDataDir } from '../../core/DataPaths.js';


let activePicker = null;

export function iconConfigDir(_dockUI) {
    const dir = userDataDir('icon');
    GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

export function deleteCustomFolderIcon(dockUI, icon, cancellable = null) {
    if (!icon || !icon.startsWith(`${iconConfigDir(dockUI)}/`)) return;

    Gio.File.new_for_path(icon).delete_async(GLib.PRIORITY_DEFAULT, cancellable, () => {});
}

export function pickIconImage(title, onPicked) {
    cancelIconPicker();

    const cancellable = new Gio.Cancellable();
    const proc = Gio.Subprocess.new([
        'zenity', '--file-selection', `--title=${title}`,
        '--file-filter=Images | *.png *.svg *.ico *.jpg *.jpeg'
    ], Gio.SubprocessFlags.STDOUT_PIPE);
    activePicker = { proc, cancellable };

    proc.communicate_utf8_async(null, cancellable, (p, res) => {
        if (activePicker && activePicker.proc === p) activePicker = null;

        let stdout;
        try {
            [, stdout] = p.communicate_utf8_finish(res);
        } catch (e) {
            if (!cancellable.is_cancelled()) console.error('[Dhruva] Folder icon picker failed:', e);
            return;
        }

        const path = stdout.trim();
        if (path) onPicked(path);
    });
}

export function cancelIconPicker() {
    if (activePicker) {
        activePicker.cancellable.cancel();
        activePicker.proc.force_exit();
        activePicker = null;
    }
}