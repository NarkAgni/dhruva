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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../../core/Utils.js';
import { Settings } from '../../core/SettingsManager.js';


export function applyOverviewDockMargin(dockUI) {
    if (!isActorAlive(dockUI.actor) || !isActorAlive(dockUI.boxActor)) return;

    if (Settings.independentDock && !Settings.hybridPanelMode) return;

    const currentMon = dockUI.monitorManager.getCurrentMonitor();
    if (!currentMon || currentMon.index !== Main.layoutManager.primaryIndex) return;

    const pos = dockUI.dockPosition;
    if (pos !== 'BOTTOM') return;

    let dockH = dockUI.actor._cachedH || dockUI.actor.height || 0;
    if (dockUI.actor.is_mapped()) {
        const [, th] = dockUI.actor.get_transformed_size();
        dockH = Math.max(dockH, Math.round(th || 0));
    }
    if (dockH <= 1 && dockUI.boxActor) {
        const [, prefH] = dockUI.boxActor.get_preferred_height(-1);
        dockH = Math.max(dockH, Math.round(prefH || 0));
    }

    const margin = Settings.dockMargin || 0;
    const finalDockHeight = Math.round(dockH + margin);

    if (Main.overview.dash && isActorAlive(Main.overview.dash)) {
        Main.overview.dash.set_height(finalDockHeight);
        Main.overview.dash.set_width(-1);
    }
}

export function clearOverviewDockMargin() {
    if (Main.overview.dash && isActorAlive(Main.overview.dash)) {
        Main.overview.dash.set_height(-1);
        Main.overview.dash.set_width(-1);
    }
}