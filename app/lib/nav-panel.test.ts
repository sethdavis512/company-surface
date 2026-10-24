import { describe, expect, it } from 'vitest';
import {
    DEFAULT_NAV_PANEL,
    readNavPanel,
    serializeNavPanel,
} from './nav-panel';

describe('nav panel cookie', () => {
    it('reads back what it writes', () => {
        const cookie = serializeNavPanel({ width: 300, collapsed: true });
        const header = `theme=dark; ${cookie.split(';')[0]}; other=1`;
        expect(readNavPanel(header)).toEqual({ width: 300, collapsed: true });
    });

    it('keeps saved widths within the drag limits', () => {
        expect(serializeNavPanel({ width: 9999, collapsed: false })).toMatch(
            /^surface-nav-panel=420-0;/,
        );
        expect(serializeNavPanel({ width: 12.4, collapsed: false })).toMatch(
            /^surface-nav-panel=208-0;/,
        );
    });

    it('falls back to the default for missing or odd cookies', () => {
        expect(readNavPanel(null)).toEqual(DEFAULT_NAV_PANEL);
        expect(readNavPanel('surface-nav-panel=wide')).toEqual(
            DEFAULT_NAV_PANEL,
        );
        expect(readNavPanel('surface-nav-panel=5000-1')).toEqual(
            DEFAULT_NAV_PANEL,
        );
    });
});
