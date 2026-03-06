import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class AutoHideManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;

        this.isHidden = false;

        this._destroyed = false;
        this.signals = [];

        this._hideTimerId = null;
        this._showTimerId = null;
        this._updateTimerId = null;
        this._pointerUpdate = true;

        this.edgeTrigger = new St.Widget({
            name: 'DhruvaEdgeTrigger',
            reactive: true,
            opacity: 0,
            track_hover: true,
        });

        Main.layoutManager.addChrome(this.edgeTrigger, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        this._setupListeners();
    }

    _setupListeners() {
        if (this._destroyed) return;

        this._addSignal(global.display, 'notify::focus-window', () => this._scheduleUpdate());
        this._addSignal(global.display, 'restacked', () => this._scheduleUpdate());
        this._addSignal(global.workspace_manager, 'active-workspace-changed', () => this._scheduleUpdate());

        this._addSignal(global.display, 'grab-op-begin', (_d, _w, op) => {
            if (op === Meta.GrabOp.MOVING || op === Meta.GrabOp.RESIZING_UNKNOWN) this._scheduleUpdate();
        });
        this._addSignal(global.display, 'grab-op-end', () => this._scheduleUpdate());

        this._addSignal(this.dockUI.actor, 'enter-event', () => {
            this._pointerUpdate = true;
            this._show();
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.dockUI.actor, 'leave-event', () => {
            this._pointerUpdate = true;
            this._scheduleUpdate();
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.edgeTrigger, 'enter-event', () => {
            if (!this.isHidden) return Clutter.EVENT_PROPAGATE;
            this._pointerUpdate = true;
            this._show();
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.edgeTrigger, 'leave-event', () => {
            this._pointerUpdate = true;
            this._scheduleUpdate();
            return Clutter.EVENT_PROPAGATE;
        });

        this._addSignal(this.settings, 'changed::hide-mode', () => {
            this._updateEdgeTrigger();
            this._cancelTimers();
            
            const mode = this._getHideMode();
            
            if (mode === 'always') {
                if (this.dockUI && this.dockUI.actor && !this.dockUI.actor.has_pointer) {
                    this.isHidden = true;
                    this._animateHide();
                }
            } else if (mode === 'none' || mode === 'never') {
                this._show(true); 
            }
            
            this._recalculateOverlap();
        });

        this._addSignal(this.settings, 'changed::dock-position', () => this._updateEdgeTrigger());
        this._addSignal(this.settings, 'changed::dock-margin', () => this._updateEdgeTrigger());

        this._scheduleUpdate(100);
    }

    _addSignal(obj, event, cb) {
        if (this._destroyed) return;
        try {
            const id = obj.connect(event, cb);
            this.signals.push({ obj, id });
        } catch (e) { }
    }

    _getHideMode() { return this.settings.get_string('hide-mode') || 'dodge-all'; }
    _getDockPosition() { return this.settings.get_string('dock-position') || 'BOTTOM'; }

    _updateEdgeTrigger() {
        if (!this.edgeTrigger || this._destroyed || !this.dockUI || this.dockUI._isDestroyed) return;

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return;
        const monitor = monitorData.monitor;

        const pos = this._getDockPosition();
        const mode = this._getHideMode();
        const T = 12;

        let ex = 0, ey = 0, ew = 0, eh = 0;

        switch (pos) {
            case 'BOTTOM': ex = monitor.x; ew = monitor.width; ey = monitor.y + monitor.height - T; eh = T; break;
            case 'TOP': ex = monitor.x; ew = monitor.width; ey = monitor.y; eh = T; break;
            case 'LEFT': ex = monitor.x; ew = T; ey = monitor.y; eh = monitor.height; break;
            case 'RIGHT': ex = monitor.x + monitor.width - T; ew = T; ey = monitor.y; eh = monitor.height; break;
        }

        this.edgeTrigger.set_position(ex, ey);
        this.edgeTrigger.set_size(ew, eh);

        if (mode === 'none' || mode === 'never') {
            this.edgeTrigger.hide();
        } else {
            this.edgeTrigger.show();
            const parent = this.edgeTrigger.get_parent();
            if (parent) parent.set_child_above_sibling(this.edgeTrigger, null);
        }
    }

    _getTheoreticalDockBounds() {
        let dw = this.dockUI.actor.width || this.dockUI.actor._cachedW || 100;
        let dh = this.dockUI.actor.height || this.dockUI.actor._cachedH || 48;

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return { x: 0, y: 0, width: dw, height: dh }; // NAYA FIX
        const monitor = monitorData.monitor;
        
        const pos = this._getDockPosition();
        const margin = this.settings.get_int('dock-margin') || 0;

        switch (pos) {
            case 'TOP': return { x: monitor.x + (monitor.width - dw) / 2, y: monitor.y + margin, width: dw, height: dh };
            case 'BOTTOM': return { x: monitor.x + (monitor.width - dw) / 2, y: monitor.y + monitor.height - dh - margin, width: dw, height: dh };
            case 'LEFT': return { x: monitor.x + margin, y: monitor.y + (monitor.height - dh) / 2, width: dw, height: dh };
            case 'RIGHT': return { x: monitor.x + monitor.width - dw - margin, y: monitor.y + (monitor.height - dh) / 2, width: dw, height: dh };
        }
        return { x: 0, y: 0, width: dw, height: dh };
    }

    _isHovering() {
        if (!this.dockUI || !this.dockUI.actor) return false;

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return false;
        const monitor = monitorData.monitor;

        const [px, py] = global.get_pointer();
        const bounds = this._getTheoreticalDockBounds();
        const pos = this._getDockPosition();
        const buf = 15;

        let hX1 = bounds.x - buf;
        let hX2 = bounds.x + bounds.width + buf;
        let hY1 = bounds.y - buf;
        let hY2 = bounds.y + bounds.height + buf;

        if (pos === 'BOTTOM') hY2 = monitor.y + monitor.height;
        if (pos === 'TOP') hY1 = monitor.y;
        if (pos === 'LEFT') hX1 = monitor.x;
        if (pos === 'RIGHT') hX2 = monitor.x + monitor.width;

        return (px >= hX1 && px <= hX2 && py >= hY1 && py <= hY2);
    }

    _isValidWindow(win) {
        if (!win || win.minimized || win.unmanaging) return false;
        if (typeof win.is_skip_taskbar === 'function' && win.is_skip_taskbar()) return false;

        const type = win.get_window_type();
        if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK ||
            type === Meta.WindowType.MENU || type === Meta.WindowType.SPLASHSCREEN ||
            type === Meta.WindowType.DROPDOWN_MENU || type === Meta.WindowType.POPUP_MENU ||
            type === Meta.WindowType.OVERRIDE_OTHER || type === Meta.WindowType.TOOLTIP) {
            return false;
        }

        const wmClass = win.get_wm_class();
        if (wmClass === 'ding' || wmClass === 'DesktopUi' || wmClass === 'conky') return false;

        const ws = global.workspace_manager.get_active_workspace();
        return win.is_on_all_workspaces() || win.get_workspace() === ws;
    }

    _recalculateOverlap() {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        if (this.dockUI.floatingManager && this.dockUI.floatingManager.isFloating) {
            this._pointerUpdate = false;
            this._updateHidden(false, false, false);
            return;
        }

        const mode = this._getHideMode();
        
        if (mode === 'none' || mode === 'never') {
            this._pointerUpdate = false;
            this._updateHidden(false, false, false);
            return;
        }
        if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
            this._pointerUpdate = false;
            this._updateHidden(true, true, true);
            return;
        }

        const monitorData = this.dockUI.monitorManager.getCurrentMonitor();
        if (!monitorData || !monitorData.monitor) return;
        const dockMonitorIndex = monitorData.index;
        
        const bounds = this._getTheoreticalDockBounds();
        const focusWin = global.display.get_focus_window();

        let anyOverlap = false;
        let activeWinOverlap = false;
        let maximizedOverlap = false;

        for (const wa of global.get_window_actors()) {
            const win = wa.get_meta_window();
            if (!win || !this._isValidWindow(win) || win.get_monitor() !== dockMonitorIndex) continue;

            const r = win.get_frame_rect();
            const overlaps = (r.x < bounds.x + bounds.width && r.x + r.width > bounds.x &&
                r.y < bounds.y + bounds.height && r.y + r.height > bounds.y);

            if (!overlaps) continue;

            anyOverlap = true;
            if (win === focusWin) activeWinOverlap = true;
            if (win.maximized_horizontally || win.maximized_vertically || win.get_window_type() === Meta.WindowType.DIALOG) {
                maximizedOverlap = true;
            }
        }

        this._pointerUpdate = false;
        this._updateHidden(anyOverlap, activeWinOverlap, maximizedOverlap);
    }

    _updateHidden(anyOverlap, activeWinOverlap, maximizedOverlap) {
        if (this._destroyed) return;
        this._updateEdgeTrigger();

        if (this.dockUI.floatingManager && this.dockUI.floatingManager.isFloating) {
            this._show();
            return;
        }

        if (this._isHovering()) {
            this._show();
            return;
        }

        const mode = this._getHideMode();
        let shouldHide = false;

        if (mode === 'none' || mode === 'never') {
            this._show(true);
            return;
        } else if (mode === 'auto' || mode === 'always' || mode === 'always-hide') {
            shouldHide = true;
        } else if (mode === 'intelligent') {
            shouldHide = activeWinOverlap || maximizedOverlap;
        } else if (mode === 'active' || mode === 'dodge-active') {
            shouldHide = activeWinOverlap;
        } else if (mode === 'maximized' || mode === 'dodge-maximized') {
            shouldHide = maximizedOverlap;
        } else {
            shouldHide = anyOverlap;
        }

        shouldHide ? this._hide() : this._show();
    }

    _scheduleUpdate(delay = 100) {
        if (this._destroyed) return;
        if (this._updateTimerId) { GLib.source_remove(this._updateTimerId); this._updateTimerId = null; }

        this._updateTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateTimerId = null;
            this._recalculateOverlap();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelTimers() {
        if (this._hideTimerId) { GLib.source_remove(this._hideTimerId); this._hideTimerId = null; }
        if (this._showTimerId) { GLib.source_remove(this._showTimerId); this._showTimerId = null; }
    }

    _show(force = false) {
        this._cancelTimers();
        if (!this.isHidden && !force) return;
        
        this.isHidden = false;

        const unhideDelay = this._pointerUpdate ? (this.settings.get_int('unhide-delay') || 0) : 0;

        if (unhideDelay > 0 && !force) {
            this._showTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, unhideDelay, () => {
                this._showTimerId = null;
                this._animateShow();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._animateShow();
        }
    }

    _hide() {
        if (this.dockUI && this.dockUI.floatingManager && this.dockUI.floatingManager.isFloating) {
            return;
        }

        this._cancelTimers();
        if (this.isHidden) return;
        this.isHidden = true;

        const hideDelay = this.settings.get_int('hide-delay') || 200;

        this._hideTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hideDelay, () => {
            this._hideTimerId = null;
            if (!this._isHovering()) {
                this._animateHide();
            } else {
                this.isHidden = false;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _animateShow() {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        if (this.edgeTrigger) this.edgeTrigger.reactive = false;

        this.dockUI.actor.remove_all_transitions();
        this.dockUI.actor.show();
        this.dockUI.actor.visible = true;

        if (typeof this.dockUI._updateLayout === 'function') {
            this.dockUI._updateLayout();
        }

        this.dockUI.actor.ease({
            translation_x: 0,
            translation_y: 0,
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _animateHide() {
        if (this._destroyed || !this.dockUI || !this.dockUI.actor) return;

        this.dockUI.actor.remove_all_transitions();

        const pos = this._getDockPosition();
        const offset = (this.settings.get_int('dock-margin') || 0) + 15;
        let tx = 0, ty = 0;

        switch (pos) {
            case 'TOP': ty = -(this.dockUI.actor.height + offset); break;
            case 'BOTTOM': ty = this.dockUI.actor.height + offset; break;
            case 'LEFT': tx = -(this.dockUI.actor.width + offset); break;
            case 'RIGHT': tx = this.dockUI.actor.width + offset; break;
        }

        this.dockUI.actor.ease({
            translation_x: tx,
            translation_y: ty,
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this.isHidden) {
                    this.dockUI.actor.opacity = 0;
                    this.dockUI.actor.hide();
                    this.dockUI.actor.visible = false;
                }
                const mode = this._getHideMode();
                if (this.edgeTrigger && mode !== 'none' && mode !== 'never') {
                    this.edgeTrigger.reactive = true;
                }
            },
        });
    }

    destroy() {
        this._destroyed = true;
        this._cancelTimers();
        if (this._updateTimerId) { GLib.source_remove(this._updateTimerId); this._updateTimerId = null; }

        for (const s of this.signals) {
            try { if (s.id && s.obj) s.obj.disconnect(s.id); } catch (e) { }
        }
        this.signals = [];

        if (this.edgeTrigger) {
            try {
                Main.layoutManager.removeChrome(this.edgeTrigger);
                this.edgeTrigger.destroy();
            } catch (e) { }
            this.edgeTrigger = null;
        }

        this.dockUI = null;
        this.settings = null;
    }
}