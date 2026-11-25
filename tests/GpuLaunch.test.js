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


import { test, assertEqual } from './lib/assert.js';
import { getAlternateLaunchGpu } from '../src/core/GpuLaunch.js';


const Shell = {
    AppState: { STOPPED: 0, STARTING: 1, RUNNING: 2 },
    AppLaunchGpu: { DEFAULT: 0, DISCRETE: 2 },
};
const dualGpu = { get_cached_property: () => ({ unpack: () => true }) };
function app({ state = Shell.AppState.STOPPED, prefersDiscrete = false, info = true } = {}) {
    return {
        get_state: () => state,
        get_app_info: () => info ? { get_boolean: key => {
            assertEqual(key, 'PrefersNonDefaultGPU');
            return prefersDiscrete;
        } } : null,
        launch() {},
    };
}

test('GPU launch: stopped app on a hybrid system offers discrete GPU', () => {
    assertEqual(getAlternateLaunchGpu(app(), dualGpu, Shell), Shell.AppLaunchGpu.DISCRETE);
});
test('GPU launch: app preferring discrete GPU offers integrated GPU (zero enum)', () => {
    assertEqual(getAlternateLaunchGpu(app({ prefersDiscrete: true }), dualGpu, Shell), Shell.AppLaunchGpu.DEFAULT);
});
test('GPU launch: service absent, missing property or single GPU hides action', () => {
    for (const proxy of [null, undefined, { get_cached_property: () => null },
        { get_cached_property: () => ({ unpack: () => false }) }])
        assertEqual(getAlternateLaunchGpu(app(), proxy, Shell), null);
});
test('GPU launch: running and starting apps do not offer a GPU relaunch', () => {
    for (const state of [Shell.AppState.STARTING, Shell.AppState.RUNNING])
        assertEqual(getAlternateLaunchGpu(app({ state }), dualGpu, Shell), null);
});
test('GPU launch: modules and apps without desktop info are excluded', () => {
    for (const candidate of [null, { is_module: true }, app({ info: false })])
        assertEqual(getAlternateLaunchGpu(candidate, dualGpu, Shell), null);
});
test('GPU launch: rechecking after app starts or service disappears cancels launch', () => {
    const candidate = app();
    assertEqual(getAlternateLaunchGpu(candidate, dualGpu, Shell), Shell.AppLaunchGpu.DISCRETE);
    candidate.get_state = () => Shell.AppState.RUNNING;
    assertEqual(getAlternateLaunchGpu(candidate, dualGpu, Shell), null);
    candidate.get_state = () => Shell.AppState.STOPPED;
    assertEqual(getAlternateLaunchGpu(candidate, null, Shell), null);
});
