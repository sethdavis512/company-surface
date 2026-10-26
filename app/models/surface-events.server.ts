import type { Person } from '~/lib/surface';

/**
 * Who is looking at which surface, and the nudges that tell them something
 * changed. Each open surface holds one event stream (`/api/surfaces/:id/events`)
 * that joins a room here. After anything that may have written to the store
 * (an action, an MCP call, a mock reply), `markChanged()` compares each open
 * surface's version with the last one sent and tells that room when it moved,
 * so the page reloads its data; the loader stays the source of truth.
 *
 * Rooms live in this process's memory, like the store itself: one server
 * only. More replicas would need a shared channel (Postgres LISTEN/NOTIFY).
 */

export type SurfaceEvent =
    | { type: 'changed'; version: string }
    | { type: 'presence'; people: Person[] };

type Listener = {
    person: Person;
    send: (event: SurfaceEvent) => void;
    close: () => void;
};

type Room = {
    listeners: Set<Listener>;
    /** The version last sent to this room. */
    version: string | null;
    versionOf: () => string | null;
};

type Hub = { rooms: Map<string, Room>; flushScheduled: boolean };

// Kept on globalThis, like the store, so dev reloads keep open streams.
const HUB_KEY = Symbol.for('company-surface.surface-events');
type WithHub = typeof globalThis & { [HUB_KEY]?: Hub };

function hub(): Hub {
    const scope = globalThis as WithHub;
    scope[HUB_KEY] ??= { rooms: new Map(), flushScheduled: false };
    return scope[HUB_KEY];
}

/** Everyone viewing a surface, once each, in the order they arrived. */
export function presenceOn(surfaceId: string): Person[] {
    const room = hub().rooms.get(surfaceId);
    if (!room) return [];
    const people = new Map<string, Person>();
    for (const { person } of room.listeners) {
        if (!people.has(person.id)) people.set(person.id, person);
    }
    return [...people.values()];
}

function broadcast(room: Room, event: SurfaceEvent) {
    for (const listener of room.listeners) listener.send(event);
}

function broadcastPresence(surfaceId: string) {
    const room = hub().rooms.get(surfaceId);
    if (room) {
        broadcast(room, { type: 'presence', people: presenceOn(surfaceId) });
    }
}

/**
 * Joins a surface's room: the new listener hears the current version and
 * who's here at once, and everyone else hears that they arrived. Returns
 * the way out.
 */
export function joinSurface(
    surfaceId: string,
    {
        person,
        send,
        close,
        versionOf,
    }: Listener & { versionOf: () => string | null },
): () => void {
    const { rooms } = hub();
    let room = rooms.get(surfaceId);
    if (!room) {
        room = { listeners: new Set(), version: versionOf(), versionOf };
        rooms.set(surfaceId, room);
    }
    const listener: Listener = { person, send, close };
    room.listeners.add(listener);
    if (room.version) send({ type: 'changed', version: room.version });
    broadcastPresence(surfaceId);

    return () => {
        const current = rooms.get(surfaceId);
        if (!current?.listeners.delete(listener)) return;
        if (current.listeners.size === 0) rooms.delete(surfaceId);
        else broadcastPresence(surfaceId);
    };
}

/** Sends each room whose surface's version moved the new version. */
export function flushChanges() {
    const state = hub();
    state.flushScheduled = false;
    for (const room of state.rooms.values()) {
        const version = room.versionOf();
        if (!version || version === room.version) continue;
        room.version = version;
        broadcast(room, { type: 'changed', version });
    }
}

/**
 * Something may have written to the store. Checks once the current task is
 * done, so a burst of writes (an MCP call that touches many cards) sends
 * one event per surface.
 */
export function markChanged() {
    const state = hub();
    if (state.flushScheduled) return;
    state.flushScheduled = true;
    setTimeout(flushChanges, 0);
}

/** Ends every open stream, so a shutting-down server can drain. */
export function closeAllSurfaceStreams() {
    for (const room of hub().rooms.values()) {
        for (const listener of [...room.listeners]) listener.close();
    }
    hub().rooms.clear();
}
