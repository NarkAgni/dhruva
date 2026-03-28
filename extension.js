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


import DockUI from './src/ui/DockUI.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';


export default class DhruvaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._dockUI = new DockUI(
            this._settings, 
            () => this.openPreferences(), 
            this.uuid
        );
        this._dockUI.show();
    }

    disable() {
        if (this._dockUI) {
            this._dockUI.destroy();
            this._dockUI = null;
        }
        this._settings = null;
    }
}