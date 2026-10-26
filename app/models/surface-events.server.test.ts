import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '~/lib/surface';
import {
    closeAllSurfaceStreams,
    flushChanges,
    joinSurface,
    markChanged,
    presenceOn,
    type SurfaceEvent,
} from './surface-events.server';

const alice: Person = { id: 'a', name: 'Alice', initials: 'A', role: 'Member' };
const bob: Person = { id: 'b', name: 'Bob', initials: 'B', role: 'Member' };

function listener(person: Person, versionOf: () => string | null) {
    const events: SurfaceEvent[] = [];
    const close = vi.fn();
    return {
        events,
        close,
        options: {
            person,
            send: (e: SurfaceEvent) => events.push(e),
            close,
            versionOf,
        },
    };
}

afterEach(() => {
    closeAllSurfaceStreams();
    vi.useRealTimers();
});

describe('surface events', () => {
    it('tells a newcomer the version and who is here, and everyone else that they came and went', () => {
        const first = listener(alice, () => 'v1');
        const second = listener(bob, () => 'v1');
        joinSurface('s', first.options);
        const leave = joinSurface('s', second.options);

        expect(second.events).toEqual([
            { type: 'changed', version: 'v1' },
            { type: 'presence', people: [alice, bob] },
        ]);
        expect(first.events.at(-1)).toEqual({
            type: 'presence',
            people: [alice, bob],
        });

        leave();
        expect(first.events.at(-1)).toEqual({
            type: 'presence',
            people: [alice],
        });
        expect(presenceOn('s')).toEqual([alice]);
    });

    it('lists a person with two tabs open once', () => {
        joinSurface('s', listener(alice, () => 'v1').options);
        joinSurface('s', listener(alice, () => 'v1').options);
        expect(presenceOn('s')).toEqual([alice]);
    });

    it('sends a room the new version only when it moved, once per burst', async () => {
        vi.useFakeTimers();
        let version = 'v1';
        const watching = listener(alice, () => version);
        const other = listener(bob, () => 'w1');
        joinSurface('s', watching.options);
        joinSurface('t', other.options);
        const sent = () =>
            watching.events.filter((event) => event.type === 'changed');

        markChanged();
        await vi.runAllTimersAsync();
        expect(sent()).toHaveLength(1);

        version = 'v2';
        markChanged();
        markChanged();
        await vi.runAllTimersAsync();
        expect(sent()).toEqual([
            { type: 'changed', version: 'v1' },
            { type: 'changed', version: 'v2' },
        ]);
        expect(other.events.filter((e) => e.type === 'changed')).toHaveLength(
            1,
        );
    });

    it('ends every stream for shutdown', () => {
        const watching = listener(alice, () => 'v1');
        joinSurface('s', watching.options);
        closeAllSurfaceStreams();
        expect(watching.close).toHaveBeenCalledOnce();
        expect(presenceOn('s')).toEqual([]);
        flushChanges();
    });
});
