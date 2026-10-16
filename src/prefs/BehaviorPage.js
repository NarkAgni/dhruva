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
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { onSettingChanged } from './SettingsSignals.js';
import {
    fmt, addGroup, addGroupReset, showWhen, addSwitchRow, addSliderRow, addComboRow,
} from './PrefsWidgets.js';


const HIDE_TIMING_KEYS = ['hide-delay', 'unhide-delay', 'edge-dwell-delay', 'autohide-animation-speed'];
const ZOOM_KEYS = ['hover-zoom-factor', 'hover-zoom-smoothness', 'hover-zoom-radius', 'hover-zoom-rise', 'hover-zoom-gap-factor'];
const TWEAK_KEYS = [
    'hover-zoom-domino-tilt', 'hover-zoom-cylinder-angle', 'hover-zoom-magnetic-strength',
    'hover-zoom-jelly-stretch', 'hover-zoom-jelly-squish', 'hover-zoom-coverflow-angle',
];

const HIDE_MODES = () => [
    { name: _('Smart'), value: 'intelligent', hint: _('Hides when the active window touches the dock') },
    { name: _('Dodge Windows'), value: 'dodge-all', hint: _('Hides when any window touches the dock') },
    { name: _('Maximized'), value: 'maximized', hint: _('Hides when a window is maximized') },
    { name: _('Always'), value: 'always', hint: _('Stays hidden until you reach the screen edge') },
    { name: _('Never'), value: 'none', hint: _('The dock is always visible') },
];

const CLICK_EFFECTS = () => [
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
    { name: _('3D Spin (Coin)'), value: 'spin_3d' },
];


