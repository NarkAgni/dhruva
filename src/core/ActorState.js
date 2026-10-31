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


import GObject from 'gi://GObject';


let disposedActors = null;

function getDisposedActors() {
    if (!disposedActors) disposedActors = new WeakSet();
    return disposedActors;
}

export function resetDisposedActors() {
    disposedActors = null;
}

export function markActorDisposed(actor) {
    if (actor) getDisposedActors().add(actor);
}

export function isActorAlive(actor) {
    const disposed = getDisposedActors();
    if (!actor || disposed.has(actor)) return false;

    const str = GObject.Object.prototype.toString.call(actor);
    if (!str || str.includes('DISPOSED') || str.includes('finalized') || str.includes('disposed')) {
        disposed.add(actor);
        return false;
    }

    if (!actor.get_stage) {
        disposed.add(actor);
        return false;
    }

    return true;
}