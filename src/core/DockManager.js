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


import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class DockManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this._originalDash = Main.overview.dash;
        this._externalActors = new Set();

        this._applyDashState();

        this._settingSignalId = this.settings.connect('changed::independent-dock', () => {
            this._applyDashState();
        });
    }

    _applyDashState() {
        if (this.settings.get_boolean('independent-dock')) {
            this._restoreGnomeDash();
        } else {
            this._takeoverGnomeDash();
        }
    }

    _takeoverGnomeDash() {
        if (!this._originalDash) return;
        if (this._hijackedOrigBox) return;

        this._originalDash.opacity = 0;
        this._originalDash.scale_x = 0;
        this._originalDash.scale_y = 0;
        this._originalDash.reactive = false;

        if (typeof this._originalDash.set_height === 'function') {
            this._originalDash.set_height(0);
        }
        this._originalDash.hide();

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
                    try {
                        child.get_parent().remove_child(child);
                    } catch (e) {}
                }
                child._isExternal = true;
                child._dhruvaExternalOwner = this;
                this._externalActors.add(child);

                if (this.dockUI && this.dockUI._safeHouse) {
                    try {
                        this.dockUI._safeHouse.add_child(child);
                    } catch (e) {}
                }

                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    if (child && !(typeof child.is_destroyed === 'function' && child.is_destroyed())) {
                        try {
                            if (typeof child.remove_all_transitions === 'function') child.remove_all_transitions();
                            child.opacity = 255;
                        } catch (e) {}
                    }

                    if (this.dockUI && !this.dockUI._isDestroyed && typeof this.dockUI.queueRender === 'function') {
                        this.dockUI.queueRender();
                    }
                    return GLib.SOURCE_REMOVE;
                });

                return true;
            }
            return false;
        };

        const releaseExternalWidget = (child) => {
            if (child && child._isExternal) {
                this._externalActors.delete(child);
                child._isExternal = false;
                child._dhruvaExternalOwner = null;

                if (this.dockUI && typeof this.dockUI.queueRender === 'function') {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (this.dockUI && !this.dockUI._isDestroyed) this.dockUI.queueRender();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        };

        if (this._originalDash._box) {
            const origBox = this._originalDash._box;

            origBox.get_children().forEach(child => {
                stealExternalWidget(child);
            });

            if (!origBox._isHijacked) {
                const _nativeOrigAdd = origBox.add_child.bind(origBox);
                const _nativeOrigInsert = origBox.insert_child_at_index.bind(origBox);
                const _nativeOrigRemove = origBox.remove_child.bind(origBox);
                const _nativeOrigAddActor = typeof origBox.add_actor === 'function' ? origBox.add_actor.bind(origBox) : null;

                origBox.add_child = (child) => {
                    if (!stealExternalWidget(child)) _nativeOrigAdd(child);
                };
                origBox.insert_child_at_index = (child, index) => {
                    if (!stealExternalWidget(child)) _nativeOrigInsert(child, index);
                };
                origBox.remove_child = (child) => {
                    _nativeOrigRemove(child);
                    releaseExternalWidget(child);
                };

                if (_nativeOrigAddActor) {
                    origBox.add_actor = (child) => {
                        if (!stealExternalWidget(child)) _nativeOrigAddActor(child);
                    };
                    this._nativeOrigAddActor = _nativeOrigAddActor;
                }

                origBox._isHijacked = true;
                this._hijackedOrigBox = origBox;
                this._nativeOrigAdd = _nativeOrigAdd;
                this._nativeOrigInsert = _nativeOrigInsert;
                this._nativeOrigRemove = _nativeOrigRemove;
            }
        }
    }

    _restoreGnomeDash() {
        const originalBox = this._originalDash?._box;

        if (this._hijackedOrigBox && this._nativeOrigAdd && this._nativeOrigInsert && this._nativeOrigRemove) {
            try {
                this._hijackedOrigBox.add_child = this._nativeOrigAdd;
                this._hijackedOrigBox.insert_child_at_index = this._nativeOrigInsert;
                this._hijackedOrigBox.remove_child = this._nativeOrigRemove;
                if (this._nativeOrigAddActor) {
                    this._hijackedOrigBox.add_actor = this._nativeOrigAddActor;
                }
                this._hijackedOrigBox._isHijacked = false;
            } catch (_e) {}
        }

        if (originalBox && this._externalActors && this._externalActors.size > 0) {
            this._externalActors.forEach(child => {
                if (!child || child._dhruvaExternalOwner !== this) return;
                if (typeof child.is_destroyed === 'function' && child.is_destroyed()) return;

                try {
                    if (child.get_parent()) child.get_parent().remove_child(child);
                } catch (_e) {}

                child._isExternal = false;
                child._dhruvaExternalOwner = null;

                try {
                    if (this._nativeOrigAdd && originalBox === this._hijackedOrigBox) {
                        this._nativeOrigAdd(child);
                    } else {
                        originalBox.add_child(child);
                    }
                } catch (_e) {}
            });
            this._externalActors.clear();
        }

        if (this._originalDash) {
            this._originalDash.opacity = 255;
            this._originalDash.scale_x = 1;
            this._originalDash.scale_y = 1;
            this._originalDash.reactive = true;
            if (typeof this._originalDash.set_height === 'function') {
                this._originalDash.set_height(-1);
            }
            this._originalDash.show();
        }

        this._hijackedOrigBox = null;
        this._nativeOrigAdd = null;
        this._nativeOrigInsert = null;
        this._nativeOrigAddActor = null;
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

            const actualMonitor = monitorResult.monitor;
            let topOffset = 0;
            if (monitorResult.index === Main.layoutManager.primaryIndex && Main.panel && Main.panel.visible) {
                topOffset = Main.panel.height || 27;
            }

            const workArea = {
                x: actualMonitor.x,
                y: actualMonitor.y + topOffset,
                width: actualMonitor.width,
                height: actualMonitor.height - topOffset
            };
            const margin = this.settings.get_int('dock-margin');
            const pos = this.settings.get_string('dock-position');
            const isFullWidth = this.settings.get_boolean('full-width');

            let xPos = 0,
                yPos = 0;
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
        if (this._settingSignalId) {
            this.settings.disconnect(this._settingSignalId);
            this._settingSignalId = null;
        }

        this._restoreGnomeDash();
        
        this.dockUI = null;
        this.settings = null;
    }
}