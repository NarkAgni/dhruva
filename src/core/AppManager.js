/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
* * This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
* * This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
* * You should have received a copy of the GNU General Public License
* along with this program. If not, see https://www.gnu.org/licenses/. 
*/


import Shell from 'gi://Shell';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';


export default class AppManager {
    constructor(uuid) {
        this.appSystem = Shell.AppSystem.get_default();
        this.favManager = AppFavorites.getAppFavorites();
    }

    hasApp(app) {
        if (!app) return false;
        return this.favManager.isFavorite(app.get_id());
    }

    addApp(app) {
        if (!app) return false;
        let id = app.get_id();
        
        if (!this.hasApp(app)) {
            this.favManager.addFavorite(id);
        }
        return true;
    }

    removeApp(app) {
        if (!app) return false;
        let id = app.get_id();
        
        if (this.hasApp(app)) {
            this.favManager.removeFavorite(id);
            return true;
        }
        return false;
    }

    getDisplayApps() {
        const favorites = this.favManager.getFavorites();
        const runningApps = this.appSystem.get_running();
        const favIds = new Set(favorites.map(a => a.get_id()));

        let displayApps = [...favorites];

        runningApps.forEach(app => {
            if (!favIds.has(app.get_id())) {
                const activeWins = app.get_windows().filter(w => !w.is_skip_taskbar());
                if (activeWins.length > 0) {
                    displayApps.push(app);
                }
            }
        });

        return displayApps;
    }

    destroy() {
        this.appSystem = null;
        this.favManager = null;
    }
}