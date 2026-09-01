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
        title: 'Interaction &amp; Previews'
    });
    page.add(hoverGroup);

    addSwitchRow(hoverGroup, settings, 'hover-zoom', 'Hover Zoom', 'Magnification effect on hover', 'zoom-in-symbolic', null);
    const zoomFactorRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-factor', 'Zoom Factor', 'Maximum multiplier', 'zoom-fit-best-symbolic', {
        lower: 1.1,
        upper: 3.0,
        step_increment: 0.1
    }, createResetBtn, 2);

    const syncZoomFactor = () => zoomFactorRow.set_visible(settings.get_boolean('hover-zoom'));
    settings.connect('changed::hover-zoom', syncZoomFactor);
    syncZoomFactor();

    addSwitchRow(hoverGroup, settings, 'show-apps-preview', 'Show App Previews', 'Display interactive window thumbnails on hover', 'dialog-information-symbolic', null);

    addCustomSpinRow(hoverGroup, settings, 'context-menu-size', 'Thumbnail Width', 'Max width of window thumbnails', 'image-x-generic-symbolic', {
        lower: 100,
        upper: 500,
        step_increment: 10
    }, createResetBtn);
    addCustomSpinRow(hoverGroup, settings, 'big-preview-size', 'Live Preview Scale (%)', 'Screen percentage for the big center preview', 'view-fullscreen-symbolic', {
        lower: 40,
        upper: 95,
        step_increment: 5
    }, createResetBtn);

    const peekRow = addSwitchRow(
        hoverGroup,
        settings,
        'peek-effect',
        'Window Aero Peek',
        'Make other windows transparent when hovering thumbnails',
        'view-reveal-symbolic',
        null
    );

    const peekSpeedRow = addCustomSpinRow(
        hoverGroup,
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
        subtitle: 'Super + 1–9 targets the first nine dock apps (registered as keyboard shortcuts). Change under Settings → Keyboard. If Super + number still runs “Switch to application”, disable that binding in system shortcuts so Dhruva can own it.',
    });
    qlRow.add_prefix(new Gtk.Image({
        icon_name: 'input-keyboard-symbolic'
    }));
    utilGroup.add(qlRow);

    addSwitchRow(utilGroup, settings, 'isolate-workspaces', 'Isolate Workspaces', 'Only show apps running on the current workspace', 'focus-windows-symbolic', null);

    addSwitchRow(utilGroup, settings, 'scroll-action-dock', 'Dock Scroll Action', 'Scroll on empty dock area to switch workspaces', 'input-mouse-symbolic', null);
    addSwitchRow(utilGroup, settings, 'scroll-action-app', 'App Scroll Action', 'Scroll on app icons to cycle through its windows', 'view-restore-symbolic', null);
}