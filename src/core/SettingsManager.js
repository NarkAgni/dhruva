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


const BOOLEAN = {
    read: (settings, key) => settings.get_boolean(key),
    write: (settings, key, value) => settings.set_boolean(key, value),
    empty: () => false,
};

const INT = {
    read: (settings, key) => settings.get_int(key),
    write: (settings, key, value) => settings.set_int(key, value),
    empty: () => 0,
};

const DOUBLE = {
    read: (settings, key) => settings.get_double(key),
    write: (settings, key, value) => settings.set_double(key, value),
    empty: () => 0,
};

const STRING = {
    read: (settings, key) => settings.get_string(key),
    write: (settings, key, value) => settings.set_string(key, value),
    empty: () => '',
};

const JSON_ARRAY = {
    read: (settings, key) => {
        try {
            const parsed = JSON.parse(settings.get_string(key) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            return [];
        }
    },
    write: (settings, key, value) => settings.set_string(key, JSON.stringify(value)),
    empty: () => [],
};

const KEYS = {
    customFolders: [JSON_ARRAY, 'custom-folders'],
    appFolders: [JSON_ARRAY, 'app-folders'],
    preferredMonitor: [INT, 'preferred-monitor'],
    customGridIcon: [STRING, 'custom-grid-icon'],
    dockPosition: [STRING, 'dock-position'],
    showOnAllMonitors: [BOOLEAN, 'show-on-all-monitors'],
    isolateMonitors: [BOOLEAN, 'isolate-monitors'],
    independentDock: [BOOLEAN, 'independent-dock'],
    showIndependentInOverview: [BOOLEAN, 'show-independent-in-overview'],
    fullWidth: [BOOLEAN, 'full-width'],
    hybridPanelMode: [BOOLEAN, 'hybrid-panel-mode'],
    dynamicPanel: [BOOLEAN, 'dynamic-panel'],
    dynamicPanelLength: [INT, 'dynamic-panel-length'],
    dynamicPanelPosition: [STRING, 'dynamic-panel-position'],
    iconAlignment: [STRING, 'icon-alignment'],
    dockMargin: [INT, 'dock-margin'],
    iconSize: [INT, 'icon-size'],
    iconSpacing: [INT, 'icon-spacing'],
    dockPadding: [INT, 'dock-padding'],
    dockHeight: [INT, 'dock-height'],
    dockTheme: [STRING, 'dock-theme'],
    backgroundColor: [STRING, 'background-color'],
    useGradient: [BOOLEAN, 'use-gradient'],
    backgroundGradientColor: [STRING, 'background-gradient-color'],
    gradientDirection: [STRING, 'gradient-direction'],
    backgroundOpacity: [INT, 'background-opacity'],
    contextMenuOpacity: [INT, 'context-menu-opacity'],
    borderRadius: [INT, 'border-radius'],
    strokeWidth: [INT, 'stroke-width'],
    strokeColor: [STRING, 'stroke-color'],
    strokeOpacity: [INT, 'stroke-opacity'],
    tooltipOpacity: [INT, 'tooltip-opacity'],
    showRunningIndicators: [BOOLEAN, 'show-running-indicators'],
    indicatorStyle: [STRING, 'indicator-style'],
    indicatorColorMode: [STRING, 'indicator-color-mode'],
    indicatorColor: [STRING, 'indicator-color'],
    indicatorSize: [INT, 'indicator-size'],
    indicatorGlow: [BOOLEAN, 'indicator-glow'],
    showModuleSeparator: [BOOLEAN, 'show-module-separator'],
    showAppSeparator: [BOOLEAN, 'show-app-separator'],
    autohideAnimationSpeed: [INT, 'autohide-animation-speed'],
    windowEffectSpeed: [INT, 'window-effect-speed'],
    autohidePeek: [INT, 'autohide-peek'],
    hideMode: [STRING, 'hide-mode'],
    hideDelay: [INT, 'hide-delay'],
    unhideDelay: [INT, 'unhide-delay'],
    edgeDwellDelay: [INT, 'edge-dwell-delay'],
    fullscreenMode: [STRING, 'fullscreen-mode'],
    fullscreenRevealDelay: [INT, 'fullscreen-reveal-delay'],
    clickEffect: [STRING, 'click-effect'],
    minimizeEffect: [STRING, 'minimize-effect'],
    lockIcons: [BOOLEAN, 'lock-icons'],
    isolateWorkspaces: [BOOLEAN, 'isolate-workspaces'],
    scrollActionDock: [BOOLEAN, 'scroll-action-dock'],
    scrollActionApp: [BOOLEAN, 'scroll-action-app'],
    showUnpinnedApps: [BOOLEAN, 'show-unpinned-apps'],
    newWindowAction: [STRING, 'new-window-action'],
    enableContextMenu: [BOOLEAN, 'enable-context-menu'],
    hoverZoom: [BOOLEAN, 'hover-zoom'],
    hoverAnimation: [BOOLEAN, 'hover-animation'],
    hoverZoomFactor: [DOUBLE, 'hover-zoom-factor'],
    hoverZoomStyle: [STRING, 'hover-zoom-style'],
    hoverZoomRise: [INT, 'hover-zoom-rise'],
    hoverZoomWidth: [BOOLEAN, 'hover-zoom-width'],
    hoverZoomSmoothness: [DOUBLE, 'hover-zoom-smoothness'],
    hoverZoomRadius: [DOUBLE, 'hover-zoom-radius'],
    hoverZoomGapFactor: [DOUBLE, 'hover-zoom-gap-factor'],
    hoverZoomDominoTilt: [INT, 'hover-zoom-domino-tilt'],
    hoverZoomCylinderAngle: [INT, 'hover-zoom-cylinder-angle'],
    hoverZoomMagneticStrength: [INT, 'hover-zoom-magnetic-strength'],
    hoverZoomJellyStretch: [DOUBLE, 'hover-zoom-jelly-stretch'],
    hoverZoomJellySquish: [DOUBLE, 'hover-zoom-jelly-squish'],
    hoverZoomCoverflowAngle: [INT, 'hover-zoom-coverflow-angle'],
    showAppsPreview: [BOOLEAN, 'show-apps-preview'],
    contextMenuSize: [INT, 'context-menu-size'],
    bigPreviewSize: [INT, 'big-preview-size'],
    peekEffect: [BOOLEAN, 'peek-effect'],
    peekAnimationSpeed: [INT, 'peek-animation-speed'],
    showNotificationBadges: [BOOLEAN, 'show-notification-badges'],
    showMusicPill: [BOOLEAN, 'show-music-pill'],
    musicPillPosition: [STRING, 'music-pill-position'],
    musicPillShowPrev: [BOOLEAN, 'music-pill-show-prev'],
    musicPillShowNext: [BOOLEAN, 'music-pill-show-next'],
    musicPillProgress: [STRING, 'music-pill-progress'],
    musicPillScrollAction: [STRING, 'music-pill-scroll-action'],
    startMenu: [BOOLEAN, 'start-menu'],
    musicPillLyrics: [BOOLEAN, 'music-pill-lyrics'],
    musicPillClickAction: [STRING, 'music-pill-click-action'],
    musicPillMiddleClickAction: [STRING, 'music-pill-middle-click-action'],
    musicPillRightClickAction: [STRING, 'music-pill-right-click-action'],
    musicPillDoubleClickAction: [STRING, 'music-pill-double-click-action'],
    showTrash: [BOOLEAN, 'show-trash'],
    showDesktopButton: [BOOLEAN, 'show-desktop-button'],
    desktopBtnWidth: [INT, 'desktop-btn-width'],
    showGridButton: [BOOLEAN, 'show-grid-button'],
    gridButtonPosition: [STRING, 'grid-button-position'],
    useOldGridIcon: [BOOLEAN, 'use-old-grid-icon'],
    gridIconColor: [STRING, 'grid-icon-color'],
    customGridIconScale: [INT, 'custom-grid-icon-scale'],
    showClock: [BOOLEAN, 'show-clock'],
    use24hClock: [BOOLEAN, 'use-24h-clock'],
    clockFontSize: [INT, 'clock-font-size'],
    clockPosition: [STRING, 'clock-position'],
    showHome: [BOOLEAN, 'show-home'],
    showMounts: [BOOLEAN, 'show-mounts'],
    blurEnabled: [BOOLEAN, 'blur-enabled'],
    blurMode: [STRING, 'blur-mode'],
    blurIntensity: [DOUBLE, 'blur-intensity'],
    blurVibrancy: [DOUBLE, 'blur-vibrancy'],
    blurBrightness: [DOUBLE, 'blur-brightness'],
    blurBorderGlow: [DOUBLE, 'blur-border-glow'],
    blurHighlightAngle: [DOUBLE, 'blur-highlight-angle'],
    blurTintColor: [STRING, 'blur-tint-color'],
    blurTintOpacity: [DOUBLE, 'blur-tint-opacity'],
};

export const Settings = {
    _settings: null,

    init(settings) {
        this._settings = settings;
    },

    destroy() {
        this._settings = null;
    },
};

for (const [name, [codec, key]] of Object.entries(KEYS)) {
    Object.defineProperty(Settings, name, {
        get() {
            return this._settings ? codec.read(this._settings, key) : codec.empty();
        },
        set(value) {
            if (this._settings) codec.write(this._settings, key, value);
        },
        enumerable: true,
    });
}