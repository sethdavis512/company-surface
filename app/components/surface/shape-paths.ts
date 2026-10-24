import type { ShapeType } from '~/lib/surface';

/**
 * Each shape's outline in a 100x100 box, stretched to the card
 * (`preserveAspectRatio="none"`, with a non-scaling stroke). `rim` is drawn
 * on top, unfilled: the cylinder's front lip.
 */
export const SHAPE_PATHS: Record<ShapeType, { body: string; rim?: string }> = {
    rectangle: { body: 'M0 0H100V100H0Z' },
    rounded: {
        body: 'M14 0H86Q100 0 100 14V86Q100 100 86 100H14Q0 100 0 86V14Q0 0 14 0Z',
    },
    circle: { body: 'M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z' },
    diamond: { body: 'M50 0L100 50L50 100L0 50Z' },
    hexagon: { body: 'M25 0H75L100 50L75 100H25L0 50Z' },
    triangle: { body: 'M50 0L100 100H0Z' },
    parallelogram: { body: 'M22 0H100L78 100H0Z' },
    cylinder: {
        body: 'M0 12A50 12 0 0 1 100 12V88A50 12 0 0 1 0 88Z',
        rim: 'M0 12A50 12 0 0 0 100 12',
    },
    arrow: { body: 'M0 0H72L100 50L72 100H0Z' },
    plus: { body: 'M33 0H67V33H100V67H67V100H33V67H0V33H33Z' },
};

/** Room for the label inside each outline, so text stays within it. */
export const SHAPE_LABEL_INSET: Record<ShapeType, string> = {
    rectangle: 'p-3',
    rounded: 'p-3',
    circle: 'px-[16%] py-[14%]',
    diamond: 'px-[24%] py-[20%]',
    hexagon: 'px-[18%] py-2',
    triangle: 'px-[26%] pt-[38%] pb-2',
    parallelogram: 'px-[24%] py-2',
    cylinder: 'px-3 pt-[22%] pb-2',
    arrow: 'ps-3 pe-[26%] py-2',
    plus: 'px-[33%] py-[33%]',
};
