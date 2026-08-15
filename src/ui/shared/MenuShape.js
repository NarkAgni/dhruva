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


export function traceMenuPath(ctx, width, height, radius, arrowHeight, arrowWidth, dockPos, arrowX, arrowY) {
    arrowX = Math.max(radius + arrowWidth / 2, Math.min(arrowX, width - radius - arrowWidth / 2));
    arrowY = Math.max(radius + arrowWidth / 2, Math.min(arrowY, height - radius - arrowWidth / 2));

    ctx.newPath();

    if (dockPos === 'BOTTOM') {
        ctx.moveTo(radius, 0);
        ctx.lineTo(width - radius, 0);
        ctx.arc(width - radius, radius, radius, -Math.PI / 2, 0);
        ctx.lineTo(width, height - arrowHeight - radius);
        ctx.arc(width - radius, height - arrowHeight - radius, radius, 0, Math.PI / 2);
        ctx.lineTo(arrowX + arrowWidth / 2, height - arrowHeight);
        ctx.lineTo(arrowX + 2, height - 2);
        ctx.curveTo(arrowX, height, arrowX, height, arrowX - 2, height - 2);
        ctx.lineTo(arrowX - arrowWidth / 2, height - arrowHeight);
        ctx.lineTo(radius, height - arrowHeight);
        ctx.arc(radius, height - arrowHeight - radius, radius, Math.PI / 2, Math.PI);
        ctx.lineTo(0, radius);
        ctx.arc(radius, radius, radius, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'TOP') {
        ctx.moveTo(radius, arrowHeight);
        ctx.lineTo(arrowX - arrowWidth / 2, arrowHeight);
        ctx.lineTo(arrowX - 2, 2);
        ctx.curveTo(arrowX, 0, arrowX, 0, arrowX + 2, 2);
        ctx.lineTo(arrowX + arrowWidth / 2, arrowHeight);
        ctx.lineTo(width - radius, arrowHeight);
        ctx.arc(width - radius, arrowHeight + radius, radius, -Math.PI / 2, 0);
        ctx.lineTo(width, height - radius);
        ctx.arc(width - radius, height - radius, radius, 0, Math.PI / 2);
        ctx.lineTo(radius, height);
        ctx.arc(radius, height - radius, radius, Math.PI / 2, Math.PI);
        ctx.lineTo(0, arrowHeight + radius);
        ctx.arc(radius, arrowHeight + radius, radius, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'RIGHT') {
        ctx.moveTo(radius, 0);
        ctx.lineTo(width - arrowHeight - radius, 0);
        ctx.arc(width - arrowHeight - radius, radius, radius, -Math.PI / 2, 0);
        ctx.lineTo(width - arrowHeight, arrowY - arrowWidth / 2);
        ctx.lineTo(width - 2, arrowY - 2);
        ctx.curveTo(width, arrowY, width, arrowY, width - 2, arrowY + 2);
        ctx.lineTo(width - arrowHeight, arrowY + arrowWidth / 2);
        ctx.lineTo(width - arrowHeight, height - radius);
        ctx.arc(width - arrowHeight - radius, height - radius, radius, 0, Math.PI / 2);
        ctx.lineTo(radius, height);
        ctx.arc(radius, height - radius, radius, Math.PI / 2, Math.PI);
        ctx.lineTo(0, radius);
        ctx.arc(radius, radius, radius, Math.PI, 3 * Math.PI / 2);
    } else if (dockPos === 'LEFT') {
        ctx.moveTo(arrowHeight + radius, 0);
        ctx.lineTo(width - radius, 0);
        ctx.arc(width - radius, radius, radius, -Math.PI / 2, 0);
        ctx.lineTo(width, height - radius);
        ctx.arc(width - radius, height - radius, radius, 0, Math.PI / 2);
        ctx.lineTo(arrowHeight + radius, height);
        ctx.arc(arrowHeight + radius, height - radius, radius, Math.PI / 2, Math.PI);
        ctx.lineTo(arrowHeight, arrowY + arrowWidth / 2);
        ctx.lineTo(2, arrowY + 2);
        ctx.curveTo(0, arrowY, 0, arrowY, 2, arrowY - 2);
        ctx.lineTo(arrowHeight, arrowY - arrowWidth / 2);
        ctx.lineTo(arrowHeight, radius);
        ctx.arc(arrowHeight + radius, radius, radius, Math.PI, 3 * Math.PI / 2);
    }
    
    ctx.closePath();
}