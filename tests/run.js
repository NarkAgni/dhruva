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


import System from 'system';

import { runAll } from './lib/assert.js';

import './SettingsManager.test.js';
import './LayoutMode.test.js';
import './AutoHideGeometry.test.js';
import './DockGeometryCalculator.test.js';
import './Color.test.js';


System.exit(runAll() > 0 ? 1 : 0);