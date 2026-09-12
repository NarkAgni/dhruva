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


import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { addComboRow, addCustomSpinRow, addSwitchRow } from './PrefsWidgets.js';


export function buildBehaviorPage(window, settings, createResetBtn) {
    const page = new Adw.PreferencesPage({
        title: 'Behavior',
        icon_name: 'applications-engineering-symbolic'
    });
    window.add(page);

    const visGroup = new Adw.PreferencesGroup({
        title: 'Visibility Rules',
        description: 'Configure dock auto-hide behavior and timings'
    });
    page.add(visGroup);

    addComboRow(visGroup, settings, 'hide-mode', 'Hide Mode', 'Choose when the dock should hide', 'go-bottom-symbolic', [
        { name: 'Intelligent (Dodge Active)', value: 'intelligent' },
        { name: 'Dodge All Windows', value: 'dodge-all' },
        { name: 'Dodge Maximized', value: 'maximized' },
        { name: 'Always Hide', value: 'always' },
        { name: 'Never Hide', value: 'none' }
    ], null);

    const hideDelayRow = addCustomSpinRow(visGroup, settings, 'hide-delay', 'Hide Delay', 'Milliseconds before hiding', 'preferences-system-time-symbolic', {
        lower: 0,
        upper: 2000,
        step_increment: 50
    }, createResetBtn);

    const unhideDelayRow = addCustomSpinRow(visGroup, settings, 'unhide-delay', 'Unhide Delay', 'Milliseconds before showing', 'preferences-system-time-symbolic', {
        lower: 0,
        upper: 2000,
        step_increment: 50
    }, createResetBtn);

    const dwellDelayRow = addCustomSpinRow(visGroup, settings, 'edge-dwell-delay', 'Edge Pressure Delay', 'Hold mouse at screen edge to reveal (ms)', 'timer-symbolic', {
        lower: 0,
        upper: 1500,
        step_increment: 50
    }, createResetBtn);

    const syncDelayVisibility = () => {
        const isNone = settings.get_string('hide-mode') === 'none';
        const showDelays = !isNone;
        hideDelayRow.set_visible(showDelays);
        unhideDelayRow.set_visible(showDelays);
        dwellDelayRow.set_visible(showDelays);
    };

    settings.connect('changed::hide-mode', syncDelayVisibility);
    syncDelayVisibility();

    const animGroup = new Adw.PreferencesGroup({
        title: 'Animations &amp; Effects'
    });
    page.add(animGroup);

    addComboRow(animGroup, settings, 'click-effect', 'Icon Click Effect', 'Animation when an app is clicked', 'input-mouse-symbolic', [
        { name: 'None', value: 'none' },
        { name: 'Bounce', value: 'bounce' },
        { name: 'Jump', value: 'jump' },
        { name: 'Heartbeat', value: 'heartbeat' },
        { name: 'Spin', value: 'spin' },
        { name: 'Flip', value: 'flip' },
        { name: 'Squeeze', value: 'squeeze' },
        { name: 'Glow', value: 'glow' },
        { name: 'Shake', value: 'shake' },
        { name: 'Jelly', value: 'jelly' },
        { name: 'Tada', value: 'tada' },
        { name: 'Swing', value: 'swing' },
        { name: 'Dim', value: 'dim' },
        { name: 'Move Up', value: 'move_up' },
        { name: 'Move Down', value: 'move_down' },
        { name: 'Move Left', value: 'move_left' },
        { name: 'Move Right', value: 'move_right' },
        { name: 'Enlarge', value: 'enlarge' },
        { name: 'Shrink', value: 'shrink' },
        { name: 'Roll (Wheel)', value: 'roll' },
        { name: 'Squish (Drop)', value: 'squish' },
        { name: 'Zoom Fade (Ghost)', value: 'zoom_fade' },
        { name: '3D Spin (Coin)', value: 'spin_3d' }
    ], null);

    addComboRow(animGroup, settings, 'minimize-effect', 'Window Minimize Effect', 'Animation when minimizing or restoring', 'window-minimize-symbolic', [
        { name: 'Magic Lamp', value: 'magic-lamp' },
        { name: 'Snake', value: 'snake' },
        { name: 'Vortex (Black Hole)', value: 'crt' },
        { name: 'Origami (3D Fold)', value: 'origami' },
        { name: 'Jelly (Squash & Stretch)', value: 'jelly' },
        { name: 'None', value: 'none' }
    ], null);

    const hoverGroup = new Adw.PreferencesGroup({
        title: 'Hover Zoom Physics &amp; Motion'
    });
    page.add(hoverGroup);

    addSwitchRow(hoverGroup, settings, 'hover-zoom', 'Hover Zoom', 'Magnification effect on hover', 'zoom-in-symbolic', null);

    const zoomStyleRow = addComboRow(hoverGroup, settings, 'hover-zoom-style', 'Zoom Motion Style', 'Physics profile for magnification curve', 'applications-graphics-symbolic', [
        { name: 'Fluid', value: 'fluid' },
        { name: 'Domino', value: 'domino' },
        { name: 'Cylinder', value: 'cylinder' },
        { name: 'Magnetic', value: 'magnetic' },
        { name: 'Jelly', value: 'jelly' },
        { name: 'Coverflow', value: 'coverflow' }
    ], null);

    const zoomFactorRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-factor', 'Zoom Factor', 'Maximum size multiplier', 'zoom-fit-best-symbolic', {
        lower: 1.1,
        upper: 3.0,
        step_increment: 0.1
    }, createResetBtn, 2);

    const smoothnessRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-smoothness', 'Animation Smoothness', 'Tracking fluidity', 'preferences-desktop-display-symbolic', {
        lower: 0.10,
        upper: 0.50,
        step_increment: 0.02
    }, createResetBtn, 2);

    const radiusRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-radius', 'Influence Spread Radius', 'How far neighbor icons react', 'transform-crop-and-resize-symbolic', {
        lower: 2.0,
        upper: 5.5,
        step_increment: 0.25
    }, createResetBtn, 2);

    const riseRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-rise', 'Icon Elevation (Rise)', 'Distance icons lift towards cursor', 'go-up-symbolic', {
        lower: 0,
        upper: 45,
        step_increment: 2
    }, createResetBtn);

    const widthExpRow = addSwitchRow(hoverGroup, settings, 'hover-zoom-width', 'Dynamic Slot Push', 'Expand adjacent icon slots smoothly', 'zoom-original-symbolic', null);

    const gapFactorRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-gap-factor', 'Slot Spread Strength', 'Push strength between adjacent icons', 'format-justify-fill-symbolic', {
        lower: 1.0,
        upper: 3.0,
        step_increment: 0.1
    }, createResetBtn, 1);

    const effectTweakGroup = new Adw.PreferencesGroup({
        title: 'Effect Fine Tuning'
    });
    page.add(effectTweakGroup);

    const dominoTiltRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-domino-tilt', 'Domino Tilt Angle', 'Cascade tilt angle in degrees', 'object-rotate-right-symbolic', {
        lower: 2,
        upper: 40,
        step_increment: 1
    }, createResetBtn);

    const cylinderAngleRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-cylinder-angle', 'Cylinder Angle', '3D rotation arc angle', 'view-refresh-symbolic', {
        lower: 10,
        upper: 60,
        step_increment: 2
    }, createResetBtn);

    const magneticStrengthRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-magnetic-strength', 'Magnetic Snap Distance', 'Cursor attraction force in pixels', 'input-mouse-symbolic', {
        lower: 2,
        upper: 30,
        step_increment: 1
    }, createResetBtn);

    const jellyStretchRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-jelly-stretch', 'Jelly Stretch Intensity', 'How much icons pull/elongate along cursor path', 'transform-crop-and-resize-symbolic', {
        lower: 0.10,
        upper: 1.50,
        step_increment: 0.05
    }, createResetBtn, 2);

    const jellySquishRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-jelly-squish', 'Jelly Shrink Intensity', 'How much opposite side compresses/squashes', 'zoom-out-symbolic', {
        lower: 0.10,
        upper: 0.90,
        step_increment: 0.05
    }, createResetBtn, 2);

    const coverflowAngleRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-coverflow-angle', 'Coverflow Angle', 'Perspective card angle in degrees', 'view-paged-symbolic', {
        lower: 15,
        upper: 65,
        step_increment: 2
    }, createResetBtn);

    const syncZoomControls = () => {
        const enabled = settings.get_boolean('hover-zoom');
        const style = settings.get_string('hover-zoom-style');
        const widthEnabled = settings.get_boolean('hover-zoom-width');

        zoomStyleRow.set_visible(enabled);
        zoomFactorRow.set_visible(enabled);
        smoothnessRow.set_visible(enabled);
        radiusRow.set_visible(enabled);
        riseRow.set_visible(enabled);
        widthExpRow.set_visible(enabled);
        gapFactorRow.set_visible(enabled && widthEnabled);

        const hasSpecificTweak = enabled && (
            style === 'domino' || style === 'cylinder' || style === 'magnetic' ||
            style === 'jelly' || style === 'coverflow'
        );
        effectTweakGroup.set_visible(hasSpecificTweak);

        dominoTiltRow.set_visible(enabled && style === 'domino');
        cylinderAngleRow.set_visible(enabled && style === 'cylinder');
        magneticStrengthRow.set_visible(enabled && style === 'magnetic');
        jellyStretchRow.set_visible(enabled && style === 'jelly');
        jellySquishRow.set_visible(enabled && style === 'jelly');
        coverflowAngleRow.set_visible(enabled && style === 'coverflow');
    };

    settings.connect('changed::hover-zoom', syncZoomControls);
    settings.connect('changed::hover-zoom-style', syncZoomControls);
    settings.connect('changed::hover-zoom-width', syncZoomControls);
    syncZoomControls();

    const previewGroup = new Adw.PreferencesGroup({
        title: 'Interaction &amp; Previews'
    });
    page.add(previewGroup);

    addSwitchRow(previewGroup, settings, 'show-apps-preview', 'Show App Previews', 'Display interactive window thumbnails on hover', 'dialog-information-symbolic', null);

    addCustomSpinRow(previewGroup, settings, 'context-menu-size', 'Thumbnail Width', 'Max width of window thumbnails', 'image-x-generic-symbolic', {
        lower: 100,
        upper: 500,
        step_increment: 10
    }, createResetBtn);

    addCustomSpinRow(previewGroup, settings, 'big-preview-size', 'Live Preview Scale (%)', 'Screen percentage for the big center preview', 'view-fullscreen-symbolic', {
        lower: 40,
        upper: 95,
        step_increment: 5
    }, createResetBtn);

    const peekRow = addSwitchRow(
        previewGroup,
        settings,
        'peek-effect',
        'Window Aero Peek',
        'Make other windows transparent when hovering thumbnails',
        'view-reveal-symbolic',
        null
    );

    const peekSpeedRow = addCustomSpinRow(
        previewGroup,
        settings,
        'peek-animation-speed',
        'Peek Animation Speed',
        'Higher = slower animation (ms)',
        'preferences-system-time-symbolic', {
        lower: 200,
        upper: 3000,
        step_increment: 50
    },
        createResetBtn
    );

    const updateSpeedSubtitle = () => {
        const val = settings.get_int('peek-animation-speed');
        peekSpeedRow.subtitle = `${val} ms`;
    };

    updateSpeedSubtitle();
    settings.connect('changed::peek-animation-speed', updateSpeedSubtitle);

    const syncPeekSpeedVisibility = () => {
        const enabled = settings.get_boolean('peek-effect');
        peekSpeedRow.set_visible(enabled);
    };

    settings.connect('changed::peek-effect', syncPeekSpeedVisibility);
    syncPeekSpeedVisibility();

    const utilGroup = new Adw.PreferencesGroup({
        title: 'Multitasking &amp; Utilities'
    });
    page.add(utilGroup);

    addComboRow(utilGroup, settings, 'new-window-action', 'New Window Action', 'Shortcut to open a new instance of an app', 'window-new-symbolic', [
        { name: 'Ctrl + Left Click', value: 'ctrl-click' },
        { name: 'Middle Mouse Click', value: 'middle-click' },
        { name: 'Both', value: 'both' }
    ], null);

    addSwitchRow(utilGroup, settings, 'lock-icons', 'Lock Icons', 'Prevent drag and drop reordering', 'system-lock-screen-symbolic', null);
    addSwitchRow(utilGroup, settings, 'show-unpinned-apps', 'Show Unpinned Apps', 'Display running apps that are not pinned to the dock', 'view-paged-symbolic', null);

    const qlRow = new Adw.ActionRow({
        title: 'Quick launch',
        subtitle: 'Super + 1–9 targets the first nine dock apps (registered as keyboard shortcuts). Change under Settings → Keyboard.',
    });
    qlRow.add_prefix(new Gtk.Image({
        icon_name: 'input-keyboard-symbolic'
    }));
    utilGroup.add(qlRow);

    addSwitchRow(utilGroup, settings, 'isolate-workspaces', 'Isolate Workspaces', 'Only show apps running on the current workspace', 'focus-windows-symbolic', null);
    addSwitchRow(utilGroup, settings, 'scroll-action-dock', 'Dock Scroll Action', 'Scroll on empty dock area to switch workspaces', 'input-mouse-symbolic', null);
    addSwitchRow(utilGroup, settings, 'scroll-action-app', 'App Scroll Action', 'Scroll on app icons to cycle through its windows', 'view-restore-symbolic', null);
}