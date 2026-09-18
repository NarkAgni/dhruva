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


class SettingsManager {
    constructor() {
        this._settings = null;
    }

    init(settings) {
        this._settings = settings;
    }

    get raw() {
        return this._settings;
    }

    get customFolders() {
        if (!this._settings) return [];
        const val = this._settings.get_string('custom-folders');
        return val ? JSON.parse(val) : [];
    }
    set customFolders(arr) {
        if (this._settings) {
            this._settings.set_string('custom-folders', JSON.stringify(arr));
        }
    }

    get appFolders() {
        if (!this._settings) return [];
        const val = this._settings.get_string('app-folders');
        return val ? JSON.parse(val) : [];
    }
    set appFolders(arr) {
        if (this._settings) {
            this._settings.set_string('app-folders', JSON.stringify(arr));
        }
    }

    get preferredMonitor() { return this._settings ? this._settings.get_int('preferred-monitor') : 0; }
    set preferredMonitor(val) { if (this._settings) this._settings.set_int('preferred-monitor', val); }

    get customGridIcon() { return this._settings ? this._settings.get_string('custom-grid-icon') : ''; }
    set customGridIcon(val) { if (this._settings) this._settings.set_string('custom-grid-icon', val); }

    get dockPosition() { return this._settings ? this._settings.get_string('dock-position') : 'BOTTOM'; }
    get showOnAllMonitors() { return this._settings ? this._settings.get_boolean('show-on-all-monitors') : false; }
    get isolateMonitors() { return this._settings ? this._settings.get_boolean('isolate-monitors') : false; }
    get independentDock() { return this._settings ? this._settings.get_boolean('independent-dock') : false; }
    get showIndependentInOverview() { return this._settings ? this._settings.get_boolean('show-independent-in-overview') : false; }
    get fullWidth() { return this._settings ? this._settings.get_boolean('full-width') : false; }
    get iconAlignment() { return this._settings ? this._settings.get_string('icon-alignment') : 'CENTER'; }
    get dockMargin() { return this._settings ? this._settings.get_int('dock-margin') : 0; }
    get iconSize() { return this._settings ? this._settings.get_int('icon-size') : 48; }
    get iconSpacing() { return this._settings ? this._settings.get_int('icon-spacing') : 4; }
    get dockPadding() { return this._settings ? this._settings.get_int('dock-padding') : 6; }
    get dockHeight() { return this._settings ? this._settings.get_int('dock-height') : 0; }

    get dockTheme() { return this._settings ? this._settings.get_string('dock-theme') : 'default'; }
    get backgroundColor() { return this._settings ? this._settings.get_string('background-color') : '#000000'; }
    get useGradient() { return this._settings ? this._settings.get_boolean('use-gradient') : false; }
    get backgroundGradientColor() { return this._settings ? this._settings.get_string('background-gradient-color') : '#000000'; }
    get gradientDirection() { return this._settings ? this._settings.get_string('gradient-direction') : 'vertical'; }
    get backgroundOpacity() { return this._settings ? this._settings.get_int('background-opacity') : 80; }
    get borderRadius() { return this._settings ? this._settings.get_int('border-radius') : 18; }
    get strokeWidth() { return this._settings ? this._settings.get_int('stroke-width') : 1; }
    get strokeColor() { return this._settings ? this._settings.get_string('stroke-color') : '#ffffff'; }
    get strokeOpacity() { return this._settings ? this._settings.get_int('stroke-opacity') : 20; }
    get tooltipOpacity() { return this._settings ? this._settings.get_int('tooltip-opacity') : 95; }

