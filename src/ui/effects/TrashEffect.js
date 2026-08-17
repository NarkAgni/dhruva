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


import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


const _activeActors = new Set();

export function cleanupTrashEffects() {
    for (const actor of _activeActors) {
        if (actor) {
            if (actor.remove_all_transitions) actor.remove_all_transitions();
            if (actor.get_parent && actor.get_parent()) {
                actor.get_parent().remove_child(actor);
            }
            actor.destroy();
        }
    }
    _activeActors.clear();
}

export function playTrashEffect(app, x, y, iconSize) {
    if (!app) return;

    const icon = app.create_icon_texture(iconSize);
    icon.set_position(x - iconSize / 2, y - iconSize / 2);
    icon.set_pivot_point(0.5, 0.5);

    Main.uiGroup.add_child(icon);
    _activeActors.add(icon);

    icon.ease({
        rotation_angle_z: -25,
        duration: 80,
        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        onComplete: () => {
            icon.ease({
                rotation_angle_z: 25,
                duration: 80,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    icon.ease({
                        rotation_angle_z: 0,
                        scale_x: 0.3,
                        scale_y: 0.3,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: () => {
                            _triggerConfettiPop(x, y, iconSize);
                            icon.ease({
                                scale_x: 2.5,
                                scale_y: 2.5,
                                opacity: 0,
                                duration: 250,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    if (_activeActors.has(icon)) {
                                        Main.uiGroup.remove_child(icon);
                                        icon.destroy();
                                        _activeActors.delete(icon);
                                    }
                                }
                            });
                        }
                    });
                }
            });
        }
    });
}

function _triggerConfettiPop(x, y, iconSize) {
    const flash = new St.Widget({
        style: 'background-color: rgba(255,255,255,0.9); border-radius: 100px; box-shadow: 0 0 20px rgba(255,255,255,0.8);'
    });
    flash.set_size(iconSize, iconSize);
    flash.set_position(x - iconSize / 2, y - iconSize / 2);
    flash.set_pivot_point(0.5, 0.5);

    Main.uiGroup.add_child(flash);
    _activeActors.add(flash);

    flash.ease({
        scale_x: 2.5,
        scale_y: 2.5,
        opacity: 0,
        duration: 300,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            if (_activeActors.has(flash)) {
                Main.uiGroup.remove_child(flash);
                flash.destroy();
                _activeActors.delete(flash);
            }
        }
    });

    const colors = ['#FF3B30', '#34C759', '#007AFF', '#FFCC00', '#FF2D55', '#AF52DE', '#5AC8FA'];
    const numConfetti = 25;

    for (let i = 0; i < numConfetti; i++) {
        const color = colors[i % colors.length];
        const size = 6 + Math.random() * 8;
        const isCircle = Math.random() > 0.5;
        const radius = isCircle ? '50px' : '2px';

        const confetti = new St.Widget({
            style: `background-color: ${color}; border-radius: ${radius};`,
        });
        confetti.set_size(size, size);
        confetti.set_position(x - size / 2, y - size / 2);
        confetti.set_pivot_point(0.5, 0.5);

        Main.uiGroup.add_child(confetti);
        _activeActors.add(confetti);

        const angle = Math.random() * Math.PI * 2;
        const distance = 80 + Math.random() * 100;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance - 40;

        confetti.ease({
            translation_x: tx,
            translation_y: ty,
            rotation_angle_z: Math.random() * 720 - 360,
            opacity: 0,
            duration: 600 + Math.random() * 400,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (_activeActors.has(confetti)) {
                    Main.uiGroup.remove_child(confetti);
                    confetti.destroy();
                    _activeActors.delete(confetti);
                }
            }
        });
    }
}