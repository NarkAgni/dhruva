/*
 * Dhruva GNOME Extension
 * Copyright (C) 2026 NarkAgni
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program. If not, see https://www.gnu.org/licenses/. 
 */


import Clutter from 'gi://Clutter';


export function animateIconClick(actor, effectName) {
    if (!actor || effectName === 'none') return;

    actor.set_pivot_point(0.5, 0.5);
    actor.remove_all_transitions();

    const restore = () => {
        actor.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
            translation_x: 0,
            translation_y: 0,
            rotation_angle_z: 0,
            rotation_angle_y: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (actor && typeof actor.set_style === 'function') {
                    actor.set_style('');
                }
            }
        });
    };

    switch (effectName) {
        case 'bounce':
            actor.ease({
                scale_x: 0.7,
                scale_y: 0.7,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 1.25,
                        scale_y: 1.25,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            actor.ease({
                                scale_x: 0.9,
                                scale_y: 0.9,
                                duration: 120,
                                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        scale_x: 1.05,
                                        scale_y: 1.05,
                                        duration: 100,
                                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                        onComplete: restore
                                    });
                                }
                            });
                        }
                    });
                }
            });
            break;

        case 'jump':
            actor.ease({
                translation_y: -35,
                scale_x: 0.9,
                scale_y: 1.1,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        translation_y: 0,
                        scale_x: 1.1,
                        scale_y: 0.9,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: () => {
                            actor.ease({
                                translation_y: -15,
                                scale_x: 0.95,
                                scale_y: 1.05,
                                duration: 120,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        translation_y: 0,
                                        scale_x: 1.0,
                                        scale_y: 1.0,
                                        duration: 100,
                                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                        onComplete: restore
                                    });
                                }
                            });
                        }
                    });
                }
            });
            break;

        case 'heartbeat':
            actor.ease({
                scale_x: 1.15,
                scale_y: 1.15,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 100,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: () => {
                            actor.ease({
                                scale_x: 1.15,
                                scale_y: 1.15,
                                duration: 100,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        scale_x: 1.0,
                                        scale_y: 1.0,
                                        duration: 100,
                                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                        onComplete: restore
                                    });
                                }
                            });
                        }
                    });
                }
            });
            break;

        case 'squish':
            actor.ease({
                scale_x: 1.5,
                scale_y: 0.4,
                translation_y: 20,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 0.9,
                        scale_y: 1.1,
                        translation_y: -5,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: restore
                    });
                }
            });
            break;

        case 'jelly':
            actor.ease({
                scale_x: 1.25,
                scale_y: 0.75,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 0.75,
                        scale_y: 1.25,
                        duration: 100,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: () => {
                            actor.ease({
                                scale_x: 1.15,
                                scale_y: 0.85,
                                duration: 100,
                                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                onComplete: restore
                            });
                        }
                    });
                }
            });
            break;

        case 'spin':
            actor.rotation_angle_z = 0;
            actor.ease({
                rotation_angle_z: 360,
                scale_x: 1.15,
                scale_y: 1.15,
                duration: 450,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: restore
            });
            break;

        case 'spin_3d':
            actor.ease({
                rotation_angle_y: 180,
                scale_x: 1.15,
                scale_y: 1.15,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        rotation_angle_y: 360,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 220,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: restore
                    });
                }
            });
            break;

        case 'flip':
            actor.ease({
                scale_x: 0.0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 1.0,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: restore
                    });
                }
            });
            break;

        case 'roll':
            actor.ease({
                translation_x: 40,
                rotation_angle_z: 180,
                opacity: 150,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        translation_x: 0,
                        rotation_angle_z: 0,
                        opacity: 255,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: restore
                    });
                }
            });
            break;

        case 'zoom_fade':
            actor.ease({
                scale_x: 2.0,
                scale_y: 2.0,
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;

        case 'squeeze':
            actor.ease({
                scale_x: 0.8,
                scale_y: 1.25,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 1.1,
                        scale_y: 0.9,
                        duration: 100,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: restore
                    });
                }
            });
            break;

        case 'glow':
            if (typeof actor.set_style === 'function') {
                actor.set_style('box-shadow: 0px 0px 20px 5px rgba(255, 255, 255, 0.6); border-radius: 50%; background-color: rgba(255,255,255,0.1);');
            }
            actor.ease({
                scale_x: 1.15,
                scale_y: 1.15,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;

        case 'dim':
            actor.ease({
                opacity: 100,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;

        case 'tada':
            actor.ease({
                scale_x: 0.9,
                scale_y: 0.9,
                rotation_angle_z: -3,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        scale_x: 1.1,
                        scale_y: 1.1,
                        rotation_angle_z: 3,
                        duration: 100,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: () => {
                            actor.ease({
                                rotation_angle_z: -3,
                                duration: 100,
                                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        rotation_angle_z: 3,
                                        duration: 100,
                                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                        onComplete: restore
                                    });
                                }
                            });
                        }
                    });
                }
            });
            break;

        case 'swing':
            actor.ease({
                rotation_angle_z: 25,
                translation_x: 8,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    actor.ease({
                        rotation_angle_z: -15,
                        translation_x: -4,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: () => {
                            actor.ease({
                                rotation_angle_z: 5,
                                translation_x: 2,
                                duration: 120,
                                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        rotation_angle_z: 0,
                                        translation_x: 0,
                                        duration: 120,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                        onComplete: restore
                                    });
                                }
                            });
                        }
                    });
                }
            });
            break;

        case 'shake':
            actor.ease({
                translation_x: 10,
                duration: 50,
                mode: Clutter.AnimationMode.LINEAR,
                onComplete: () => {
                    actor.ease({
                        translation_x: -10,
                        duration: 50,
                        mode: Clutter.AnimationMode.LINEAR,
                        onComplete: () => {
                            actor.ease({
                                translation_x: 10,
                                duration: 50,
                                mode: Clutter.AnimationMode.LINEAR,
                                onComplete: () => {
                                    actor.ease({
                                        translation_x: -10,
                                        duration: 50,
                                        mode: Clutter.AnimationMode.LINEAR,
                                        onComplete: restore
                                    });
                                }
                            });
                        }
                    });
                }
            });
            break;

        case 'move_up':
            actor.ease({
                translation_y: -20,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;
        case 'move_down':
            actor.ease({
                translation_y: 20,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;
        case 'move_left':
            actor.ease({
                translation_x: -20,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;
        case 'move_right':
            actor.ease({
                translation_x: 20,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;
        case 'enlarge':
            actor.ease({
                scale_x: 1.3,
                scale_y: 1.3,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;
        case 'shrink':
            actor.ease({
                scale_x: 0.7,
                scale_y: 0.7,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;

        default:
            actor.ease({
                scale_x: 0.8,
                scale_y: 0.8,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: restore
            });
            break;
    }
}