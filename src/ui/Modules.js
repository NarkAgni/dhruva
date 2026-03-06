import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import AppContextMenu from './ContextMenu.js';
import { applyIconFilter } from './DragDrop.js';
import ScrollManager from '../core/ScrollManager.js';
import WorkspaceFilter from '../core/WorkspaceFilter.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { animateIconClick } from './effects/IconClickEffect.js';
import { animateMinimize, animateRestore } from './effects/WindowEffects.js';

const _forcedFolderState = {};

export function buildModules(dockUI, iconSize) {
    const systemModules = [];
    let clockModule = null;
    let gridModule = null;
    const settings = dockUI.settings;
    const isVertical = dockUI.dockPosition === 'LEFT' || dockUI.dockPosition === 'RIGHT';

    const toggleAppWindow = (uri, possibleTitles, btnActor) => {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows();
        const focusWin = global.display.get_focus_window();

        const targetWin = windows.find(w => {
            if (!w.get_wm_class()?.toLowerCase().includes('nautilus')) return false;
            return possibleTitles.includes(w.get_title());
        });

        if (targetWin) {
            if (targetWin === focusWin) animateMinimize(targetWin, btnActor, dockUI.dockPosition);
            else { 
                animateRestore(targetWin, btnActor, dockUI.dockPosition); 
                Main.activateWindow(targetWin); 
            }
        } else {
            try { Gio.AppInfo.launch_default_for_uri(uri, null); } catch (e) { }

            if (possibleTitles && possibleTitles.length > 0) {
                const mainTitle = possibleTitles[0];
                _forcedFolderState[mainTitle] = Date.now();
                dockUI.queueRender();

                if (!dockUI._folderTimeouts) dockUI._folderTimeouts = [];
                const tId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    delete _forcedFolderState[mainTitle];
                    if (dockUI && dockUI.queueRender) dockUI.queueRender();
                    return GLib.SOURCE_REMOVE;
                });
                dockUI._folderTimeouts.push(tId);
            }
        }
    };

    const createBtn = (iconName, tooltipName, clickAction, possibleTitles = []) => {
        let modIconSize = iconName === 'user-trash-full' ? Math.floor(iconSize * 0.95) : Math.floor(iconSize * 1.25);
        
        const icon = new St.Icon({ 
            gicon: Gio.ThemedIcon.new(iconName), 
            icon_size: modIconSize, 
            style_class: 'dock-grid-icon' 
        });
        const iconBin = new St.Bin({ 
            child: icon, 
            width: iconSize, 
            height: iconSize, 
            x_align: Clutter.ActorAlign.CENTER, 
            y_align: Clutter.ActorAlign.CENTER 
        });
        iconBin.set_pivot_point(0.5, 0.5);

        const appBox = new St.BoxLayout({ 
            vertical: !isVertical, 
            x_align: Clutter.ActorAlign.CENTER, 
            y_align: Clutter.ActorAlign.CENTER 
        });
        appBox._isModule = true; 
        appBox.set_pivot_point(0.5, 0.5);

        const getMatchingWindows = () => {
            if (!possibleTitles.length) return [];
            let wins = [];
            const nWorkspaces = global.workspace_manager.get_n_workspaces();
            
            for (let i = 0; i < nWorkspaces; i++) {
                wins = wins.concat(global.workspace_manager.get_workspace_by_index(i).list_windows());
            }
            
            const filteredWins = wins.filter(w => {
                const wmClass = w.get_wm_class();
                if (!wmClass) return false;
                const isNautilus = wmClass.toLowerCase().includes('nautilus') || wmClass.toLowerCase().includes('files');
                const winTitle = w.get_title() || '';
                return isNautilus && possibleTitles.some(t => winTitle.includes(t));
            });
            return WorkspaceFilter.filterWindows(filteredWins, settings);
        };

        const activeWins = getMatchingWindows();
        const isRunning = activeWins.length > 0 || (possibleTitles.length > 0 && _forcedFolderState[possibleTitles[0]] !== undefined);

        if (isRunning && settings.get_boolean('show-running-indicators')) {
            const indProps = dockUI._getIndicatorProps();
            const indStyle = settings.get_string('indicator-style') || 'dot';
            const numDots = (activeWins.length > 1 && (indStyle === 'dot' || indStyle === 'square')) ? 2 : 1;

            const dotBox = new St.BoxLayout({ 
                vertical: isVertical, 
                x_align: Clutter.ActorAlign.CENTER, 
                y_align: Clutter.ActorAlign.CENTER 
            });
            dotBox._isIndicator = true; 
            dotBox.set_style(`${indProps.marginStr} spacing: 4px;`);

            for (let i = 0; i < numDots; i++) {
                const dot = new St.Widget({ 
                    x_align: Clutter.ActorAlign.CENTER, 
                    y_align: Clutter.ActorAlign.CENTER 
                });
                dot.set_size(indProps.dw, indProps.dh); 
                dot.set_style(indProps.style); 
                dotBox.add_child(dot);
            }
            
            if (dockUI.dockPosition === 'BOTTOM' || dockUI.dockPosition === 'RIGHT') { 
                appBox.add_child(iconBin); 
                appBox.add_child(dotBox); 
            } else { 
                appBox.add_child(dotBox); 
                appBox.add_child(iconBin); 
            }
        } else {
            appBox.add_child(iconBin);
        }

        const btnStyleClass = `dock-app-button ${isVertical ? 'dock-module-btn-vertical' : 'dock-module-btn-horizontal'}`;
        const btn = new St.Bin({ 
            child: appBox, 
            style_class: btnStyleClass, 
            reactive: true, 
            track_hover: true, 
            can_focus: false 
        });
        btn.set_pivot_point(0.5, 0.5);

        const safeId = `dhruva-module-${tooltipName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        btn._delegate = {
            app: {
                is_module: true,
                get_id: () => safeId,
                get_name: () => tooltipName,
                get_state: () => getMatchingWindows().length > 0 ? Shell.AppState.RUNNING : 0,
                get_windows: getMatchingWindows,
                get_app_info: () => null,
                can_open_new_window: () => false,
                request_quit: () => { getMatchingWindows().forEach(w => w.delete(global.get_current_time())); },
                open: () => clickAction(btn)
            }
        };

        if (settings.get_boolean('hover-zoom')) applyIconFilter(btn);

        btn.connect('button-press-event', (_actor, event) => {
            if (dockUI._activeContextMenu) return Clutter.EVENT_STOP;
            const [px, py] = event.get_coords(); 
            btn._pressX = px; 
            btn._pressY = py;
            return Clutter.EVENT_PROPAGATE;
        });

        btn.connect('button-release-event', (_actor, event) => {
            if (dockUI._activeContextMenu) { 
                dockUI._activeContextMenu.hide(); 
                return Clutter.EVENT_STOP; 
            }
            const button = event.get_button(); 
            const state = event.get_state();
            const [rx, ry] = event.get_coords();
            
            if (Math.abs(rx - (btn._pressX || rx)) > 35 || Math.abs(ry - (btn._pressY || ry)) > 35) {
                return Clutter.EVENT_PROPAGATE;
            }

            if (button === 1) {
                if (btn._wasDragged) { btn._wasDragged = false; return Clutter.EVENT_STOP; }
                dockUI.actor._lastIconClickTime = Date.now();
                animateIconClick(iconBin, settings.get_string('click-effect'));
                clickAction(btn); 
                return Clutter.EVENT_STOP;
            } else if (button === 3) {
                const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
                if (dockUI._activeContextMenu) { 
                    try { dockUI._activeContextMenu._forceDestroy(); } catch (e) { } 
                    dockUI._activeContextMenu = null; 
                }
                new AppContextMenu(dockUI, btn._delegate.app, btn, isCtrl, dockUI.openPrefsCallback).show(dockUI.dockPosition);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        ScrollManager.setupAppScroll(btn, getMatchingWindows, settings);
        
        return btn;
    };

    if (settings.get_boolean('show-grid-button')) {
        gridModule = createBtn('view-app-grid', 'Applications', () => {
            dockUI.appGridUI.toggle(dockUI.dockPosition);
            if (dockUI.appGridUI.isOpen && dockUI.actor) dockUI.actor._suppressZoom = true;
        });
    }

    if (!dockUI._hiddenWindowsByDesktopBtn) dockUI._hiddenWindowsByDesktopBtn = [];

    if (settings.get_boolean('show-desktop-button')) {
        systemModules.push(createBtn('user-desktop', 'Show Desktop', () => {
            const workspace = global.workspace_manager.get_active_workspace();
            const windows = workspace.list_windows().filter(w => w.get_window_type() !== 1 && !w.is_skip_taskbar() && !w.is_always_on_all_workspaces());
            const visibleWindows = windows.filter(w => !w.minimized);
            
            if (visibleWindows.length === 0 && dockUI._hiddenWindowsByDesktopBtn.length > 0) {
                dockUI._hiddenWindowsByDesktopBtn.forEach(w => { 
                    if (w && !w.is_destroyed()) { 
                        w.unminimize(); 
                        Main.activateWindow(w); 
                    } 
                });
                dockUI._hiddenWindowsByDesktopBtn = [];
            } else { 
                dockUI._hiddenWindowsByDesktopBtn = visibleWindows; 
                visibleWindows.forEach(w => w.minimize()); 
            }
        }));
    }

    if (settings.get_boolean('show-home')) {
        const homeDir = GLib.get_home_dir();
        const homeName = homeDir.split('/').pop();
        const realName = GLib.get_real_name() || '';
        const titles = ['Home', homeName, realName];
        systemModules.push(createBtn('user-home', 'Home', (btn) => toggleAppWindow(`file://${homeDir}`, titles, btn), titles));
    }
    
    if (settings.get_boolean('show-downloads')) systemModules.push(createBtn('folder-download', 'Downloads', (btn) => toggleAppWindow(`file://${GLib.get_home_dir()}/Downloads`, ['Downloads'], btn), ['Downloads']));
    if (settings.get_boolean('show-documents')) systemModules.push(createBtn('folder-documents', 'Documents', (btn) => toggleAppWindow(`file://${GLib.get_home_dir()}/Documents`, ['Documents'], btn), ['Documents']));
    if (settings.get_boolean('show-pictures')) systemModules.push(createBtn('folder-pictures', 'Pictures', (btn) => toggleAppWindow(`file://${GLib.get_home_dir()}/Pictures`, ['Pictures'], btn), ['Pictures']));
    if (settings.get_boolean('show-videos')) systemModules.push(createBtn('folder-videos', 'Videos', (btn) => toggleAppWindow(`file://${GLib.get_home_dir()}/Videos`, ['Videos'], btn), ['Videos']));
    if (settings.get_boolean('show-music')) systemModules.push(createBtn('folder-music', 'Music', (btn) => toggleAppWindow(`file://${GLib.get_home_dir()}/Music`, ['Music'], btn), ['Music']));
    if (settings.get_boolean('show-trash')) systemModules.push(createBtn('user-trash-full', 'Recycle Bin', (btn) => toggleAppWindow('trash://', ['Trash'], btn), ['Trash']));

    try {
        const customFoldersRaw = settings.get_string('custom-folders');
        if (customFoldersRaw) {
            JSON.parse(customFoldersRaw).forEach(f => {
                const fPath = f.path || '/'; 
                const fName = f.name || 'Custom Folder'; 
                const fIcon = f.icon || 'folder-symbolic';
                const uri = fPath.startsWith('file://') || fPath.includes('://') ? fPath : Gio.File.new_for_path(fPath).get_uri();
                systemModules.push(createBtn(fIcon, fName, (btn) => toggleAppWindow(uri, [fName], btn), [fName]));
            });
        }
    } catch (e) {}

    if (settings.get_boolean('show-clock') && !isVertical) {
        let fontSize = 15;
        try { fontSize = settings.get_int('clock-font-size'); } catch (e) { }

        const clockLabel = new St.Label({
            y_align: Clutter.ActorAlign.CENTER, 
            style_class: 'dock-clock-label',
            style: `font-size: ${fontSize}px; font-weight: 700; text-shadow: 0px 1px 3px rgba(0,0,0,0.7); padding: 0 0;`
        });

        const clockBtn = new St.Bin({ 
            child: clockLabel, 
            style_class: 'dock-app-button clock-module', 
            reactive: true, 
            track_hover: false, 
            can_focus: false 
        });
        clockBtn.set_pivot_point(0.5, 0.5);

        clockBtn.ease = function (props) {
            const newProps = Object.assign({}, props);
            delete newProps.scale_x; 
            delete newProps.scale_y; 
            Clutter.Actor.prototype.ease.call(this, newProps);
        };
        const origScale = clockBtn.set_scale.bind(clockBtn);
        clockBtn.set_scale = (sx, sy) => { if (sx === 1 && sy === 1) origScale(sx, sy); };
        clockBtn._delegate = { app: { get_name: () => 'Date & Time', get_state: () => 0, get_windows: () => [] } };

        const updateClock = () => { 
            clockLabel.set_text(GLib.DateTime.new_now_local().format('%a %d | %I:%M %p')); 
            return GLib.SOURCE_CONTINUE; 
        };
        updateClock();
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, updateClock);
        clockBtn.connect('destroy', () => { if (timeoutId) GLib.source_remove(timeoutId); });
        clockModule = clockBtn;
    }

    return { systemModules, clockModule, gridModule };
}