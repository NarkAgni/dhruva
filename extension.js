import DockUI from './src/ui/DockUI.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class DhruvaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._dockUI = new DockUI(
            this._settings, 
            () => this.openPreferences(), 
            this.uuid
        );
        this._dockUI.show();
    }

    disable() {
        if (this._dockUI) {
            this._dockUI.destroy();
            this._dockUI = null;
        }
        this._settings = null;
    }
}