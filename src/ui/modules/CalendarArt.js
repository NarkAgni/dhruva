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

// Re-dates the icon theme's own calendar artwork. Theme calendar icons bake a
// fixed date into the picture; this finds the header band and the two text
// blocks in that picture, paints each block over with the colour beside it,
// and writes today's month and day in the same place at the same size.
//
// Nothing here imports from gnome-shell, so it can be exercised under plain gjs.

import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

export const ART_SIZE = 256;

// Alpha at or above this counts as the solid card, keeping drop shadows out.
const OPAQUE = 200;
// Per-channel jump down a column that marks the header band's lower edge.
const BAND_JUMP = 60;
const MIN_BAND_FRACTION = 0.08;
const MAX_BAND_FRACTION = 0.5;
// Anything this far from its row's ground counts as lettering.
const INK_CONTRAST = 40;
// Ink at least this far from the ground counts as strong. Printed digits are
// mostly strong; a grid of pale day cells (an undated calendar) is not.
const STRONG_INK = 120;
const MIN_STRONG_RATIO = 0.5;
// Extra pixels painted over around each text block, for antialiased edges.
const WIPE_MARGIN = 3;

const MONTH_FONT = 'Sans Bold';
// The short month name (OCT) leaves room the printed full name (MARCH) used,
// so it is drawn this much taller, capped to stay inside the band.
const MONTH_SCALE = 1.2;
const MONTH_MAX_BAND_FRACTION = 0.5;
const DATE_FONT = 'Sans Semi-Bold';

function pixel(img, x, y) {
    const o = y * img.rowstride + x * img.nChannels;
    return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2],
        img.nChannels > 3 ? img.pixels[o + 3] : 255];
}

function setPixel(img, x, y, c) {
    const o = y * img.rowstride + x * img.nChannels;
    img.pixels[o] = c[0];
    img.pixels[o + 1] = c[1];
    img.pixels[o + 2] = c[2];
    if (img.nChannels > 3) img.pixels[o + 3] = c[3];
}

