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


import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutTracker } from './TimeoutTracker.js';
import { isActorAlive, markActorDisposed } from '../ui/dock/DockLayoutEngine.js';


export default class DockManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
        this._originalDash = Main.overview.dash;
        this._externalActors = new Set();
        this.timers = new TimeoutTracker();

        this._applyDashState();

        this.settings.connectObject('changed::independent-dock', () => {
            this._applyDashState();
        }, this);
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

        if (!this._origAdjustIconSize && this._originalDash._adjustIconSize) {
            this._origAdjustIconSize = this._originalDash._adjustIconSize.bind(this._originalDash);
            this._originalDash._adjustIconSize = () => {
                const box = this._originalDash._box;
                if (!box) return;
                const children = box.get_children ? box.get_children() : [];
                const firstIcon = children.find(c => c && c.icon && c.icon.ensure_style);
                if (!firstIcon) return;
                try {
                    this._origAdjustIconSize();
                } catch (_e) {
                    // Safe swallow
                }
            };
        }

        this._originalDash.opacity = 0;
        this._originalDash.reactive = false;

        if (this._originalDash.show) {
            this._originalDash.show();
        }

        const stealExternalWidget = (child) => {
            if (!child) return false;
            const sc = child.get_style_class_name ? child.get_style_class_name() : (child.style_class || '');

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
                if (!isActorAlive(child)) return false;
                if (this._externalActors.has(child)) return true;

                const parent = child.get_parent();
                if (parent) {
                    parent.remove_child(child);
                }

                child._isExternal = true;
                child._dhruvaExternalOwner = this;
                child._is3rdParty = true;
                this._externalActors.add(child);

                // The owning extension may dispose this actor at any time
                // (e.g. Dynamic Music Pill recreates its pill when the MPRIS
                // source changes). Drop our reference the moment Clutter
                // starts tearing it down so no later render pass touches a
                // disposed GObject (issue #54).
                child.connectObject('destroy', () => {
                    markActorDisposed(child);
                    this._externalActors.delete(child);
                    if (this.dockUI && this.dockUI.queueRender) {
                        this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            if (this.dockUI) this.dockUI.queueRender();
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }, this);

                child._isStatic = true;
                if (child.ease) {
                    child.ease = function (props) {
                        const newProps = Object.assign({}, props);
                        delete newProps.scale_x;
                        delete newProps.scale_y;
                        Clutter.Actor.prototype.ease.call(this, newProps);
                    };
                }
                if (child.set_scale) {
                    const origScale = child.set_scale.bind(child);
                    child.set_scale = (sx, sy) => {
                        if (sx === 1 && sy === 1) origScale(sx, sy);
                    };
                }

                if (this.dockUI && this.dockUI.boxActor) {
                    this.dockUI.boxActor.add_child(child);
                }

                this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 300, () => {
                    if (child && this.dockUI && isActorAlive(child)) {
                        if (child.remove_all_transitions) child.remove_all_transitions();
                        if (child.visible) child.opacity = 255;
                        child.scale_x = 1;
                        child.scale_y = 1;
                    }

                    if (this.dockUI && this.dockUI.queueRender) {
                        this.dockUI.queueRender();
                    }
                    return GLib.SOURCE_REMOVE;
                });

                if (!this._3rdPartyCheckerRunning) {
                    this._3rdPartyCheckerRunning = true;

                    const globalChecker = () => {
                        if (!this._externalActors || !this.dockUI) {
                            this._3rdPartyCheckerRunning = false;
                            return GLib.SOURCE_REMOVE;
                        }

                        // Snapshot first: we may delete from the Set while iterating.
                        Array.from(this._externalActors).forEach(ext => {
                            if (!isActorAlive(ext)) {
                                this._externalActors.delete(ext);
                                return;
                            }
                            if (!ext._is3rdParty) return;

                            try {
                                let fullText = '';

                                const collectText = (actor) => {
                                    if (!isActorAlive(actor) || !actor.get_children) return;
                                    actor.get_children().forEach(sub => {
                                        const t = (sub.get_text ? sub.get_text() : sub.text) || '';
                                        if (typeof t === 'string' && t.trim().length > 0) {
                                            fullText += ' ' + t.toLowerCase();
                                        }
                                        collectText(sub);
                                    });
                                };
                                collectText(ext);

                                const isMediaDead = fullText.includes('no media') ||
                                    fullText.includes('waiting for playback') ||
                                    fullText.trim() === '';

                                const isVert = this.dockUI && (this.dockUI.dockPosition === 'LEFT' || this.dockUI.dockPosition === 'RIGHT');

                                if (isVert || isMediaDead) {
                                    if (ext.visible) ext.hide();
                                } else {
                                    if (!ext.visible) ext.show();
                                }
                            } catch (_e) {
                                // Actor was disposed mid-walk; drop it and move on.
                                markActorDisposed(ext);
                                this._externalActors.delete(ext);
                            }
                        });

                        return GLib.SOURCE_CONTINUE;
                    };

                    this.timers.addTimeout(GLib.PRIORITY_DEFAULT, 300, globalChecker);
                }

                return true;
            }
            return false;
        };

        const releaseExternalWidget = (child) => {
            if (!child) return;
            const wasTracked = this._externalActors.delete(child);
            if (!wasTracked && !child._isExternal) return;

            if (isActorAlive(child)) {
                child.disconnectObject(this);
                child._isExternal = false;
                child._dhruvaExternalOwner = null;
                child._is3rdParty = false;
            }

            if (this.dockUI && this.dockUI.queueRender) {
                this.timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (this.dockUI) this.dockUI.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
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
                const _nativeOrigAddActor = origBox.add_actor ? origBox.add_actor.bind(origBox) : null;

                origBox.add_child = (child) => {
                    if (!stealExternalWidget(child)) _nativeOrigAdd(child);
                };
                origBox.insert_child_at_index = (child, index) => {
                    if (!stealExternalWidget(child)) _nativeOrigInsert(child, index);
                };
                origBox.remove_child = (child) => {
                    // A stolen actor is re-parented into Dhruva's dock box, but
                    // its owner still believes it lives in the GNOME dash and
                    // calls origBox.remove_child(actor) on teardown. Forwarding
                    // that to the native remove on origBox hits
                    // "clutter_actor_remove_child: assertion 'child->priv->parent
                    // != NULL' failed" and then a NULL deref (SIGSEGV, #54).
                    // Detach from the actor's *actual* parent instead.
                    if (!isActorAlive(child)) {
                        releaseExternalWidget(child);
                        return;
                    }

                    const realParent = child.get_parent();
                    if (realParent === origBox) {
                        _nativeOrigRemove(child);
                    } else if (realParent) {
                        realParent.remove_child(child);
                    }
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
        if (this._originalDash && this._origAdjustIconSize) {
            this._originalDash._adjustIconSize = this._origAdjustIconSize;
            this._origAdjustIconSize = null;
        }

        const originalBox = this._originalDash._box;

        if (this._hijackedOrigBox && this._nativeOrigAdd && this._nativeOrigInsert && this._nativeOrigRemove) {
            this._hijackedOrigBox.add_child = this._nativeOrigAdd;
            this._hijackedOrigBox.insert_child_at_index = this._nativeOrigInsert;
            this._hijackedOrigBox.remove_child = this._nativeOrigRemove;
            if (this._nativeOrigAddActor) {
                this._hijackedOrigBox.add_actor = this._nativeOrigAddActor;
            }
            this._hijackedOrigBox._isHijacked = false;
        }

        if (originalBox && this._externalActors && this._externalActors.size > 0) {
            Array.from(this._externalActors).forEach(child => {
                if (!isActorAlive(child)) return;
                if (child._dhruvaExternalOwner !== this) return;

                child.disconnectObject(this);

                const parent = child.get_parent();
                if (parent) {
                    parent.remove_child(child);
                }

                child._isExternal = false;
                child._dhruvaExternalOwner = null;
                child._is3rdParty = false;

                if (this._nativeOrigAdd && originalBox === this._hijackedOrigBox) {
                    this._nativeOrigAdd(child);
                } else {
                    originalBox.add_child(child);
                }
            });
            this._externalActors.clear();
        }

        if (this._originalDash) {
            this._originalDash.opacity = 255;
            this._originalDash.reactive = true;
            this._originalDash.set_height(-1);
            this._originalDash.set_width(-1);
            if (this._originalDash.show) {
                this._originalDash.show();
            }
        }

        this._hijackedOrigBox = null;
        this._nativeOrigAdd = null;
        this._nativeOrigInsert = null;
        this._nativeOrigAddActor = null;
    }

    updatePosition() {
        if (!this.dockUI || !this.dockUI.actor || !this.dockUI.boxActor || !this.dockUI.actor.visible) return;
        if (!this.dockUI.actor.is_mapped()) return;

        const isAutohideActive = this.dockUI.autoHideManager && (this.dockUI.autoHideManager.isAnimating || this.dockUI.autoHideManager.isHidden);
        if (!isAutohideActive) {
            this.dockUI.actor.remove_all_transitions();
            this.dockUI.actor.translation_x = 0;
            this.dockUI.actor.translation_y = 0;
        }

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
    }

    destroy() {
        if (this._folderSpyId) {
            if (Main.layoutManager && Main.layoutManager.overviewGroup) {
                Main.layoutManager.overviewGroup.disconnect(this._folderSpyId);
            }
            this._folderSpyId = null;
        }

        this.timers.destroy();

        if (this.settings) {
            this.settings.disconnectObject(this);
        }

        this._restoreGnomeDash();

        this.dockUI = null;
        this.settings = null;
    }
}