export function buildBehaviorPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Behavior'),
        icon_name: 'applications-engineering-symbolic',
    });

    const hideGroup = addGroup(page, _('Auto-Hide'), _('When the dock steps out of the way'));
    const hideRow = addComboRow(hideGroup, settings, 'hide-mode', _('Hide'), null, HIDE_MODES());
    const syncHideHint = () => {
        const mode = HIDE_MODES().find(m => m.value === settings.get_string('hide-mode'));
        hideRow.subtitle = mode ? mode.hint : '';
    };
    syncHideHint();
    onSettingChanged(settings, 'hide-mode', syncHideHint);

    const timingGroup = addGroup(page, _('Auto-Hide Timing'));
    addGroupReset(timingGroup, settings, HIDE_TIMING_KEYS);
    addSliderRow(timingGroup, settings, 'hide-delay', _('Hide After'), null, { lower: 0, upper: 2000, step: 50 }, fmt.ms);
    addSliderRow(timingGroup, settings, 'unhide-delay', _('Show After'), null, { lower: 0, upper: 2000, step: 50 }, fmt.ms);
    addSliderRow(timingGroup, settings, 'edge-dwell-delay', _('Edge Push'), _('How long to rest the pointer at the edge'),
        { lower: 0, upper: 1500, step: 50 }, fmt.ms);
    addSliderRow(timingGroup, settings, 'autohide-animation-speed', _('Slide Duration'), null,
        { lower: 50, upper: 1000, step: 25 }, fmt.ms);
    showWhen(timingGroup, settings, ['hide-mode'], () => settings.get_string('hide-mode') !== 'none');

    const animGroup = addGroup(page, _('Animations'));
    addComboRow(animGroup, settings, 'click-effect', _('On Click'), _('How an icon reacts when clicked'), CLICK_EFFECTS());
    addComboRow(animGroup, settings, 'minimize-effect', _('Minimize'), _('How windows fly into the dock'), [
        { name: _('Magic Lamp'), value: 'magic-lamp' },
        { name: _('Snake'), value: 'snake' },
        { name: _('Vortex (Black Hole)'), value: 'crt' },
        { name: _('Origami (3D Fold)'), value: 'origami' },
        { name: _('Jelly (Squash & Stretch)'), value: 'jelly' },
        { name: _('None'), value: 'none' },
    ]);
    const minimizeSpeedRow = addSliderRow(animGroup, settings, 'window-effect-speed', _('Minimize Duration'), null,
        { lower: 100, upper: 1500, step: 25 }, fmt.ms);
    showWhen(minimizeSpeedRow, settings, ['minimize-effect'], () => settings.get_string('minimize-effect') !== 'none');
    const highlightRow = addSwitchRow(animGroup, settings, 'hover-animation', _('Hover Animation'),
        _('Animate the icon background under the pointer'));
    showWhen(highlightRow, settings, ['hover-zoom', 'hybrid-panel-mode'],
        () => !settings.get_boolean('hover-zoom') || settings.get_boolean('hybrid-panel-mode'));

    const isPanel = () => settings.get_boolean('hybrid-panel-mode');
    const isZoom = () => settings.get_boolean('hover-zoom') && !isPanel();
    const zoomStyle = () => settings.get_string('hover-zoom-style');

    const zoomGroup = addGroup(page, _('Hover Zoom'), _('Icons grow as the pointer passes over them'));
    addSwitchRow(zoomGroup, settings, 'hover-zoom', _('Magnify on Hover'));
    addGroupReset(zoomGroup, settings, ['hover-zoom-style', ...ZOOM_KEYS]);

    const zoomRows = [
        addComboRow(zoomGroup, settings, 'hover-zoom-style', _('Motion'), _('The shape of the wave'), [
            { name: _('Fluid'), value: 'fluid' },
            { name: _('Domino'), value: 'domino' },
            { name: _('Cylinder'), value: 'cylinder' },
            { name: _('Magnetic'), value: 'magnetic' },
            { name: _('Jelly'), value: 'jelly' },
            { name: _('Coverflow'), value: 'coverflow' },
        ]),
        addSliderRow(zoomGroup, settings, 'hover-zoom-factor', _('Zoom'), _('Largest size an icon reaches'),
            { lower: 1.1, upper: 3, step: 0.1 }, fmt.times),
        addSliderRow(zoomGroup, settings, 'hover-zoom-smoothness', _('Smoothness'), _('How softly icons follow the pointer'),
            { lower: 0.1, upper: 0.5, step: 0.02 }, value => value.toFixed(2)),
        addSliderRow(zoomGroup, settings, 'hover-zoom-radius', _('Spread'), _('How many neighbours react'),
            { lower: 2, upper: 5.5, step: 0.25 }, value => value.toFixed(2)),
        addSliderRow(zoomGroup, settings, 'hover-zoom-rise', _('Lift'), _('How far icons rise towards the pointer'),
            { lower: 0, upper: 45, step: 2 }, fmt.px),
        addSwitchRow(zoomGroup, settings, 'hover-zoom-width', _('Make Room'), _('Neighbours slide apart for the zoomed icon')),
    ];
    for (const row of zoomRows) showWhen(row, settings, ['hover-zoom', 'hybrid-panel-mode'], isZoom);

    const gapRow = addSliderRow(zoomGroup, settings, 'hover-zoom-gap-factor', _('Push Strength'), null,
        { lower: 1, upper: 3, step: 0.1 }, fmt.times);
    showWhen(gapRow, settings, ['hover-zoom', 'hybrid-panel-mode', 'hover-zoom-width'],
        () => isZoom() && settings.get_boolean('hover-zoom-width'));
    showWhen(zoomGroup, settings, ['hybrid-panel-mode'], () => !isPanel());

    const tweakGroup = addGroup(page, _('Motion Details'));
    addGroupReset(tweakGroup, settings, TWEAK_KEYS);
    const tweaks = [
        ['domino', addSliderRow(tweakGroup, settings, 'hover-zoom-domino-tilt', _('Tilt'), null, { lower: 2, upper: 40, step: 1 }, fmt.deg)],
        ['cylinder', addSliderRow(tweakGroup, settings, 'hover-zoom-cylinder-angle', _('Curve'), null, { lower: 10, upper: 60, step: 2 }, fmt.deg)],
        ['magnetic', addSliderRow(tweakGroup, settings, 'hover-zoom-magnetic-strength', _('Pull'), _('How strongly icons snap to the pointer'),
            { lower: 2, upper: 30, step: 1 }, fmt.px)],
        ['jelly', addSliderRow(tweakGroup, settings, 'hover-zoom-jelly-stretch', _('Stretch'), null, { lower: 0.1, upper: 1.5, step: 0.05 }, fmt.fraction)],
        ['jelly', addSliderRow(tweakGroup, settings, 'hover-zoom-jelly-squish', _('Squash'), null, { lower: 0.1, upper: 0.9, step: 0.05 }, fmt.fraction)],
        ['coverflow', addSliderRow(tweakGroup, settings, 'hover-zoom-coverflow-angle', _('Card Angle'), null, { lower: 15, upper: 65, step: 2 }, fmt.deg)],
    ];
    const zoomKeys = ['hover-zoom', 'hybrid-panel-mode', 'hover-zoom-style'];
    for (const [style, row] of tweaks) showWhen(row, settings, zoomKeys, () => isZoom() && zoomStyle() === style);
    showWhen(tweakGroup, settings, zoomKeys, () => isZoom() && tweaks.some(([style]) => style === zoomStyle()));

    const previewGroup = addGroup(page, _('Window Previews'));
    addSwitchRow(previewGroup, settings, 'show-apps-preview', _('Preview on Hover'), _('Window thumbnails above the icon'));
    addSliderRow(previewGroup, settings, 'context-menu-size', _('Thumbnail Width'), null, { lower: 100, upper: 500, step: 10 }, fmt.px);
    addSliderRow(previewGroup, settings, 'big-preview-size', _('Large Preview'), _('Share of the screen for the big preview'),
        { lower: 40, upper: 95, step: 5 }, fmt.percent);
    addSwitchRow(previewGroup, settings, 'peek-effect', _('Peek'), _('Fade other windows while hovering a thumbnail'));
    const peekSpeedRow = addSliderRow(previewGroup, settings, 'peek-animation-speed', _('Peek Fade'), null,
        { lower: 200, upper: 3000, step: 50 }, fmt.ms);
    showWhen(peekSpeedRow, settings, ['peek-effect'], () => settings.get_boolean('peek-effect'));

    const utilGroup = addGroup(page, _('Mouse &amp; Keyboard'));
    addComboRow(utilGroup, settings, 'new-window-action', _('New Window'), _('Open another window of an app'), [
        { name: _('Ctrl + Click'), value: 'ctrl-click' },
        { name: _('Middle Click'), value: 'middle-click' },
        { name: _('Both'), value: 'both' },
    ]);
    addSwitchRow(utilGroup, settings, 'scroll-action-dock', _('Scroll on Dock'), _('Switch workspaces'));
    addSwitchRow(utilGroup, settings, 'scroll-action-app', _('Scroll on Icon'), _('Cycle through that app’s windows'));
    utilGroup.add(new Adw.ActionRow({
        title: _('Quick Launch'),
        subtitle: _('Super + 1–9 opens the first nine dock apps. Change it in Settings → Keyboard'),
    }));

    const appsGroup = addGroup(page, _('Apps on the Dock'));
    addSwitchRow(appsGroup, settings, 'show-unpinned-apps', _('Running Apps'), _('Also show open apps that are not pinned'));
    addSwitchRow(appsGroup, settings, 'isolate-workspaces', _('This Workspace Only'), _('Show only apps open on the current workspace'));
    addSwitchRow(appsGroup, settings, 'lock-icons', _('Lock Order'), _('Stop icons from being dragged around'));

    window.add(page);
}