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


const tests = [];

export function test(name, fn) {
    tests.push({ name, fn });
}

function format(value) {
    return JSON.stringify(value);
}

export function assertEqual(actual, expected, label = '') {
    if (actual !== expected)
        throw new Error(`${label} expected ${format(expected)}, got ${format(actual)}`);
}

export function assertClose(actual, expected, label = '', epsilon = 1e-6) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > epsilon)
        throw new Error(`${label} expected ~${expected}, got ${actual}`);
}

export function assertDeepEqual(actual, expected, label = '') {
    if (format(actual) !== format(expected))
        throw new Error(`${label} expected ${format(expected)}, got ${format(actual)}`);
}

export function assertTrue(value, label = '') {
    if (value !== true) throw new Error(`${label} expected true, got ${format(value)}`);
}

export function assertFalse(value, label = '') {
    if (value !== false) throw new Error(`${label} expected false, got ${format(value)}`);
}

export function runAll() {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            fn();
            print(`  ok    ${name}`);
        } catch (e) {
            failed++;
            print(`  FAIL  ${name}\n        ${e.message}`);
        }
    }
    print(`\n${tests.length - failed} passed, ${failed} failed, ${tests.length} total`);
    return failed;
}