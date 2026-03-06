import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

export default class AppManager {
    constructor(uuid) {
        this.appSystem = Shell.AppSystem.get_default();
        this.pinnedApps = [];
        
        const folderName = uuid; 
        this.extConfigDir = GLib.build_filenamev([GLib.get_user_config_dir(), folderName]);
        this.dbPath = GLib.build_filenamev([this.extConfigDir, 'dhruva-apps.json']);

        this.loadPinnedAppsSync();
    }

    loadPinnedAppsSync() {
        try {
            let [success, contents] = GLib.file_get_contents(this.dbPath);
            if (success) {
                const decoder = new TextDecoder('utf-8');
                this.pinnedApps = JSON.parse(decoder.decode(contents));
                return;
            }
        } catch (e) {
            console.warn("[Dhruva Dock] No existing json file found or failed to read. Creating a new one.");
        }

        if (!this.pinnedApps || this.pinnedApps.length === 0) {
            this.pinnedApps = [
                'org.gnome.Nautilus.desktop',
                'org.gnome.Terminal.desktop',
                'org.gnome.Software.desktop',
                'org.gnome.Calculator.desktop',
                'org.gnome.TextEditor.desktop'
            ];
            this.savePinnedApps(this.pinnedApps);
        }
    }

    savePinnedApps(newArray = null) {
        if (newArray) this.pinnedApps = newArray;

        try {
            GLib.mkdir_with_parents(this.extConfigDir, 0o755);
            const dataStr = JSON.stringify(this.pinnedApps, null, 2);
            GLib.file_set_contents(this.dbPath, dataStr);
        } catch (e) {
            console.error("[Dhruva Dock] Error saving to json file:", e);
        }
    }

    hasApp(app) {
        if (!app) return false;
        return this.pinnedApps.includes(app.get_id());
    }

    addApp(app) {
        if (!app) return false;
        let id = app.get_id();
        
        if (!this.pinnedApps.includes(id)) {
            this.pinnedApps.push(id);
            this.savePinnedApps();
        }
        return true;
    }

    removeApp(app) {
        if (!app) return false;
        let id = app.get_id();
        
        if (this.pinnedApps.includes(id)) {
            this.pinnedApps = this.pinnedApps.filter(pinnedId => pinnedId !== id);
            this.savePinnedApps();
            return true;
        }
        return false;
    }

    getDisplayApps() {
        const runningApps = this.appSystem.get_running();
        const runningIds = new Set(runningApps.map(a => a.get_id()));

        let displayApps = [];
        let needsSave = false;

        this.pinnedApps = this.pinnedApps.filter(id => {
            let app = this.appSystem.lookup_app(id);
            if (app) {
                displayApps.push(app);
                runningIds.delete(id);
                return true;
            } else {
                needsSave = true;
                return false;
            }
        });

        if (needsSave) this.savePinnedApps();

        runningApps.forEach(app => {
            if (runningIds.has(app.get_id())) {
                const activeWins = app.get_windows().filter(w => !w.is_skip_taskbar());
                if (activeWins.length > 0) {
                    displayApps.push(app);
                }
            }
        });

        return displayApps;
    }

    destroy() {
        this.pinnedApps = [];
        this.appSystem = null;
    }
}