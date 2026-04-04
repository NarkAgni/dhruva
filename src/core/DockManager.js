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


import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export default class DockManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this._originalDash = Main.overview.dash;
        this._externalActors = new Set();
        
        this._takeoverGnomeDash();
    }

    _takeoverGnomeDash() {
        if (!this._originalDash) return;

        this._originalDash.hide();
        this._originalDash.set_height(1);
        this._originalDash.opacity = 0;

        let dhruvaDash = this.dockUI.actor; 
        let realDhruvaBox = this.dockUI.boxActor; 

        let dummyBox = new St.BoxLayout();
        
        dhruvaDash._box = dummyBox; 
        dhruvaDash._container = dhruvaDash;
        
        if (this._originalDash.showAppsButton) {
            dhruvaDash.showAppsButton = this._originalDash.showAppsButton;
        } else {
            dhruvaDash.showAppsButton = { checked: false };
        }

        dhruvaDash.iconSize = this.settings.get_int('icon-size') || 48;
        dhruvaDash._maxWidth = -1;
        dhruvaDash._maxHeight = -1;
        dhruvaDash.setMaxSize = () => {}; 
        dhruvaDash._adjustIconSize = () => {}; 
        dhruvaDash._queueRedisplay = () => {}; 
        if (typeof dhruvaDash.queue_relayout !== 'function') {
            dhruvaDash.queue_relayout = () => {};
        }

        Object.defineProperty(Main.overview, 'dash', {
            get: () => dhruvaDash,
            configurable: true
        });

        if (Main.overview._overview?._controls) {
            Main.overview._overview._controls.dash = dhruvaDash;
        }

        const stealExternalWidget = (child) => {
            if (!child) return false;
            const sc = typeof child.get_style_class_name === 'function' ? child.get_style_class_name() : (child.style_class || '');
            
            const isGnomeOrDhruva = sc.includes('app-well-app') || 
                                    sc.includes('show-apps') || 
                                    sc.includes('dash-item-container') || 
                                    sc.includes('dash-separator') || 
                                    sc.includes('placeholder') || 
                                    sc.includes('empty-dash-drop-target') ||
                                    sc.includes('dock-app-button') || 
                                    sc.includes('clock-module') || 
                                    child._isModule;
                                    
            if (!isGnomeOrDhruva) {
                if (child.get_parent()) {
                    try { child.get_parent().remove_child(child); } catch(e){}
                }
                child._isExternal = true;
                child._dhruvaExternalOwner = this;
                this._externalActors.add(child);
                try {
                    if (typeof child.remove_all_transitions === 'function')
                        child.remove_all_transitions();
                    child.opacity = 255;
                } catch (e) {}

                if (this.dockUI && this.dockUI.autoHideManager && this.dockUI.autoHideManager.isHidden) {
                    this.dockUI.autoHideManager._forceShow();
                }

                try { realDhruvaBox.add_child(child); } catch(e){}
                
                if (this.dockUI && typeof this.dockUI.onMusicPillInjected === 'function') {
                    this.dockUI.onMusicPillInjected(child);
                }

                if (this.dockUI && typeof this.dockUI.queueRender === 'function') {
                    this.dockUI.queueRender();
                }

                return true;
            }
            return false;
        };

        const origDummyAdd = dummyBox.add_child.bind(dummyBox);
        const origDummyInsert = dummyBox.insert_child_at_index.bind(dummyBox);
        
        dummyBox.add_child = (child) => {
            if (!stealExternalWidget(child)) origDummyAdd(child);
        };
        dummyBox.insert_child_at_index = (child, index) => {
            if (!stealExternalWidget(child)) origDummyInsert(child, index);
        };

        if (this._originalDash._box) {
            const origBox = this._originalDash._box;
            
            origBox.get_children().forEach(child => {
                stealExternalWidget(child);
            });

            if (!origBox._isHijacked) {
                const _nativeOrigAdd = origBox.add_child.bind(origBox);
                const _nativeOrigInsert = origBox.insert_child_at_index.bind(origBox);

                origBox.add_child = (child) => {
                    if (!stealExternalWidget(child)) _nativeOrigAdd(child);
                };
                origBox.insert_child_at_index = (child, index) => {
                    if (!stealExternalWidget(child)) _nativeOrigInsert(child, index);
                };
                origBox._isHijacked = true;
                this._hijackedOrigBox = origBox;
                this._nativeOrigAdd = _nativeOrigAdd;
                this._nativeOrigInsert = _nativeOrigInsert;
            }
        }
    }

    updatePosition() {
        if (!this.dockUI || this.dockUI._isDestroyed || !this.dockUI.actor || !this.dockUI.boxActor) return;
        if (!this.dockUI.actor.is_mapped()) return;

        try {
            this.dockUI.actor.remove_all_transitions();
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;

            const monitorResult = this.dockUI.monitorManager.getCurrentMonitor();
            if (!monitorResult || !monitorResult.monitor) return;
            
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorResult.index);
            const margin = this.settings.get_int('dock-margin');
            const pos = this.settings.get_string('dock-position');
            const isFullWidth = this.settings.get_boolean('full-width');

            let xPos = 0, yPos = 0;
            const aw = this.dockUI.actor.width;
            const ah = this.dockUI.actor.height;

            if (pos === 'TOP') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y + margin + 2;
            } else if (pos === 'BOTTOM') {
                xPos = isFullWidth ? workArea.x : workArea.x + (workArea.width - aw) / 2;
                yPos = workArea.y + workArea.height - ah - margin;
            } else if (pos === 'LEFT') {
                xPos = workArea.x + margin;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            } else if (pos === 'RIGHT') {
                xPos = workArea.x + workArea.width - aw - margin;
                yPos = isFullWidth ? workArea.y : workArea.y + (workArea.height - ah) / 2;
            }

            this.dockUI.actor.set_position(xPos, yPos);

            if (this.dockUI.autoHideManager) {
                this.dockUI.autoHideManager.isVisible = true;
                this.dockUI.autoHideManager.isAnimating = false;
            }
        } catch (e) {}
    }

    destroy() {
        const originalBox = this._originalDash?._box;

        if (this._hijackedOrigBox && this._nativeOrigAdd && this._nativeOrigInsert) {
            try {
                this._hijackedOrigBox.add_child = this._nativeOrigAdd;
                this._hijackedOrigBox.insert_child_at_index = this._nativeOrigInsert;
                this._hijackedOrigBox._isHijacked = false;
            } catch (_e) { }
        }

        if (originalBox && this._externalActors && this._externalActors.size > 0) {
            this._externalActors.forEach(child => {
                if (!child || child._dhruvaExternalOwner !== this) return;
                if (typeof child.is_destroyed === 'function' && child.is_destroyed()) return;

                try {
                    if (child.get_parent()) child.get_parent().remove_child(child);
                } catch (_e) { }

                child._isExternal = true;
                child._dhruvaExternalOwner = null;

                try {
                    if (this._nativeOrigAdd && originalBox === this._hijackedOrigBox) {
                        this._nativeOrigAdd(child);
                    } else {
                        originalBox.add_child(child);
                    }
                } catch (_e) { }
            });
            this._externalActors.clear();
        }

        if (this._originalDash) {
            Object.defineProperty(Main.overview, 'dash', {
                value: this._originalDash,
                configurable: true,
                writable: true
            });
            this._originalDash.show();
            this._originalDash.set_height(-1);
            this._originalDash.opacity = 255;
        }

        this._hijackedOrigBox = null;
        this._nativeOrigAdd = null;
        this._nativeOrigInsert = null;
        this.dockUI = null;
        this.settings = null;
    }
}