function distance(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function opaqueBounds(img) {
    let left = img.width, right = -1, top = img.height, bottom = -1;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (pixel(img, x, y)[3] < OPAQUE) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    return right < left ? null : { left, right, top, bottom };
}

// Bounding box of the lettering inside rows y0..y1 and columns x0..x1, where
// each row's ground colour is read from column groundX.
function inkBounds(img, x0, x1, y0, y1, groundX) {
    let box = null;
    let inkColor = null, inkDistance = 0;
    let count = 0, strong = 0;
    for (let y = y0; y <= y1; y++) {
        const ground = pixel(img, groundX, y);
        for (let x = x0; x <= x1; x++) {
            const here = pixel(img, x, y);
            if (here[3] < OPAQUE) continue;
            const d = distance(here, ground);
            if (d < INK_CONTRAST) continue;
            count++;
            if (d >= STRONG_INK) strong++;
            if (!box) box = { left: x, right: x, top: y, bottom: y };
            box.left = Math.min(box.left, x);
            box.right = Math.max(box.right, x);
            box.top = Math.min(box.top, y);
            box.bottom = Math.max(box.bottom, y);
            if (d > inkDistance) {
                inkDistance = d;
                inkColor = here;
            }
        }
    }
    return box ? { ...box, color: inkColor, strongRatio: strong / count } : null;
}

// Finds the band and both text blocks, or returns null when the icon does not
// read as a calendar card with a header band.
export function analyze(img) {
    const card = opaqueBounds(img);
    if (!card) return null;

    const cardW = card.right - card.left;
    const cardH = card.bottom - card.top + 1;
    // Left of centre, clear of the centred text and the rounded corner.
    const groundX = Math.round(card.left + cardW * 0.1);

    let bandTop = card.top;
    while (bandTop <= card.bottom && pixel(img, groundX, bandTop)[3] < OPAQUE) bandTop++;

    let bandEnd = -1;
    for (let y = bandTop + 1; y <= card.bottom; y++) {
        if (distance(pixel(img, groundX, y), pixel(img, groundX, y - 1)) > BAND_JUMP) {
            bandEnd = y;
            break;
        }
    }
    if (bandEnd < 0) return null;

    const fraction = (bandEnd - bandTop) / cardH;
    if (fraction < MIN_BAND_FRACTION || fraction > MAX_BAND_FRACTION) return null;

    const x0 = Math.round(card.left + cardW * 0.15);
    const x1 = Math.round(card.right - cardW * 0.15);
    // Skip the band's bottom rule, a few rows that would read as ink.
    const month = inkBounds(img, x0, x1, bandTop + 2, bandEnd - 4, groundX);
    const date = inkBounds(img, x0, x1, bandEnd + 4, card.bottom - 4, groundX);
    if (!month || !date) return null;
    if (date.strongRatio < MIN_STRONG_RATIO) return null;

    return { card, groundX, bandTop, bandEnd, month, date };
}

// Paints over a text block row by row with that row's ground colour, so a
// gradient band stays a gradient.
function wipe(img, box, groundX) {
    const top = Math.max(0, box.top - WIPE_MARGIN);
    const bottom = Math.min(img.height - 1, box.bottom + WIPE_MARGIN);
    const left = Math.max(0, box.left - WIPE_MARGIN);
    const right = Math.min(img.width - 1, box.right + WIPE_MARGIN);
    for (let y = top; y <= bottom; y++) {
        const ground = pixel(img, groundX, y);
        for (let x = left; x <= right; x++) setPixel(img, x, y, ground);
    }
}

function layoutFor(ctx, text, font, px) {
    const layout = PangoCairo.create_layout(ctx);
    layout.set_text(text, -1);
    layout.set_font_description(Pango.FontDescription.from_string(`${font} ${Math.max(1, Math.round(px))}`));
    PangoCairo.update_layout(ctx, layout);
    const [ink] = layout.get_pixel_extents();
    return { layout, ink };
}

// Draws text sized so a reference glyph is targetH tall, narrowed to maxW if
// needed, centred on the centre of the text it replaces. Sizing by a fixed
// glyph rather than the text's own ink keeps JUNE, whose J dips below the
// baseline, the same letter height as MAY.
function drawInto(ctx, text, font, sizeGlyph, box, targetH, maxW) {
    const PROBE = 100;
    const probe = layoutFor(ctx, sizeGlyph, font, PROBE);
    if (!probe.ink.height) return;

    let px = PROBE * (targetH / probe.ink.height);
    let fitted = layoutFor(ctx, text, font, px);
    if (fitted.ink.width > maxW) {
        px *= maxW / fitted.ink.width;
        fitted = layoutFor(ctx, text, font, px);
    }

    const cx = (box.left + box.right + 1) / 2;
    const cy = (box.top + box.bottom + 1) / 2;
    ctx.setSourceRGBA(box.color[0] / 255, box.color[1] / 255, box.color[2] / 255, 1);
    // Vertical placement also comes from the reference glyph, so a J's tail
    // hangs below the line instead of lifting the whole word.
    const ref = layoutFor(ctx, sizeGlyph, font, px).ink;
    ctx.moveTo(cx - fitted.ink.width / 2 - fitted.ink.x, cy - ref.height / 2 - ref.y);
    PangoCairo.show_layout(ctx, fitted.layout);
}

function monthName(date) {
    return date.toLocaleDateString(undefined, { month: 'short' }).replace('.', '').toUpperCase();
}

// Writes the re-dated icon to outPath. Returns false when the theme icon
// cannot be read as a calendar card, leaving outPath untouched.
export function redateThemeIcon(themeIconPath, outPath, date = new Date()) {
    let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(themeIconPath, ART_SIZE, ART_SIZE);
    if (!pixbuf.get_has_alpha()) pixbuf = pixbuf.add_alpha(false, 0, 0, 0);

    const img = {
        pixels: pixbuf.get_pixels(),
        rowstride: pixbuf.get_rowstride(),
        nChannels: pixbuf.get_n_channels(),
        width: pixbuf.get_width(),
        height: pixbuf.get_height(),
    };
    const found = analyze(img);
    if (!found) return false;

    wipe(img, found.month, found.groundX);
    wipe(img, found.date, found.groundX);

    // Cairo cannot wrap the pixel buffer directly here, so the wiped artwork
    // goes through a PNG on its way onto the canvas.
    const basePath = `${outPath}.base.png`;
    GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(img.pixels), GdkPixbuf.Colorspace.RGB,
        true, 8, img.width, img.height, img.rowstride).savev(basePath, 'png', [], []);
    const surface = Cairo.ImageSurface.createFromPNG(basePath);
    GLib.unlink(basePath);

    const ctx = new Cairo.Context(surface);
    const cardW = found.card.right - found.card.left;
    // The printed month and day are caps and digits, so their ink height is
    // the cap height and digit height to match.
    const printedCapH = found.month.bottom - found.month.top + 1;
    const monthH = Math.min(printedCapH * MONTH_SCALE,
        (found.bandEnd - found.bandTop) * MONTH_MAX_BAND_FRACTION);
    drawInto(ctx, monthName(date), MONTH_FONT, 'H', found.month, monthH, cardW * 0.8);
    drawInto(ctx, `${date.getDate()}`, DATE_FONT, '0', found.date,
        found.date.bottom - found.date.top + 1, cardW * 0.8);

    surface.writeToPNG(outPath);
    ctx.$dispose();
    return true;
}

