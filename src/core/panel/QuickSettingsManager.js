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
import Pango from 'gi://Pango';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../Utils.js';
import { TimeoutTracker } from '../TimeoutTracker.js';
import { HYBRID_PANEL_CONFIG } from '../PanelConfig.js';
import { hookPopupGap, unhookPopupGap } from './PopupGap.js';
import { NativeActorState, stylePanelItem } from './NativeActorState.js';


const CFG = HYBRID_PANEL_CONFIG;
const MIN_ICON_BOX = 10;
const RELAYOUT_DELAY_MS = 30;

const CHILD_ADDED_SIGNAL = GObject.signal_lookup('child-added', Clutter.Actor.$gtype) ? 'child-added' : 'actor-added';
const CHILD_REMOVED_SIGNAL = GObject.signal_lookup('child-removed', Clutter.Actor.$gtype) ? 'child-removed' : 'actor-removed';


function iconBoxSize(icon) {
    const gicon = icon.gicon;
    const giconName = gicon && gicon.get_names ? gicon.get_names()[0] : '';
    const name = (icon.icon_name || giconName || '').toLowerCase();

    const match = CFG.QS_ICON_GLYPH_FILL.find(([key]) => name.includes(key));
    return match ? Math.max(MIN_ICON_BOX, Math.round(CFG.QS_ICON_VISUAL_SIZE / match[1])) : CFG.QS_ICON_SIZE;
}

function isSpecialWidget(actor) {
    const styleClass = actor.get_style_class_name() || '';
    const name = actor.name || '';
    return styleClass.includes('power-profile') || styleClass.includes('battery') ||
        styleClass.includes('system-status-icon') || name.includes('battery') || name.includes('power');
}

