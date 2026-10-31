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


import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { isActorAlive } from '../Utils.js';
import { getNotificationBannerBin } from '../Compat.js';
import { HYBRID_PANEL_CONFIG } from '../PanelConfig.js';
import { NativeActorState } from './NativeActorState.js';


function isPlaced(actor) {
    return isActorAlive(actor) && actor.is_mapped() && actor.has_allocation();
}

function stageRect(actor) {
    const [x, y] = actor.get_transformed_position();
    const box = actor.get_allocation_box();
    return { x, y, w: box.get_width(), h: box.get_height() };
}

export default class NotificationBannerManager {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this._state = null;
        this._anchor = null;
    }

    enable(anchor) {
        if (this._state) return;
        const tray = Main.messageTray;
        const bin = getNotificationBannerBin();

        this._anchor = anchor;
        this._state = new NativeActorState();
        this._state.set(tray, { bannerAlignment: Clutter.ActorAlign.START });
        this._state.set(bin, { translation_x: 0, translation_y: 0 });
        this._state.connect(bin,
            'notify::y', () => this._sync(),
            'notify::allocation', () => this._sync());
        this._state.connect(anchor, 'notify::allocation', () => this._sync());
        this._state.connect(this.dockUI.bgActor, 'notify::allocation', () => this._sync());
        this._sync();
    }

    _sync() {
        const bin = getNotificationBannerBin();
        const dock = this.dockUI.bgActor;
        if (!isPlaced(this._anchor) || !isPlaced(dock) || !isPlaced(bin)) return;

        const anchor = stageRect(this._anchor);
        const d = stageRect(dock);
        const [trayX, trayY] = Main.messageTray.get_transformed_position();
        const gap = HYBRID_PANEL_CONFIG.POPUP_BOX_GAP * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const { width, height } = bin;
        const slide = bin.y;

        let left = anchor.x + anchor.w - width;
        let top = d.y - gap - height - slide;
        switch (this.dockUI.dockPosition) {
            case 'TOP':
                top = d.y + d.h + gap + slide;
                break;
            case 'LEFT':
                left = d.x + d.w + gap;
                top = anchor.y + anchor.h - height - slide;
                break;
            case 'RIGHT':
                left = d.x - gap - width;
                top = anchor.y + anchor.h - height - slide;
                break;
        }

        bin.translation_x = Math.round(left - trayX - bin.get_allocation_box().x1);
        bin.translation_y = Math.round(top - trayY - bin.y);
    }

    restore() {
        if (this._state) {
            this._state.restore();
            this._state = null;
            this._anchor = null;
        }
    }

    destroy() {
        this.restore();
    }
}