import { sketchPng } from '~/lib/sketch-png.server';
import type { SurfaceItem } from '~/lib/surface';
import { SurfaceError } from './surface.server';

/**
 * What a card looks like, for agents that read pictures: a sketch drawn as
 * a PNG, or an image card's own address. Other kinds have nothing to see
 * beyond their text, which `read_card` / `get_card` already give.
 */
export type CardPicture =
    { mediaType: 'image/png'; data: string } | { url: string; alt: string };

export function pictureOf(item: SurfaceItem): CardPicture {
    if (item.kind === 'sketch') {
        return {
            mediaType: 'image/png',
            data: sketchPng(item.strokes).toString('base64'),
        };
    }
    if (item.kind === 'image') return { url: item.src, alt: item.alt };
    throw new SurfaceError(
        `"${item.title}" is a ${item.kind}: only sketches and images have a picture to look at. Read it instead.`,
    );
}
