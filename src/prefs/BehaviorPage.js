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
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { addComboRow, addCustomSpinRow, addSwitchRow } from './PrefsWidgets.js';


export function buildBehaviorPage(window, settings, createResetBtn) {
    const page = new Adw.PreferencesPage({
        title: _('Behavior'),
        icon_name: 'applications-engineering-symbolic'
    });
    window.add(page);

    const visGroup = new Adw.PreferencesGroup({
        title: _('Visibility Rules'),
        description: _('Configure dock auto-hide behavior and timings')
    });
    page.add(visGroup);

    addComboRow(visGroup, settings, 'hide-mode', _('Hide Mode'), _('Choose when the dock should hide'), 'go-bottom-symbolic', [
        { name: _('Intelligent (Dodge Active)'), value: 'intelligent' },
        { name: _('Dodge All Windows'), value: 'dodge-all' },
        { name: _('Dodge Maximized'), value: 'maximized' },
        { name: _('Always Hide'), value: 'always' },
        { name: _('Never Hide'), value: 'none' }
    ], null);

    const hideDelayRow = addCustomSpinRow(visGroup, settings, 'hide-delay', _('Hide Delay'), _('Milliseconds before hiding'), 'preferences-system-time-symbolic', {
        lower: 0,
        upper: 2000,
        step_increment: 50
    }, createResetBtn);

    const unhideDelayRow = addCustomSpinRow(visGroup, settings, 'unhide-delay', _('Unhide Delay'), _('Milliseconds before showing'), 'preferences-system-time-symbolic', {
        lower: 0,
        upper: 2000,
        step_increment: 50
    }, createResetBtn);

    const dwellDelayRow = addCustomSpinRow(visGroup, settings, 'edge-dwell-delay', _('Edge Pressure Delay'), _('Hold mouse at screen edge to reveal (ms)'), 'timer-symbolic', {
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
        title: _('Animations &amp; Effects')
    });
    page.add(animGroup);

    addComboRow(animGroup, settings, 'click-effect', _('Icon Click Effect'), _('Animation when an app is clicked'), 'input-mouse-symbolic', [
        { name: _('None'), value: 'none' },
        { name: _('Bounce'), value: 'bounce' },
        { name: _('Jump'), value: 'jump' },
        { name: _('Heartbeat'), value: 'heartbeat' },
        { name: _('Spin'), value: 'spin' },
        { name: _('Flip'), value: 'flip' },
        { name: _('Squeeze'), value: 'squeeze' },
        { name: _('Glow'), value: 'glow' },
        { name: _('Shake'), value: 'shake' },
        { name: _('Jelly'), value: 'jelly' },
        { name: _('Tada'), value: 'tada' },
        { name: _('Swing'), value: 'swing' },
        { name: _('Dim'), value: 'dim' },
        { name: _('Move Up'), value: 'move_up' },
        { name: _('Move Down'), value: 'move_down' },
        { name: _('Move Left'), value: 'move_left' },
        { name: _('Move Right'), value: 'move_right' },
        { name: _('Enlarge'), value: 'enlarge' },
        { name: _('Shrink'), value: 'shrink' },
        { name: _('Roll (Wheel)'), value: 'roll' },
        { name: _('Squish (Drop)'), value: 'squish' },
        { name: _('Zoom Fade (Ghost)'), value: 'zoom_fade' },
        { name: _('3D Spin (Coin)'), value: 'spin_3d' }
    ], null);

    addComboRow(animGroup, settings, 'minimize-effect', _('Window Minimize Effect'), _('Animation when minimizing or restoring'), 'window-minimize-symbolic', [
        { name: _('Magic Lamp'), value: 'magic-lamp' },
        { name: _('Snake'), value: 'snake' },
        { name: _('Vortex (Black Hole)'), value: 'crt' },
        { name: _('Origami (3D Fold)'), value: 'origami' },
        { name: _('Jelly (Squash & Stretch)'), value: 'jelly' },
        { name: _('None'), value: 'none' }
    ], null);

    const hoverGroup = new Adw.PreferencesGroup({
        title: _('Hover Zoom Physics &amp; Motion')
    });
    page.add(hoverGroup);

    addSwitchRow(hoverGroup, settings, 'hover-zoom', _('Hover Zoom'), _('Magnification effect on hover'), 'zoom-in-symbolic', null);

    const zoomStyleRow = addComboRow(hoverGroup, settings, 'hover-zoom-style', _('Zoom Motion Style'), _('Physics profile for magnification curve'), 'applications-graphics-symbolic', [
        { name: _('Fluid'), value: 'fluid' },
        { name: _('Domino'), value: 'domino' },
        { name: _('Cylinder'), value: 'cylinder' },
        { name: _('Magnetic'), value: 'magnetic' },
        { name: _('Jelly'), value: 'jelly' },
        { name: _('Coverflow'), value: 'coverflow' }
    ], null);

    const zoomFactorRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-factor', _('Zoom Factor'), _('Maximum size multiplier'), 'zoom-fit-best-symbolic', {
        lower: 1.1,
        upper: 3.0,
        step_increment: 0.1
    }, createResetBtn, 2);

    const smoothnessRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-smoothness', _('Animation Smoothness'), _('Tracking fluidity'), 'preferences-desktop-display-symbolic', {
        lower: 0.10,
        upper: 0.50,
        step_increment: 0.02
    }, createResetBtn, 2);

    const radiusRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-radius', _('Influence Spread Radius'), _('How far neighbor icons react'), 'transform-crop-and-resize-symbolic', {
        lower: 2.0,
        upper: 5.5,
        step_increment: 0.25
    }, createResetBtn, 2);

    const riseRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-rise', _('Icon Elevation (Rise)'), _('Distance icons lift towards cursor'), 'go-up-symbolic', {
        lower: 0,
        upper: 45,
        step_increment: 2
    }, createResetBtn);

    const widthExpRow = addSwitchRow(hoverGroup, settings, 'hover-zoom-width', _('Dynamic Slot Push'), _('Expand adjacent icon slots smoothly'), 'zoom-original-symbolic', null);

    const gapFactorRow = addCustomSpinRow(hoverGroup, settings, 'hover-zoom-gap-factor', _('Slot Spread Strength'), _('Push strength between adjacent icons'), 'format-justify-fill-symbolic', {
        lower: 1.0,
        upper: 3.0,
        step_increment: 0.1
    }, createResetBtn, 1);

    const effectTweakGroup = new Adw.PreferencesGroup({
        title: _('Effect Fine Tuning')
    });
    page.add(effectTweakGroup);

    const dominoTiltRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-domino-tilt', _('Domino Tilt Angle'), _('Cascade tilt angle in degrees'), 'object-rotate-right-symbolic', {
        lower: 2,
        upper: 40,
        step_increment: 1
    }, createResetBtn);

    const cylinderAngleRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-cylinder-angle', _('Cylinder Angle'), _('3D rotation arc angle'), 'view-refresh-symbolic', {
        lower: 10,
        upper: 60,
        step_increment: 2
    }, createResetBtn);

    const magneticStrengthRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-magnetic-strength', _('Magnetic Snap Distance'), _('Cursor attraction force in pixels'), 'input-mouse-symbolic', {
        lower: 2,
        upper: 30,
        step_increment: 1
    }, createResetBtn);

    const jellyStretchRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-jelly-stretch', _('Jelly Stretch Intensity'), _('How much icons pull/elongate along cursor path'), 'transform-crop-and-resize-symbolic', {
        lower: 0.10,
        upper: 1.50,
        step_increment: 0.05
    }, createResetBtn, 2);

    const jellySquishRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-jelly-squish', _('Jelly Shrink Intensity'), _('How much opposite side compresses/squashes'), 'zoom-out-symbolic', {
        lower: 0.10,
        upper: 0.90,
        step_increment: 0.05
    }, createResetBtn, 2);

    const coverflowAngleRow = addCustomSpinRow(effectTweakGroup, settings, 'hover-zoom-coverflow-angle', _('Coverflow Angle'), _('Perspective card angle in degrees'), 'view-paged-symbolic', {
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
        title: _('Interaction &amp; Previews')
    });
    page.add(previewGroup);

    addSwitchRow(previewGroup, settings, 'show-apps-preview', _('Show App Previews'), _('Display interactive window thumbnails on hover'), 'dialog-information-symbolic', null);

    addCustomSpinRow(previewGroup, settings, 'context-menu-size', _('Thumbnail Width'), _('Max width of window thumbnails'), 'image-x-generic-symbolic', {
        lower: 100,
        upper: 500,
        step_increment: 10
    }, createResetBtn);

    addCustomSpinRow(previewGroup, settings, 'big-preview-size', _('Live Preview Scale (%)'), _('Screen percentage for the big center preview'), 'view-fullscreen-symbolic', {
        lower: 40,
        upper: 95,
        step_increment: 5
    }, createResetBtn);

    const peekRow = addSwitchRow(
        previewGroup,
        settings,
        'peek-effect',
        _('Window Aero Peek'),
        _('Make other windows transparent when hovering thumbnails'),
        'view-reveal-symbolic',
        null
    );

    const peekSpeedRow = addCustomSpinRow(
        previewGroup,
        settings,
        'peek-animation-speed',
        _('Peek Animation Speed'),
        _('Higher = slower animation (ms)'),
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
        title: _('Multitasking &amp; Utilities')
    });
    page.add(utilGroup);

    addComboRow(utilGroup, settings, 'new-window-action', _('New Window Action'), _('Shortcut to open a new instance of an app'), 'window-new-symbolic', [
        { name: _('Ctrl + Left Click'), value: 'ctrl-click' },
        { name: _('Middle Mouse Click'), value: 'middle-click' },
        { name: _('Both'), value: 'both' }
    ], null);

    addSwitchRow(utilGroup, settings, 'lock-icons', _('Lock Icons'), _('Prevent drag and drop reordering'), 'system-lock-screen-symbolic', null);
    addSwitchRow(utilGroup, settings, 'show-unpinned-apps', _('Show Unpinned Apps'), _('Display running apps that are not pinned to the dock'), 'view-paged-symbolic', null);

    const qlRow = new Adw.ActionRow({
        title: _('Quick launch'),
        subtitle: _('Super + 1–9 targets the first nine dock apps (registered as keyboard shortcuts). Change under Settings → Keyboard.'),
    });
    qlRow.add_prefix(new Gtk.Image({
        icon_name: 'input-keyboard-symbolic'
    }));
    utilGroup.add(qlRow);

    addSwitchRow(utilGroup, settings, 'isolate-workspaces', _('Isolate Workspaces'), _('Only show apps running on the current workspace'), 'focus-windows-symbolic', null);
    addSwitchRow(utilGroup, settings, 'scroll-action-dock', _('Dock Scroll Action'), _('Scroll on empty dock area to switch workspaces'), 'input-mouse-symbolic', null);
    addSwitchRow(utilGroup, settings, 'scroll-action-app', _('App Scroll Action'), _('Scroll on app icons to cycle through its windows'), 'view-restore-symbolic', null);
}