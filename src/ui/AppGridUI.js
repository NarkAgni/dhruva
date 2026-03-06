import St from 'gi://St';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function getAllApps() {
    let appSystem = Shell.AppSystem.get_default();
    let appInfos = appSystem.get_installed();

    let apps = [];
    appInfos.forEach(appInfo => {
        if (appInfo && appInfo.should_show()) {
            let shellApp = appSystem.lookup_app(appInfo.get_id());
            if (shellApp) apps.push(shellApp);
        }
    });
    return apps;
}

export default class AppGridUI {
    constructor(dockUI) {
        this.dockUI = dockUI;
        this.appManager = dockUI.appManager;
        this.isOpen = false;
        this.appRows = [];
        this._scrollIdleId = 0;

        if (typeof this.appManager.onStateChanged === 'function') {
            this.appManager.onStateChanged(() => {
                this.updateButtonStates();
            });
        }

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
            if (event.type() === Clutter.EventType.TOUCH_END) this.hide();
            return Clutter.EVENT_STOP;
        });

        this.panel = new St.BoxLayout({ 
            style_class: 'app-list-panel', 
            vertical: true, 
            reactive: true 
        });

        this.panel.connect('button-release-event', () => Clutter.EVENT_STOP);
        this.panel.connect('touch-event', () => Clutter.EVENT_STOP);

        let title = new St.Label({ text: 'All Applications', style_class: 'app-list-title' });
        this.panel.add_child(title);

        this.searchEntry = new St.Entry({
            style_class: 'app-list-search', 
            hint_text: 'Search apps...', 
            can_focus: true, 
            x_expand: true
        });

        this.searchEntry.clutter_text.connect('text-changed', () => {
            this._filterApps(this.searchEntry.get_text());
        });
        
        this.selectedIndex = -1;
        this.searchEntry.clutter_text.connect('key-press-event', (actor, event) => {
            let symbol = event.get_key_symbol();
            let visibleRows = this.appRows.filter(item => item.row.visible);
            
            if (symbol === Clutter.KEY_Down) {
                this.selectedIndex = (this.selectedIndex + 1) % visibleRows.length;
                this._updateSelection(visibleRows);
                return Clutter.EVENT_STOP;
            } else if (symbol === Clutter.KEY_Up) {
                this.selectedIndex = (this.selectedIndex - 1 + visibleRows.length) % visibleRows.length;
                this._updateSelection(visibleRows);
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
            y_expand: true
        });

        this.listContainer = new St.BoxLayout({
            vertical: true, 
            style_class: 'app-list-container',
            x_expand: true, 
            y_expand: true, 
            y_align: Clutter.ActorAlign.START
        });

        this._populateList();

        this._installedChangedId = this.appManager.appSystem.connect('installed-changed', () => {
            this._populateList();
            if (this.isOpen) this._filterApps(this.searchEntry.get_text());
        });

        this.scrollView.add_child(this.listContainer);

        this.panel.add_child(this.scrollView);
        this.actor.add_child(this.panel);
    }

    _populateList() {
        if (this.listContainer) this.listContainer.destroy_all_children();
        this.appRows = [];

        let allApps = getAllApps();
        allApps.sort((a, b) => a.get_name().localeCompare(b.get_name()));

        allApps.forEach(app => {
            let appRow = new St.BoxLayout({ 
                vertical: false, 
                style_class: 'app-list-row', 
                reactive: true, 
                x_expand: true 
            });

            let appClickArea = new St.Button({
                style_class: 'app-list-click-area', 
                reactive: true, 
                x_expand: true, 
                y_expand: true, 
                track_hover: true
            });

            let appContent = new St.BoxLayout({ 
                vertical: false, 
                y_align: Clutter.ActorAlign.CENTER, 
                x_expand: true 
            });
            
            let icon = app.create_icon_texture(32);
            let iconBin = new St.Bin({ child: icon, style_class: 'app-list-icon' });
            let appName = app.get_name();
            let nameLabel = new St.Label({
                text: appName, 
                style_class: 'app-list-name', 
                y_align: Clutter.ActorAlign.CENTER, 
                x_align: Clutter.ActorAlign.START, 
                x_expand: true
            });

            appContent.add_child(iconBin);
            appContent.add_child(nameLabel);
            appClickArea.set_child(appContent);

            appClickArea.connect('clicked', () => {
                app.activate();
                Main.overview.hide();
                this.hide();
            });

            let isPinned = this.appManager.hasApp(app);
            let toggleIcon = new St.Icon({ 
                icon_name: isPinned ? 'list-remove-symbolic' : 'list-add-symbolic', 
                icon_size: 16 
            });
            let toggleButton = new St.Button({
                child: toggleIcon,
                style_class: isPinned ? 'app-list-action-button app-list-remove-button' : 'app-list-action-button app-list-add-button',
                y_align: Clutter.ActorAlign.CENTER
            });

            toggleButton.connect('clicked', () => {
                if (this.appManager.hasApp(app)) {
                    this.appManager.removeApp(app);
                } else {
                    this.appManager.addApp(app);
                }
                this.updateButtonStates();
                if (this.dockUI.actor) this.dockUI.actor._lastIconClickTime = null;
                this.dockUI.queueRender();
            });

            appRow.add_child(appClickArea);
            appRow.add_child(toggleButton);
            this.listContainer.add_child(appRow);

            this.appRows.push({ 
                row: appRow,
                name: appName.toLowerCase(), 
                app: app, 
                toggleIcon: toggleIcon, 
                toggleButton: toggleButton,
                appClickArea: appClickArea
            });
        });
    }

    updateButtonStates() {
        if (!this.appRows) return;
        this.appRows.forEach(item => {
            let isPinned = this.appManager.hasApp(item.app);
            if (isPinned) {
                item.toggleIcon.set_icon_name('list-remove-symbolic');
                item.toggleButton.set_style_class_name('app-list-action-button app-list-remove-button');
            } else {
                item.toggleIcon.set_icon_name('list-add-symbolic');
                item.toggleButton.set_style_class_name('app-list-action-button app-list-add-button');
            }
        });
    }

    _filterApps(searchText) {
        let query = searchText.toLowerCase().trim();
        let visibleCount = 0;

        this.appRows.forEach(item => {
            let isMatch = query === '' || item.name.includes(query);

            if (isMatch) {
                item.row.show();
                visibleCount++;
            } else {
                item.row.hide();
            }
        });

        this.selectedIndex = visibleCount > 0 ? 0 : -1;
        this._updateSelection();

        let rowHeight = 48;
        let baseHeight = 110;
        let totalHeight = baseHeight + (visibleCount * rowHeight);

        let maxPanelHeight = 450;
        let finalHeight = Math.min(maxPanelHeight, totalHeight);

        this.panel.set_height(finalHeight);

        if (this.isOpen) {
            this._updatePosition();
        }
    }

    _updateSelection(visibleRows = null) {
        if (!visibleRows) visibleRows = this.appRows.filter(item => item.row.visible);
        
        this.appRows.forEach(item => {
            item.appClickArea.set_style('');
        });
        
        if (this.selectedIndex >= 0 && this.selectedIndex < visibleRows.length) {
            let target = visibleRows[this.selectedIndex];
            target.appClickArea.set_style('background-color: rgba(255,255,255,0.15); border-radius: 8px;');
            this._scrollToItem(target.row);
        }
    }

    _scrollToItem(button) {
        if (this._scrollIdleId) {
            GLib.source_remove(this._scrollIdleId);
            this._scrollIdleId = 0;
        }

        this._scrollIdleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._scrollIdleId = 0;
            try {
                let adjustment = this.scrollView.vadjustment;
                if (!button || !adjustment) return GLib.SOURCE_REMOVE;

                let pageSize = adjustment.get_page_size();
                let currentValue = adjustment.get_value();
                let allocation = button.get_allocation_box();

                let topEdge = allocation.y1;
                let bottomEdge = allocation.y2;
                let padding = 10;

                if (topEdge < currentValue) {
                    adjustment.set_value(topEdge);
                } else if (bottomEdge + padding > currentValue + pageSize) {
                    adjustment.set_value(bottomEdge + padding - pageSize);
                }
            } catch(e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyChameleonStyle() {
        try {
            if (this.dockUI.settings.get_string('dock-theme') !== 'chameleon') {
                this.panel.set_style('');
                if (this._searchStyleApplied) {
                    this.searchEntry.set_style('');
                    this._searchStyleApplied = false;
                }
                return;
            }

            const c = this.dockUI._chameleonColor?.bg;
            const accent = this.dockUI._chameleonAccent || '#ffffff';
            if (!c) return;

            const hex = accent.replace('#', '');
            const ar = parseInt(hex.substring(0, 2), 16);
            const ag = parseInt(hex.substring(2, 4), 16);
            const ab = parseInt(hex.substring(4, 6), 16);

            this.panel.set_style(`
                background-color: rgba(${c.r}, ${c.g}, ${c.b}, 0.82);
                border-radius: 16px;
                border: 1px solid rgba(${ar}, ${ag}, ${ab}, 0.35);
                padding: 15px;
                box-shadow: 0px 10px 30px rgba(${c.r}, ${c.g}, ${c.b}, 0.55);
            `);

            this.searchEntry.set_style(`
                background-color: rgba(0, 0, 0, 0.35);
                color: white;
                border-radius: 8px;
                border: 1px solid rgba(${ar}, ${ag}, ${ab}, 0.5);
                padding: 8px 12px;
                margin-bottom: 15px;
                selection-background-color: rgba(${ar}, ${ag}, ${ab}, 0.6);
                selected-color: white;
            `);
            this._searchStyleApplied = true;
        } catch (e) { }
    }

    toggle(dockPosition) {
        this.isOpen ? this.hide() : this.show(dockPosition);
    }

    show(dockPosition) {
        Main.layoutManager.addChrome(this.actor, { affectsStruts: false });
        let { monitor } = this.dockUI.monitorManager.getCurrentMonitor();
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);

        this.searchEntry.set_text('');
        global.stage.set_key_focus(this.searchEntry);

        this.dockUI.isAppGridOpenFlag = true;
        this.isOpen = true;
        this.updateButtonStates();

        this._applyChameleonStyle();

        this._filterApps('');
        this._updatePosition(dockPosition);
    }

    _updatePosition(overrideDockPos) {
        let { monitor } = this.dockUI.monitorManager.getCurrentMonitor();
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let dockActor = this.dockUI.actor;
        let [dockX, dockY] = dockActor.get_transformed_position();
        let [dockW, dockH] = dockActor.get_transformed_size();

        let panelW = 380;
        let panelH = this.panel.get_height();
        this.panel.set_width(panelW);

        this.dockUI.isAppGridOpenFlag = false;

        let gap = 15;
        let posX = dockX + (dockW / 2) - (panelW / 2);
        let posY = dockY;

        let dockPos = overrideDockPos || this.dockUI.dockPosition;
        if (dockPos === 'TOP') {
            posY = dockY + dockH + gap;
            if (posY < workArea.y) posY = workArea.y + gap;
        }
        else if (dockPos === 'BOTTOM') posY = dockY - panelH - gap;
        else if (dockPos === 'LEFT') { posX = dockX + dockW + gap; posY = dockY + (dockH / 2) - (panelH / 2); }
        else if (dockPos === 'RIGHT') { posX = dockX - panelW - gap; posY = dockY + (dockH / 2) - (panelH / 2); }

        if (posX < monitor.x + gap) posX = monitor.x + gap;
        if (posX + panelW > monitor.x + monitor.width - gap) posX = monitor.x + monitor.width - panelW - gap;
        if (posY < workArea.y) posY = workArea.y + gap;
        if (posY + panelH > workArea.y + workArea.height - gap) posY = workArea.y + workArea.height - panelH - gap;

        this.panel.set_position(posX, posY);
    }

    hide() {
        if (this.actor.get_parent()) {
            Main.layoutManager.removeChrome(this.actor);
        }
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