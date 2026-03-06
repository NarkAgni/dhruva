export default class DockManager {
    constructor(dockUI, settings) {
        this.dockUI = dockUI;
        this.settings = settings;
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
            const { monitor } = monitorResult;
            const margin = this.settings.get_int('dock-margin');
            const pos = this.settings.get_string('dock-position');
            const isFullWidth = this.settings.get_boolean('full-width');

            let xPos = 0, yPos = 0;
            const aw = this.dockUI.actor.width;
            const ah = this.dockUI.actor.height;

            if (pos === 'TOP') {
                xPos = isFullWidth ? monitor.x : monitor.x + (monitor.width - aw) / 2;
                yPos = monitor.y + margin;
            } else if (pos === 'BOTTOM') {
                xPos = isFullWidth ? monitor.x : monitor.x + (monitor.width - aw) / 2;
                yPos = monitor.y + monitor.height - ah - margin;
            } else if (pos === 'LEFT') {
                xPos = monitor.x + margin;
                yPos = isFullWidth ? monitor.y : monitor.y + (monitor.height - ah) / 2;
            } else if (pos === 'RIGHT') {
                xPos = monitor.x + monitor.width - aw - margin;
                yPos = isFullWidth ? monitor.y : monitor.y + (monitor.height - ah) / 2;
            }

            this.dockUI.actor.set_position(xPos, yPos);

            if (this.dockUI.autoHideManager) {
                this.dockUI.autoHideManager.isVisible = true;
                this.dockUI.autoHideManager.isAnimating = false;
            }
        } catch (e) {
        }
    }

    destroy() {
        this.dockUI = null;
        this.settings = null;
    }
}