export default class QuickSettingsManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.actor = null;
        this.indicator = null;
        this._state = null;
        this._hookedActors = null;
        this._isVertical = false;
        this._relayoutId = 0;
        this._timeouts = new TimeoutTracker();
    }

    steal(targetSide, isVertical) {
        this.indicator = Main.panel.statusArea.quickSettings;
        if (!this.indicator) return null;

        const target = this.indicator.container;
        this.actor = target;
        this._isVertical = isVertical;
        this._state = new NativeActorState();
        this._hookedActors = new Set();
        this._state.rememberPlace(target);
        target.get_parent().remove_child(target);

        this._normalize(target, isVertical);
        stylePanelItem(this._state, target, false, isVertical);

        const baseStyle = target.get_style() || '';
        const gap = isVertical ? `margin-bottom: ${CFG.QS_DATE_GAP}px;` : `margin-right: ${CFG.QS_DATE_GAP}px;`;
        this._state.setStyle(target, `${baseStyle} ${gap}`.trim());
        this._state.set(target, {
            reactive: true,
            can_focus: false,
            track_hover: true,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let lastSize = -1;
        this._state.connect(target, 'notify::allocation', () => {
            const size = Math.round(this._isVertical ? target.height : target.width);
            if (size > 0 && Math.abs(size - lastSize) >= 2) {
                lastSize = size;
                this.dockUI.syncPanelSpace();
            }
        });

        this.updateArrowSide(targetSide);
        hookPopupGap(this.dockUI, this.indicator.menu);

        this._queueRelayout();
        return target;
    }

    _styleIcon(icon) {
        const size = iconBoxSize(icon);
        this._state.set(icon, { icon_size: size });
        this._state.setSize(icon, size, size);
        this._state.setStyle(icon, `icon-size: ${size}px !important; width: ${size}px !important; ` +
            `height: ${size}px !important; margin: 0 1px !important; padding: 0 !important;`);
    }

    _normalize(actor, isVertical) {
        if (!actor.get_style_class_name) return;
        const isFirstVisit = !this._hookedActors.has(actor);
        this._hookedActors.add(actor);

        if (!isVertical) {
            this._state.set(actor, { y_align: Clutter.ActorAlign.CENTER, y_expand: false });
        } else {
            this._state.set(actor, { x_align: Clutter.ActorAlign.CENTER, x_expand: false });
        }

        if ('clutter_text' in actor) {
            this._state.setStyle(actor, `font-size: ${CFG.QS_LABEL_FONT_SIZE}px !important; font-weight: 600; margin: 0 2px !important; padding-top: 1px !important; line-height: 1 !important;`);
            if (actor.clutter_text) {
                this._state.set(actor.clutter_text, {
                    ellipsize: Pango.EllipsizeMode.NONE,
                    line_wrap: false,
                });
            }
            if (isFirstVisit) {
                this._state.connect(actor, 'notify::text', () => this._onSubtreeChanged(actor));
            }
        } else if ('icon_size' in actor) {
            this._styleIcon(actor);
            if (isFirstVisit) {
                this._state.connect(actor,
                    'notify::icon-name', () => {
                        this._styleIcon(actor);
                        this._onSubtreeChanged(actor);
                    },
                    'notify::gicon', () => {
                        this._styleIcon(actor);
                        this._onSubtreeChanged(actor);
                    });
            }
        } else if ('orientation' in actor || 'vertical' in actor) {
            this._state.setVertical(actor, isVertical);
            this._state.setStyle(actor, `spacing: ${CFG.QS_SPACING}px !important;`);
        } else if ('get_surface_size' in actor || (isSpecialWidget(actor) && actor.get_n_children() === 0)) {
            const size = CFG.QS_ICON_SIZE;
            this._state.setSize(actor, size, size);
            this._state.setStyle(actor, `width: ${size}px !important; height: ${size}px !important; margin: 0 1px !important; padding: 0 !important;`);
        }

        if (isFirstVisit) {
            this._state.connect(actor,
                'notify::visible', () => {
                    if ('icon_size' in actor && actor.visible) this._styleIcon(actor);
                    this._onSubtreeChanged(actor);
                },
                CHILD_ADDED_SIGNAL, (_container, child) => {
                    this._normalize(child, this._isVertical);
                    this._onSubtreeChanged(child);
                },
                CHILD_REMOVED_SIGNAL, () => this._onSubtreeChanged(actor));
        }

        for (const child of actor.get_children()) this._normalize(child, isVertical);
    }

    _relayoutChain(leaf) {
        if (!isActorAlive(this.actor)) return;

        const chain = [];
        const rootParent = this.actor.get_parent();
        let curr = isActorAlive(leaf) ? leaf : this.actor;
        while (curr) {
            chain.push(curr);
            if (curr === rootParent) break;
            curr = curr.get_parent();
        }
        for (let i = chain.length - 1; i >= 0; i--) {
            if (isActorAlive(chain[i])) chain[i].queue_relayout();
        }
    }

    _onSubtreeChanged(actor) {
        this._relayoutChain(actor);
        this._queueRelayout();
    }

    _queueRelayout() {
        this._timeouts.remove(this._relayoutId);
        this._relayoutId = this._timeouts.addTimeout(GLib.PRIORITY_DEFAULT, RELAYOUT_DELAY_MS, () => {
            this._relayoutId = 0;
            if (isActorAlive(this.actor)) {
                this._relayoutChain(this.indicator._indicators);
                this.dockUI.syncPanelSpace();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    updateArrowSide(targetSide) {
        this._state.setArrowSide(this.indicator.menu._boxPointer, targetSide);
    }

    restore() {
        if (this._relayoutId) {
            this._timeouts.remove(this._relayoutId);
            this._relayoutId = 0;
        }
        if (!this.indicator) return;

        unhookPopupGap(this.indicator.menu);
        this._state.restore();
        this._state = null;
        this._hookedActors = null;

        this.actor = null;
        this.indicator = null;
    }

    destroy() {
        this.restore();
        if (this._timeouts) {
            this._timeouts.destroy();
            this._timeouts = null;
        }
    }
}