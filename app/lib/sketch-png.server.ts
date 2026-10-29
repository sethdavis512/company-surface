import { crc32, deflateSync } from 'node:zlib';
import { SKETCH_PAPER, strokeOutline } from './sketch';
import { SKETCH_SIZE, type SketchStroke } from './surface';

/**
 * A sketch as a PNG, so an agent can look at it: models read pictures, not
 * stroke coordinates. Each stroke's outline (the same one the canvas
 * fills) is filled with a scanline pass at `SUPERSAMPLE`x and averaged
 * down, which smooths the edges. Plain TypeScript and Node's zlib, so
 * nothing native has to build in the production image.
 */

/** Drawn this many times larger, then averaged down for smooth edges. */
const SUPERSAMPLE = 2;

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Fills a closed polygon (nonzero winding, like SVG's default) into an RGB
 * buffer of `width` x `height`, sampling each pixel at its center.
 */
function fillPolygon(
    pixels: Uint8Array,
    width: number,
    height: number,
    polygon: number[][],
    [r, g, b]: Rgb,
) {
    if (polygon.length < 3) return;
    const ys = polygon.map((point) => point[1]!);
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(...ys)));
    const crossings: { x: number; winding: number }[] = [];

    for (let y = top; y <= bottom; y++) {
        const sampleY = y + 0.5;
        crossings.length = 0;
        for (let i = 0; i < polygon.length; i++) {
            const [x1, y1] = polygon[i]!;
            const [x2, y2] = polygon[(i + 1) % polygon.length]!;
            if (y1 === y2) continue;
            const upward = y1! < y2!;
            const low = upward ? y1! : y2!;
            const high = upward ? y2! : y1!;
            if (sampleY < low || sampleY >= high) continue;
            const t = (sampleY - y1!) / (y2! - y1!);
            crossings.push({
                x: x1! + t * (x2! - x1!),
                winding: upward ? 1 : -1,
            });
        }
        crossings.sort((a, b) => a.x - b.x);
        let winding = 0;
        for (let i = 0; i < crossings.length - 1; i++) {
            winding += crossings[i]!.winding;
            if (winding === 0) continue;
            const from = Math.max(0, Math.ceil(crossings[i]!.x - 0.5));
            const to = Math.min(
                width - 1,
                Math.floor(crossings[i + 1]!.x - 0.5),
            );
            for (let x = from; x <= to; x++) {
                const at = (y * width + x) * 3;
                pixels[at] = r;
                pixels[at + 1] = g;
                pixels[at + 2] = b;
            }
        }
    }
}

/**
 * A sketch's pixels, RGB, `SKETCH_SIZE` at `scale`: white paper with each
 * stroke painted in order (the eraser is white ink, so it paints over).
 */
export function rasterizeSketch(
    strokes: readonly SketchStroke[],
    scale = 1,
): { width: number; height: number; pixels: Uint8Array } {
    const width = Math.round(SKETCH_SIZE.width * scale);
    const height = Math.round(SKETCH_SIZE.height * scale);
    const big = scale * SUPERSAMPLE;
    const bigWidth = width * SUPERSAMPLE;
    const bigHeight = height * SUPERSAMPLE;
    const canvas = new Uint8Array(bigWidth * bigHeight * 3);
    const [pr, pg, pb] = rgbOf(SKETCH_PAPER);
    for (let at = 0; at < canvas.length; at += 3) {
        canvas[at] = pr;
        canvas[at + 1] = pg;
        canvas[at + 2] = pb;
    }
    for (const stroke of strokes) {
        const outline = strokeOutline(stroke).map(([x, y]) => [
            x! * big,
            y! * big,
        ]);
        fillPolygon(canvas, bigWidth, bigHeight, outline, rgbOf(stroke.color));
    }

    const pixels = new Uint8Array(width * height * 3);
    const samples = SUPERSAMPLE * SUPERSAMPLE;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 3; channel++) {
                let sum = 0;
                for (let dy = 0; dy < SUPERSAMPLE; dy++) {
                    for (let dx = 0; dx < SUPERSAMPLE; dx++) {
                        const bx = x * SUPERSAMPLE + dx;
                        const by = y * SUPERSAMPLE + dy;
                        sum += canvas[(by * bigWidth + bx) * 3 + channel]!;
                    }
                }
                pixels[(y * width + x) * 3 + channel] = Math.round(
                    sum / samples,
                );
            }
        }
    }
    return { width, height, pixels };
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** RGB pixels as a PNG file. */
export function encodePng(
    width: number,
    height: number,
    pixels: Uint8Array,
): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bits per channel
    header[9] = 2; // RGB
    // Each row starts with filter type 0 (none).
    const rows = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        Buffer.from(
            pixels.buffer,
            pixels.byteOffset + y * width * 3,
            width * 3,
        ).copy(rows, y * (width * 3 + 1) + 1);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** A sketch as a PNG at `SKETCH_SIZE` (times `scale`). */
export function sketchPng(strokes: readonly SketchStroke[], scale = 1) {
    const { width, height, pixels } = rasterizeSketch(strokes, scale);
    return encodePng(width, height, pixels);
}