    get showRunningIndicators() { return this._settings ? this._settings.get_boolean('show-running-indicators') : true; }
    get indicatorStyle() { return this._settings ? this._settings.get_string('indicator-style') : 'dot'; }
    get indicatorColorMode() { return this._settings ? this._settings.get_string('indicator-color-mode') : 'dominant'; }
    get indicatorColor() { return this._settings ? this._settings.get_string('indicator-color') : '#ffffff'; }
    get indicatorSize() { return this._settings ? this._settings.get_int('indicator-size') : 4; }
    get indicatorSpacing() { return this._settings ? this._settings.get_int('indicator-spacing') : 4; }
    get indicatorGlow() { return this._settings ? this._settings.get_boolean('indicator-glow') : false; }
    get showModuleSeparator() { return this._settings ? this._settings.get_boolean('show-module-separator') : true; }
    get separatorWidth() { return this._settings ? this._settings.get_int('separator-width') : 1; }
    get separatorHeight() { return this._settings ? this._settings.get_int('separator-height') : 24; }
    get separatorColor() { return this._settings ? this._settings.get_string('separator-color') : '#ffffff'; }
    get separatorOpacity() { return this._settings ? this._settings.get_int('separator-opacity') : 30; }
    get showAppSeparator() { return this._settings ? this._settings.get_boolean('show-app-separator') : false; }
    get runningSeparatorWidth() { return this._settings ? this._settings.get_int('running-separator-width') : 1; }
    get runningSeparatorHeight() { return this._settings ? this._settings.get_int('running-separator-height') : 24; }
    get runningSeparatorColor() { return this._settings ? this._settings.get_string('running-separator-color') : '#ffffff'; }
    get runningSeparatorOpacity() { return this._settings ? this._settings.get_int('running-separator-opacity') : 30; }

    get hideMode() { return this._settings ? this._settings.get_string('hide-mode') : 'none'; }
    get hideDelay() { return this._settings ? this._settings.get_int('hide-delay') : 250; }
    get unhideDelay() { return this._settings ? this._settings.get_int('unhide-delay') : 100; }
    get edgeDwellDelay() { return this._settings ? this._settings.get_int('edge-dwell-delay') : 150; }
    get clickEffect() { return this._settings ? this._settings.get_string('click-effect') : 'bounce'; }
    get minimizeEffect() { return this._settings ? this._settings.get_string('minimize-effect') : 'magic-lamp'; }
    get lockIcons() { return this._settings ? this._settings.get_boolean('lock-icons') : false; }
    get isolateWorkspaces() { return this._settings ? this._settings.get_boolean('isolate-workspaces') : false; }
    get scrollActionDock() { return this._settings ? this._settings.get_boolean('scroll-action-dock') : true; }
    get scrollActionApp() { return this._settings ? this._settings.get_boolean('scroll-action-app') : true; }
    get showUnpinnedApps() { return this._settings ? this._settings.get_boolean('show-unpinned-apps') : true; }
    get newWindowAction() { return this._settings ? this._settings.get_string('new-window-action') : 'new'; }

    get hoverZoom() { return this._settings ? this._settings.get_boolean('hover-zoom') : false; }
    get hoverZoomFactor() { return this._settings ? this._settings.get_double('hover-zoom-factor') : 1.4; }
    get hoverZoomStyle() { return this._settings ? this._settings.get_string('hover-zoom-style') : 'default'; }
    get hoverZoomRise() { return this._settings ? this._settings.get_int('hover-zoom-rise') : 0; }
    get hoverZoomWidth() { return this._settings ? this._settings.get_boolean('hover-zoom-width') : false; }
    get hoverZoomSmoothness() { return this._settings ? this._settings.get_double('hover-zoom-smoothness') : 1.0; }
    get hoverZoomRadius() { return this._settings ? this._settings.get_double('hover-zoom-radius') : 2.0; }
    get hoverZoomGapFactor() { return this._settings ? this._settings.get_double('hover-zoom-gap-factor') : 0.0; }
    get hoverZoomDominoTilt() { return this._settings ? this._settings.get_int('hover-zoom-domino-tilt') : 15; }
    get hoverZoomCylinderAngle() { return this._settings ? this._settings.get_int('hover-zoom-cylinder-angle') : 30; }
    get hoverZoomMagneticStrength() { return this._settings ? this._settings.get_int('hover-zoom-magnetic-strength') : 5; }
    get hoverZoomJellyStretch() { return this._settings ? this._settings.get_double('hover-zoom-jelly-stretch') : 1.2; }
    get hoverZoomJellySquish() { return this._settings ? this._settings.get_double('hover-zoom-jelly-squish') : 0.8; }
    get hoverZoomCoverflowAngle() { return this._settings ? this._settings.get_int('hover-zoom-coverflow-angle') : 45; }

