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
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import AppContextMenu from './context-menu/AppContextMenu.js';


function getAllApps() {
    const appSystem = Shell.AppSystem.get_default();
    const appInfos = appSystem.get_installed();

    const apps = [];
    for (const appInfo of appInfos) {
        if (appInfo && appInfo.should_show()) {
            const shellApp = appSystem.lookup_app(appInfo.get_id());
            if (shellApp)
                apps.push(shellApp);
        }
    }
    return apps;
}

export default class AppGridUI {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.appManager = dockUI.appManager;
        this.isOpen = false;
        this.appRows = [];
        this._scrollIdleId = 0;
        this.isGridView = true;
        this.selectedIndex = -1;

        this.actor = new St.Widget({
            style_class: 'app-list-overlay',
            reactive: true,
            x_expand: true,
            y_expand: true,
        });

        this.actor.connect('button-release-event', () => {
            this.hide();
            return Clutter.EVENT_STOP;
        });

        this.actor.connect('touch-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.TOUCH_END)
                this.hide();
            return Clutter.EVENT_STOP;
        });

        this.panel = new St.BoxLayout({
            style_class: 'app-list-panel',
            vertical: true,
            reactive: true,
        });

        this.panel.connect('button-release-event', () => Clutter.EVENT_STOP);
        this.panel.connect('touch-event', () => Clutter.EVENT_STOP);

        const headerBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style: 'margin-bottom: 12px;',
        });

        const leftSpacer = new St.Widget({ x_expand: true });

        const title = new St.Label({
            text: 'All Applications',
            style_class: 'app-list-title',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.toggleViewBtn = new St.Button({
            child: new St.Icon({
                icon_name: this.isGridView ? 'view-list-symbolic' : 'view-grid-symbolic',
                icon_size: 18,
            }),
            style: 'padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,0.1); transition-duration: 150ms;',
            y_align: Clutter.ActorAlign.START,
            reactive: true,
        });

        this.toggleViewBtn.connect('notify::hover', () => {
            const isHovered = this.toggleViewBtn.hover;
            const bgOpacity = isHovered ? '0.25' : '0.1';
            this.toggleViewBtn.set_style(`padding: 6px; border-radius: 6px; background-color: rgba(255,255,255,${bgOpacity}); transition-duration: 150ms;`);
        });

        this.toggleViewBtn.connect('clicked', () => {
            this.isGridView = !this.isGridView;
            this.toggleViewBtn.get_child().set_icon_name(
                this.isGridView ? 'view-list-symbolic' : 'view-grid-symbolic'
            );
            this._filterApps(this.searchEntry.get_text());
            this._updatePosition();
        });

        const rightContainer = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        rightContainer.add_child(this.toggleViewBtn);

        headerBox.add_child(leftSpacer);
        headerBox.add_child(title);
        headerBox.add_child(rightContainer);
        this.panel.add_child(headerBox);

        this.searchEntry = new St.Entry({
            style_class: 'app-list-search',
            hint_text: 'Search apps...',
            can_focus: true,
            x_expand: true,
        });

        this.searchEntry.clutter_text.connect('text-changed', () => {
            this._filterApps(this.searchEntry.get_text());
        });

        this.searchEntry.clutter_text.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            const visibleRows = this.appRows;
            if (visibleRows.length === 0)
                return Clutter.EVENT_PROPAGATE;

            const cols = this.isGridView ? 5 : 1;

            if (symbol === Clutter.KEY_Down) {
                this.selectedIndex = Math.min(this.selectedIndex + cols, visibleRows.length - 1);
                this._updateSelection();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Up) {
                this.selectedIndex = Math.max(this.selectedIndex - cols, 0);
                this._updateSelection();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Right && this.isGridView) {
                this.selectedIndex = Math.min(this.selectedIndex + 1, visibleRows.length - 1);
                this._updateSelection();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Left && this.isGridView) {
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this._updateSelection();
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                if (this.selectedIndex >= 0 && this.selectedIndex < visibleRows.length) {
                    visibleRows[this.selectedIndex].app.activate();
                    Main.overview.hide();
                    this.hide();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.panel.add_child(this.searchEntry);

        this.scrollView = new St.ScrollView({
            style_class: 'app-list-scrollview',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });

        this.listContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'app-list-container',
            style: 'padding-bottom: 16px;',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
        });

        this._populateData();

        this._installedChangedId = this.appManager.appSystem.connect('installed-changed', () => {
            this._populateData();
            if (this.isOpen)
                this._filterApps(this.searchEntry.get_text());
        });

        this.scrollView.add_child(this.listContainer);
        this.panel.add_child(this.scrollView);
        this.actor.add_child(this.panel);
    }

    _populateData() {
        const allApps = getAllApps();
        this.allAppsData = allApps.map(app => ({
            app,
            name: app.get_name(),
            lowerName: app.get_name().toLowerCase(),
        })).sort((a, b) => a.name.localeCompare(b.name));
    }

    _createOptimizedLabel(text, fontSize, isGrid) {
        const label = new St.Label({
            text,
            style: `font-size: ${fontSize}px; font-weight: bold; color: #ffffff; text-shadow: 0px 1px 3px rgba(0,0,0,0.8);`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: isGrid ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
            x_expand: true,
        });

        if (isGrid) {
            label.style += ' margin-top: 6px; text-align: center;';
            if (label.clutter_text) {
                label.clutter_text.ellipsize = 3;
                label.clutter_text.line_wrap = false;
            }
        }

        return label;
    }

    _createListItem(app, name) {
        const btn = new St.Button({
            style_class: 'app-list-click-area',
            reactive: true,
            x_expand: true,
            track_hover: true,
            style: 'border-radius: 8px;',
        });
        const content = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'padding: 6px 4px;',
        });
        const icon = app.create_icon_texture(32);
        const nameLabel = this._createOptimizedLabel(name, 14, false);

        content.add_child(new St.Bin({ child: icon, style_class: 'app-list-icon', style: 'margin-right: 12px;' }));
        content.add_child(nameLabel);
        btn.set_child(content);

        btn.connect('notify::hover', () => {
            btn.set_style(btn.hover ? 'background-color: rgba(255,255,255,0.15); border-radius: 8px;' : 'border-radius: 8px;');
        });

        this._attachAppClickEvents(btn, app);
        return btn;
    }

    _createGridItem(app, name) {
        const btn = new St.Button({
            style_class: 'app-grid-click-area',
            reactive: true,
            track_hover: true,
            style: 'border-radius: 12px; padding: 12px 4px;',
        });
        btn.set_size(96, 104);

        const content = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.FILL,
        });
        const icon = app.create_icon_texture(48);
        const nameLabel = this._createOptimizedLabel(name, 12, true);

        content.add_child(new St.Bin({ child: icon, x_align: Clutter.ActorAlign.CENTER }));
        content.add_child(nameLabel);
        btn.set_child(content);

        btn.connect('notify::hover', () => {
            btn.set_style(btn.hover ? 'background-color: rgba(255,255,255,0.15); border-radius: 12px; padding: 12px 4px;' : 'border-radius: 12px; padding: 12px 4px;');
        });

        this._attachAppClickEvents(btn, app);
        return btn;
    }

    _attachAppClickEvents(btn, app) {
        btn.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                if (this.dockUI._activeContextMenu)
                    this.dockUI._activeContextMenu.hide();

                const state = event.get_state();
                const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

                this.dockUI._activeContextMenu = new AppContextMenu(
                    this.dockUI,
                    app,
                    btn,
                    isCtrl,
                    this.dockUI.openPrefsCallback,
                    true
                );

                const [, y] = btn.get_transformed_position();
                const dynamicDockPos = (y > (global.stage.height / 2)) ? 'BOTTOM' : 'TOP';

                this.dockUI._activeContextMenu.show(dynamicDockPos);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        btn.connect('clicked', () => {
            app.activate();
            Main.overview.hide();
            this.hide();
        });
    }

    _filterApps(searchText) {
        if (this.listContainer)
            this.listContainer.destroy_all_children();
        this.appRows = [];

        const query = searchText.toLowerCase().trim();
        const visibleApps = this.allAppsData.filter(item => query === '' || item.lowerName.includes(query));
        const visibleCount = visibleApps.length;

        if (this.isGridView) {
            let rowBox = null;
            const cols = 5;
            visibleApps.forEach((item, index) => {
                if (index % cols === 0) {
                    rowBox = new St.BoxLayout({
                        vertical: false,
                        style: 'spacing: 4px; margin-bottom: 4px;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });
                    this.listContainer.add_child(rowBox);
                }
                const widget = this._createGridItem(item.app, item.name);
                rowBox.add_child(widget);
                this.appRows.push({ app: item.app, widget, row: rowBox });
            });
        } else {
            visibleApps.forEach(item => {
                const widget = this._createListItem(item.app, item.name);
                this.listContainer.add_child(widget);
                this.appRows.push({ app: item.app, widget, row: widget });
            });
        }

        this.selectedIndex = visibleCount > 0 ? 0 : -1;
        this._updateSelection();

        const baseHeight = 125;
        let totalHeight = 0;

        if (this.isGridView) {
            const numRows = Math.ceil(visibleCount / 5);
            totalHeight = baseHeight + (numRows * 115) + 20;
        } else {
            const rowHeight = 48;
            totalHeight = baseHeight + (visibleCount * rowHeight) + 20;
        }

        const maxPanelHeight = 520;
        const finalHeight = Math.min(maxPanelHeight, totalHeight);

        this.panel.set_height(finalHeight);

        if (this.isOpen)
            this._updatePosition();
    }

    _updateSelection() {
        this.appRows.forEach(item => {
            if (this.isGridView)
                item.widget.set_style('border-radius: 12px; padding: 12px 4px; background-color: transparent;');
            else
                item.widget.set_style('border-radius: 8px; background-color: transparent;');
        });

        if (this.selectedIndex >= 0 && this.selectedIndex < this.appRows.length) {
            const target = this.appRows[this.selectedIndex];
            if (this.isGridView)
                target.widget.set_style('border-radius: 12px; padding: 12px 4px; background-color: rgba(255,255,255,0.20);');
            else
                target.widget.set_style('border-radius: 8px; background-color: rgba(255,255,255,0.20);');
            this._scrollToItem(target.widget);
        }
    }

    _scrollToItem(button) {
        if (this._scrollIdleId) {
            GLib.source_remove(this._scrollIdleId);
            this._scrollIdleId = 0;
        }

        this._scrollIdleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._scrollIdleId = 0;
            const adjustment = this.scrollView.vadjustment;
            if (!button || !adjustment)
                return GLib.SOURCE_REMOVE;

            const pageSize = adjustment.get_page_size();
            const currentValue = adjustment.get_value();

            const targetActor = (this.isGridView && button.get_parent && button.get_parent())
                ? button.get_parent()
                : button;

            const allocation = targetActor.get_allocation_box();
            const topEdge = allocation.y1;
            const bottomEdge = allocation.y2;
            const padding = 10;

            if (topEdge < currentValue + padding) {
                adjustment.set_value(Math.max(0, topEdge - padding));
            } else if (bottomEdge + padding > currentValue + pageSize) {
                adjustment.set_value(bottomEdge + padding - pageSize);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyChameleonStyle() {
        const settings = this.dockUI.settings;
        const themeId = settings.get_string('dock-theme') || 'default';
        const opacity = settings.get_int('background-opacity') / 100.0;
        const sWidth = settings.get_int('stroke-width');
        const sColor = settings.get_string('stroke-color') || '#ffffff';
        const sOpacity = settings.get_int('stroke-opacity') / 100.0;

        const _hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16),
                  g = parseInt(hex.slice(3, 5), 16),
                  b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        let bgRgba = _hexToRgba(settings.get_string('background-color') || '#241F31', opacity);
        let strokeRgba = sWidth > 0 ? _hexToRgba(sColor, sOpacity) : 'transparent';

        if (themeId === 'chameleon') {
            const c = this.dockUI._chameleonColor?.bg || { r: 30, g: 30, b: 45 };
            bgRgba = `rgba(${c.r}, ${c.g}, ${c.b}, 0.88)`;
            strokeRgba = 'rgba(255, 255, 255, 0.2)';
        } else if (this.dockUI.actor._tooltipBg) {
            const css = this.dockUI.actor._tooltipBg;
            let match = css.match(/background-gradient-start:\s*(rgba?\([^)]+\))/);
            if (!match) match = css.match(/background-color:\s*(rgba?\([^)]+\))/);
            if (match && match[1] !== 'rgba(0, 0, 0, 0)' && match[1] !== 'transparent')
                bgRgba = match[1];
        }

        this.panel.set_style(`
            background-color: ${bgRgba};
            border-radius: 16px;
            border: ${sWidth}px solid ${strokeRgba};
            padding: 15px;
            box-shadow: 0px 10px 30px rgba(0,0,0,0.5);
        `);

        this.searchEntry.set_style(`
            background-color: rgba(0, 0, 0, 0.25);
            color: white;
            border-radius: 8px;
            border: 1px solid ${strokeRgba};
            padding: 8px 12px;
            margin-bottom: 12px;
            box-shadow: none;
        `);
    }

    toggle(dockPosition) {
        if (this.isOpen)
            this.hide();
        else
            this.show(dockPosition);
    }

    show(dockPosition) {
        Main.layoutManager.addChrome(this.actor, { affectsStruts: false });
        const { monitor } = this.dockUI.monitorManager.getCurrentMonitor();
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);

        this.searchEntry.set_text('');
        global.stage.set_key_focus(this.searchEntry);

        this.dockUI.isAppGridOpenFlag = true;
        this.isOpen = true;

        this._applyChameleonStyle();
        this._filterApps('');
        this._updatePosition(dockPosition);
    }

    _updatePosition(overrideDockPos) {
        const { monitor } = this.dockUI.monitorManager.getCurrentMonitor();
        const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const dockActor = this.dockUI.actor;
        const [dockX, dockY] = dockActor.get_transformed_position();
        const [dockW, dockH] = dockActor.get_transformed_size();

        const panelW = this.isGridView ? 575 : 380;
        const panelH = this.panel.get_height();
        this.panel.set_width(panelW);

        this.dockUI.isAppGridOpenFlag = false;

        const gap = 15;
        let posX = dockX + (dockW / 2) - (panelW / 2);
        let posY = dockY;

        const dockPos = overrideDockPos || this.dockUI.dockPosition;
        if (dockPos === 'TOP') {
            posY = dockY + dockH + gap;
            if (posY < workArea.y) posY = workArea.y + gap;
        } else if (dockPos === 'BOTTOM') {
            posY = dockY - panelH - gap;
        } else if (dockPos === 'LEFT') {
            posX = dockX + dockW + gap;
            posY = dockY + (dockH / 2) - (panelH / 2);
        } else if (dockPos === 'RIGHT') {
            posX = dockX - panelW - gap;
            posY = dockY + (dockH / 2) - (panelH / 2);
        }

        if (posX < monitor.x + gap) posX = monitor.x + gap;
        if (posX + panelW > monitor.x + monitor.width - gap) posX = monitor.x + monitor.width - panelW - gap;
        if (posY < workArea.y) posY = workArea.y + gap;
        if (posY + panelH > workArea.y + workArea.height - gap) posY = workArea.y + workArea.height - panelH - gap;

        this.panel.set_position(posX, posY);
    }

    hide() {
        if (this._contextMenu) {
            this._contextMenu.destroy();
            this._contextMenu = null;
        }
        if (this.actor.get_parent())
            Main.layoutManager.removeChrome(this.actor);

        this.isOpen = false;
    }

    destroy() {
        if (this._installedChangedId) {
            this.appManager.appSystem.disconnect(this._installedChangedId);
            this._installedChangedId = null;
        }
        if (this._scrollIdleId) {
            GLib.source_remove(this._scrollIdleId);
            this._scrollIdleId = 0;
        }
        this.hide();
        if (this.actor) {
            this.actor.destroy();
            this.actor = null;
        }
        this.appRows = [];
    }
}