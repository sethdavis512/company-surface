import MiniSearch from 'minisearch';
import { cellText, type DocumentBlock } from './portable-text';
import type { SurfaceItem, SurfaceItemKind } from './surface';

/**
 * Search across the surface, the same in the browser (the ⌘K palette and
 * the filter bar, over the loader's items) and on the server (the MCP
 * `search` tool, over the store). Every item is one entry (its title and
 * its text), and every chat message and board issue is an entry of its
 * own, so a hit can point inside a window. MiniSearch matches word
 * prefixes and small typos, title words count most, and every word of the
 * query has to match somewhere in the entry.
 */

export type SearchHit = {
    itemId: string;
    kind: SurfaceItemKind;
    /** The item's title. */
    title: string;
    /** A message or issue inside the item, when that's where it matched. */
    subId?: string;
    /** Who sent the message, or the issue's identifier. */
    subLabel?: string;
    /** The matching text around the first match (or the start). */
    snippet: string;
    /** Where the matched words sit in `snippet`, [start, end). */
    ranges: [number, number][];
    score: number;
};

export type SurfaceSearchResult = {
    /** Best hit per item, best first, at most `limit`. */
    hits: SearchHit[];
    /** Every item with any hit: the filter bar dims the rest. */
    itemIds: Set<string>;
};

type Entry = {
    id: string;
    itemId: string;
    kind: SurfaceItemKind;
    itemTitle: string;
    subId?: string;
    subLabel?: string;
    title: string;
    text: string;
};

type Options = {
    /** A person's name by id, for message hits. */
    nameOf?: (personId: string) => string | undefined;
};

export const SEARCH_LIMIT = 20;

/**
 * Words, with hyphenated ones kept whole as well as split ("ATL-1" gives
 * "ATL-1", "ATL", and "1"), so an exact identifier outranks ATL-10 while
 * "fast follow" still finds "fast-follow".
 */
function tokenize(text: string): string[] {
    return [...text.matchAll(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu)].flatMap(
        ([word]) => (word.includes('-') ? [word, ...word.split('-')] : [word]),
    );
}
const SNIPPET_LENGTH = 120;

function blocksText(blocks: DocumentBlock[]): string {
    return blocks
        .flatMap((block) => {
            if (block._type === 'block') {
                return [block.children.map((span) => span.text).join('')];
            }
            if (block._type === 'table') {
                return block.rows.flatMap((row) => row.cells.map(cellText));
            }
            return [];
        })
        .join(' ');
}

/** The words a UI card shows of its own (headings, labels), for search. */
function uiText(spec: { elements: Record<string, unknown> }): string {
    return Object.values(spec.elements)
        .flatMap((element) =>
            Object.values(
                (element as { props?: Record<string, unknown> }).props ?? {},
            ).filter((value): value is string => typeof value === 'string'),
        )
        .join(' ');
}

/** The entries an item contributes: itself, plus its messages or issues. */
function entriesOf(item: SurfaceItem, { nameOf }: Options): Entry[] {
    const base = {
        itemId: item.id,
        kind: item.kind,
        itemTitle: item.title,
    };
    const own = (text: string): Entry => ({
        ...base,
        id: item.id,
        title: item.title,
        text,
    });
    switch (item.kind) {
        case 'chat':
            return [
                own(''),
                ...item.messages.map((message) => ({
                    ...base,
                    id: `${item.id}:${message.id}`,
                    subId: message.id,
                    subLabel: nameOf?.(message.authorId),
                    title: '',
                    text: message.text,
                })),
            ];
        case 'document':
            return [own(blocksText(item.blocks))];
        case 'board':
            return [
                own(item.key),
                ...item.issues.map((issue) => ({
                    ...base,
                    id: `${item.id}:${issue.id}`,
                    subId: issue.id,
                    subLabel: issue.identifier,
                    title: issue.identifier,
                    text: issue.title,
                })),
            ];
        case 'pull-request':
            return [
                own(
                    `#${item.number} ${item.summary} ${item.branch} ${item.repo}`,
                ),
            ];
        case 'chart':
            return [own(item.caption)];
        case 'video':
            return [own('')];
        case 'web':
            return [own(item.url)];
        case 'image':
            return [own(item.alt)];
        case 'note':
            return [own(item.text)];
        case 'sketch':
            return [own('')];
        case 'ui':
            return [own(uiText(item.spec))];
    }
}

/** The stretch of `text` around its first matched word, with its matches. */
function snippetOf(
    text: string,
    terms: string[],
): Pick<SearchHit, 'snippet' | 'ranges'> {
    const words = [...text.matchAll(/[\p{L}\p{N}#]+/gu)];
    const matched = words.filter((word) =>
        terms.some((term) => word[0].toLowerCase().startsWith(term)),
    );
    const first = matched[0]?.index ?? 0;
    // Start a little before the first match, at a word boundary.
    let start = Math.max(0, first - 30);
    if (start > 0) {
        const space = text.indexOf(' ', start);
        start = space === -1 || space > first ? start : space + 1;
    }
    const end = Math.min(text.length, start + SNIPPET_LENGTH);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    const ranges = matched
        .filter((word) => word.index! >= start && word.index! < end)
        .map((word): [number, number] => {
            const at = word.index! - start + prefix.length;
            return [
                at,
                Math.min(at + word[0].length, prefix.length + end - start),
            ];
        });
    return { snippet: `${prefix}${text.slice(start, end)}${suffix}`, ranges };
}

/**
 * An index over these items. Build it once per set of items (it's cheap
 * for a surface's worth) and search it as the query changes.
 */
export function createSurfaceSearch(
    items: SurfaceItem[],
    options: Options = {},
) {
    const index = new MiniSearch<Entry>({
        fields: ['title', 'text'],
        tokenize,
        storeFields: [
            'itemId',
            'kind',
            'itemTitle',
            'subId',
            'subLabel',
            'title',
            'text',
        ],
        searchOptions: {
            boost: { title: 3 },
            prefix: true,
            fuzzy: (term) => (term.length > 4 ? 0.2 : false),
            combineWith: 'AND',
        },
    });
    index.addAll(items.flatMap((item) => entriesOf(item, options)));

    return {
        search(query: string, limit = SEARCH_LIMIT): SurfaceSearchResult {
            if (!query.trim()) return { hits: [], itemIds: new Set() };
            const results = index.search(query);
            const best = new Map<string, SearchHit>();
            for (const result of results) {
                const entry = result as unknown as Entry & {
                    score: number;
                    terms: string[];
                };
                if (best.has(entry.itemId)) continue;
                const terms = entry.terms.map((term) => term.toLowerCase());
                const body = entry.subId
                    ? entry.text
                    : entry.text || entry.itemTitle;
                best.set(entry.itemId, {
                    itemId: entry.itemId,
                    kind: entry.kind,
                    title: entry.itemTitle,
                    ...(entry.subId
                        ? { subId: entry.subId, subLabel: entry.subLabel }
                        : {}),
                    ...snippetOf(body, terms),
                    score: entry.score,
                });
            }
            return {
                hits: [...best.values()].slice(0, limit),
                itemIds: new Set(best.keys()),
            };
        },
    };
}
