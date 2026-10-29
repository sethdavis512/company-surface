import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, rasterizeSketch, sketchPng } from './sketch-png.server';
import { SKETCH_SIZE, type SketchStroke } from './surface';

const across: SketchStroke = {
    color: '#ff0000',
    size: 14,
    points: [40, 200, 600, 200],
};

function pixelAt(
    { width, pixels }: { width: number; pixels: Uint8Array },
    x: number,
    y: number,
) {
    const at = (y * width + x) * 3;
    return [pixels[at], pixels[at + 1], pixels[at + 2]];
}

describe('rasterizeSketch', () => {
    it('paints each stroke on white paper, at the paper size', () => {
        const image = rasterizeSketch([across]);
        expect(image.width).toBe(SKETCH_SIZE.width);
        expect(image.height).toBe(SKETCH_SIZE.height);
        expect(pixelAt(image, 320, 200)).toEqual([255, 0, 0]);
        expect(pixelAt(image, 320, 100)).toEqual([255, 255, 255]);
        expect(pixelAt(image, 320, 300)).toEqual([255, 255, 255]);
    });

    it('paints later strokes over earlier ones, so the eraser erases', () => {
        const eraser: SketchStroke = {
            color: '#ffffff',
            size: 14,
            points: [320, 150, 320, 250],
        };
        const image = rasterizeSketch([across, eraser]);
        expect(pixelAt(image, 320, 200)).toEqual([255, 255, 255]);
        expect(pixelAt(image, 100, 200)).toEqual([255, 0, 0]);
    });

    it('scales the picture, not just the canvas', () => {
        const image = rasterizeSketch([across], 0.5);
        expect(image.width).toBe(SKETCH_SIZE.width / 2);
        expect(pixelAt(image, 160, 100)).toEqual([255, 0, 0]);
    });
});

describe('encodePng', () => {
    it('writes a PNG whose pixels read back', () => {
        const pixels = new Uint8Array([255, 0, 0, 0, 0, 255]);
        const png = encodePng(2, 1, pixels);
        expect([...png.subarray(0, 8)]).toEqual([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        expect(png.toString('ascii', 12, 16)).toBe('IHDR');
        expect(png.readUInt32BE(16)).toBe(2);
        expect(png.readUInt32BE(20)).toBe(1);
        // IHDR's 13 bytes and CRC, then the IDAT chunk.
        const idatLength = png.readUInt32BE(33);
        expect(png.toString('ascii', 37, 41)).toBe('IDAT');
        const rows = inflateSync(png.subarray(41, 41 + idatLength));
        expect([...rows]).toEqual([0, 255, 0, 0, 0, 0, 255]);
    });

    it('makes a PNG of a whole sketch', () => {
        expect(sketchPng([across]).toString('ascii', 1, 4)).toBe('PNG');
    });
});
