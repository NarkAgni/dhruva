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


export { applyMenuThemeStyle as applyThemeStyle } from '../shared/MenuThemeStyle.js';


export function dropDelegate(source) {
    if (!source) return {};
    if (source._delegate) return source._delegate;
    if (source.button && source.button._delegate) return source.button._delegate;
    if (source.sourceActor && source.sourceActor._delegate) return source.sourceActor._delegate;
    if (source.actor && source.actor._delegate) return source.actor._delegate;
    return source;
}

export function dropButton(source) {
    const delegate = dropDelegate(source);
    return delegate.button ||
        (source && source.button) ||
        (source && source.sourceActor) ||
        (source && source.actor) ||
        (source && source.get_parent ? source : null);
}

export function dropAppId(source) {
    const delegate = dropDelegate(source);
    if (delegate.appId) return delegate.appId;
    if (delegate.app && delegate.app.get_id) return delegate.app.get_id();
    if (source && source.app && source.app.get_id) return source.app.get_id();
    return null;
}