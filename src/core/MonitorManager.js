import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class MonitorManager {
    constructor(settings) {
        this.settings = settings;
    }

    getCurrentMonitor() {
        try {
            const preferredIdx = this.settings.get_int('preferred-monitor');
            const monitors = Main.layoutManager.monitors;

            if (preferredIdx >= 0 && preferredIdx < monitors.length) {
                return { monitor: monitors[preferredIdx], index: preferredIdx };
            }
        } catch (e) {
            console.error(`[Dhruva] Monitor fetch error: ${e.message}`);
        }

        return {
            monitor: Main.layoutManager.primaryMonitor,
            index: Main.layoutManager.primaryIndex,
        };
    }

    destroy() {
        this.settings = null;
    }
}