    get showAppsPreview() { return this._settings ? this._settings.get_boolean('show-apps-preview') : true; }
    get contextMenuSize() { return this._settings ? this._settings.get_int('context-menu-size') : 240; }
    get bigPreviewSize() { return this._settings ? this._settings.get_int('big-preview-size') : 95; }
    get peekEffect() { return this._settings ? this._settings.get_boolean('peek-effect') : true; }
    get peekAnimationSpeed() { return this._settings ? this._settings.get_int('peek-animation-speed') : 500; }
    get showNotificationBadges() { return this._settings ? this._settings.get_boolean('show-notification-badges') : true; }

    get showMusicPill() { return this._settings ? this._settings.get_boolean('show-music-pill') : false; }
    get musicPillPosition() { return this._settings ? this._settings.get_string('music-pill-position') : 'left'; }
    get showTrash() { return this._settings ? this._settings.get_boolean('show-trash') : true; }
    get showDesktopButton() { return this._settings ? this._settings.get_boolean('show-desktop-button') : false; }
    get desktopBtnWidth() { return this._settings ? this._settings.get_int('desktop-btn-width') : 12; }
    get desktopBtnOpacity() { return this._settings ? this._settings.get_int('desktop-btn-opacity') : 60; }
    get desktopBtnColor() { return this._settings ? this._settings.get_string('desktop-btn-color') : '#ffffff'; }
    get showGridButton() { return this._settings ? this._settings.get_boolean('show-grid-button') : true; }
    get gridButtonPosition() { return this._settings ? this._settings.get_string('grid-button-position') : 'START'; }
    get useOldGridIcon() { return this._settings ? this._settings.get_boolean('use-old-grid-icon') : false; }
    get gridIconColor() { return this._settings ? this._settings.get_string('grid-icon-color') : '#ffffff'; }
    get customGridIconScale() { return this._settings ? this._settings.get_int('custom-grid-icon-scale') : 100; }
    get showClock() { return this._settings ? this._settings.get_boolean('show-clock') : false; }
    get use24hClock() { return this._settings ? this._settings.get_boolean('use-24h-clock') : true; }
    get clockFontSize() { return this._settings ? this._settings.get_int('clock-font-size') : 14; }
    get clockPosition() { return this._settings ? this._settings.get_string('clock-position') : 'END'; }

    get showHome() { return this._settings ? this._settings.get_boolean('show-home') : false; }
    get showDownloads() { return this._settings ? this._settings.get_boolean('show-downloads') : false; }
    get showDocuments() { return this._settings ? this._settings.get_boolean('show-documents') : false; }
    get showPictures() { return this._settings ? this._settings.get_boolean('show-pictures') : false; }
    get showVideos() { return this._settings ? this._settings.get_boolean('show-videos') : false; }
    get showMusic() { return this._settings ? this._settings.get_boolean('show-music') : false; }
    get showMounts() { return this._settings ? this._settings.get_boolean('show-mounts') : true; }

    connect(key, callback, target = null) {
        if (!this._settings) return 0;
        const signal = key.startsWith('changed::') ? key : `changed::${key}`;
        if (target) {
            return this._settings.connectObject(signal, callback, target);
        }
        return this._settings.connect(signal, callback);
    }

    disconnectObject(target) {
        if (this._settings) {
            this._settings.disconnectObject(target);
        }
    }

    destroy() {
        this._settings = null;
    }
}

export const Settings = new SettingsManager();