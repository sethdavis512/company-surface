/**
 * Documents are Portable Text (https://www.portabletext.org): a list of
 * blocks, each with spans of text and marks. On top of the standard text
 * blocks, two kinds of reference make documents part of the surface:
 *
 * - `itemRef`, an annotation on a span: "this phrase points at that chat,
 *   issue board, or pull request".
 * - `itemEmbed`, a block of its own: a card for another item, in the flow
 *   of the document.
 *
 * And `table`, a block of rows of cells, each cell a line of inline text
 * (marks and `itemRef`s included).
 *
 * Agents write Markdown, not Portable Text: `markdownToPortableText` turns
 * it into blocks, with `[text](item:<id>)` for an `itemRef`, a line of
 * just `![](item:<id>)` for an `itemEmbed`, and GitHub-style pipe tables. `portableTextToMarkdown` goes
 * back, so agents read documents the way they write them.
 */

import { z } from 'zod';

export const TEXT_STYLES = ['normal', 'h2', 'h3', 'blockquote'] as const;
export const LIST_ITEMS = ['bullet', 'number'] as const;
export const DECORATORS = ['strong', 'em', 'code'] as const;

export type TextStyle = (typeof TEXT_STYLES)[number];
export type ListItem = (typeof LIST_ITEMS)[number];
export type Decorator = (typeof DECORATORS)[number];

export type Span = {
    _type: 'span';
    _key: string;
    text: string;
    /** Decorators and the `_key`s of this block's `markDefs`. */
    marks: string[];
};

export type ItemRefMark = { _type: 'itemRef'; _key: string; itemId: string };
export type LinkMark = { _type: 'link'; _key: string; href: string };
export type MarkDef = ItemRefMark | LinkMark;

export type TextBlock = {
    _type: 'block';
    _key: string;
    style: TextStyle;
    listItem?: ListItem;
    level?: number;
    children: Span[];
    markDefs: MarkDef[];
};

export type ItemEmbedBlock = {
    _type: 'itemEmbed';
    _key: string;
    itemId: string;
};

/** One cell of a table: inline text, like a block's without a style. */
export type TableCell = {
    _key: string;
    children: Span[];
    markDefs: MarkDef[];
};

export type TableRow = { _key: string; cells: TableCell[] };

export type TableBlock = {
    _type: 'table';
    _key: string;
    /** The first row is the header (Markdown's `| --- |` line under it). */
    headerRow: boolean;
    rows: TableRow[];
};

export type DocumentBlock = TextBlock | ItemEmbedBlock | TableBlock;

const keySchema = z.string().min(1).max(64);

const spansSchema = z
    .array(
        z.object({
            _type: z.literal('span'),
            _key: keySchema,
            text: z.string().max(20000),
            marks: z.array(z.string().max(64)).default([]),
        }),
    )
    .min(1);

const markDefsSchema = z
    .array(
        z.discriminatedUnion('_type', [
            z.object({
                _type: z.literal('itemRef'),
                _key: keySchema,
                itemId: z.string().min(1),
            }),
            z.object({
                _type: z.literal('link'),
                _key: keySchema,
                href: z.string().min(1).max(2000),
            }),
        ]),
    )
    .default([]);

/**
 * What a document may hold, for content that comes from outside the
 * server (the editor's saves). Unknown fields are dropped.
 */
export const documentBlocksSchema = z
    .array(
        z.discriminatedUnion('_type', [
            z.object({
                _type: z.literal('block'),
                _key: keySchema,
                style: z.enum(TEXT_STYLES).default('normal'),
                listItem: z.enum(LIST_ITEMS).optional(),
                level: z.number().int().min(1).max(6).optional(),
                children: spansSchema,
                markDefs: markDefsSchema,
            }),
            z.object({
                _type: z.literal('itemEmbed'),
                _key: keySchema,
                itemId: z.string().min(1),
            }),
            z.object({
                _type: z.literal('table'),
                _key: keySchema,
                headerRow: z.boolean().default(false),
                rows: z
                    .array(
                        z.object({
                            _key: keySchema,
                            cells: z
                                .array(
                                    z.object({
                                        _key: keySchema,
                                        children: spansSchema,
                                        markDefs: markDefsSchema,
                                    }),
                                )
                                .min(1)
                                .max(50),
                        }),
                    )
                    .min(1)
                    .max(500),
            }),
        ]),
    )
    .max(2000) satisfies z.ZodType<DocumentBlock[], unknown>;

type Options = {
    /** Makes `_key`s; random by default. */
    key?: () => string;
};

function randomKey() {
    return crypto.randomUUID().slice(0, 8);
}

const ITEM_PREFIX = 'item:';
const EMBED_LINE = /^!\[[^\]]*\]\(item:([^)\s]+)\)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const LIST_LINE = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_LINE = /^\|.*\|$/;
/** The line under a table's header: `| --- | :---: |`. */
const TABLE_RULE = /^\|(\s*:?-+:?\s*\|)+$/;

/** A table line's cells, split on pipes that aren't escaped. */
function tableCells(line: string): string[] {
    const inner = line.trim().slice(1, -1);
    const cells: string[] = [];
    let cell = '';
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '\\' && inner[i + 1] === '|') {
            cell += '\\|';
            i += 1;
        } else if (inner[i] === '|') {
            cells.push(cell.trim());
            cell = '';
        } else cell += inner[i];
    }
    cells.push(cell.trim());
    return cells;
}

/** Turns Markdown into document blocks. Unknown syntax stays as text. */
export function markdownToPortableText(
    markdown: string,
    { key = randomKey }: Options = {},
): DocumentBlock[] {
    const blocks: DocumentBlock[] = [];
    let paragraph: string[] = [];
    let quote: string[] = [];
    let table: string[] = [];

    function text(style: TextStyle, raw: string, list?: ListItem, level = 1) {
        const markDefs: MarkDef[] = [];
        const children = parseInline(raw.trim(), [], markDefs, key);
        blocks.push({
            _type: 'block',
            _key: key(),
            style,
            ...(list ? { listItem: list, level } : {}),
            children:
                children.length > 0
                    ? children
                    : [{ _type: 'span', _key: key(), text: '', marks: [] }],
            markDefs,
        });
    }
    function cell(raw: string): TableCell {
        const markDefs: MarkDef[] = [];
        const children = parseInline(raw, [], markDefs, key);
        return {
            _key: key(),
            children:
                children.length > 0
                    ? children
                    : [{ _type: 'span', _key: key(), text: '', marks: [] }],
            markDefs,
        };
    }
    function flushTable() {
        const lines = table;
        table = [];
        if (lines.length === 0) return;
        const headerRow = lines.length > 1 && TABLE_RULE.test(lines[1]!);
        const rows = lines
            .filter((_, index) => !(headerRow && index === 1))
            .map(tableCells);
        // Every row as wide as the widest, so the columns line up.
        const width = Math.max(...rows.map((row) => row.length));
        blocks.push({
            _type: 'table',
            _key: key(),
            headerRow,
            rows: rows.map((cells) => ({
                _key: key(),
                cells: Array.from({ length: width }, (_, index) =>
                    cell(cells[index] ?? ''),
                ),
            })),
        });
    }
    function flush() {
        if (paragraph.length > 0) text('normal', paragraph.join(' '));
        if (quote.length > 0) text('blockquote', quote.join(' '));
        paragraph = [];
        quote = [];
        flushTable();
    }

    for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') {
            flush();
            continue;
        }
        if (TABLE_LINE.test(trimmed)) {
            if (table.length === 0) flush();
            table.push(trimmed);
            continue;
        }
        flushTable();
        const embed = EMBED_LINE.exec(trimmed);
        if (embed) {
            flush();
            blocks.push({ _type: 'itemEmbed', _key: key(), itemId: embed[1]! });
            continue;
        }
        const heading = HEADING.exec(trimmed);
        if (heading) {
            flush();
            // The document's title is its h1, so `#` and `##` both make h2.
            text(heading[1]!.length === 3 ? 'h3' : 'h2', heading[2]!);
            continue;
        }
        const list = LIST_LINE.exec(line);
        if (list) {
            flush();
            const level = Math.floor(list[1]!.replace(/\t/g, '  ').length / 2);
            text(
                'normal',
                list[3]!,
                /\d/.test(list[2]!) ? 'number' : 'bullet',
                level + 1,
            );
            continue;
        }
        const quoted = QUOTE.exec(trimmed);
        if (quoted) {
            if (paragraph.length > 0) flush();
            quote.push(quoted[1]!);
            continue;
        }
        if (quote.length > 0) flush();
        paragraph.push(trimmed);
    }
    flush();
    return blocks;
}

// Underscores are left alone: ids like doc_sso_notes are common in text.
const DECORATOR_TOKENS: [string, Decorator][] = [
    ['**', 'strong'],
    ['*', 'em'],
];

/**
 * Spans for one line of inline Markdown: `**strong**`, `*em*`, `` `code` ``,
 * and `[text](href)` links (`item:<id>` hrefs become `itemRef`s). Marks
 * nest: a link's text can be bold, and so on.
 */
function parseInline(
    raw: string,
    marks: string[],
    markDefs: MarkDef[],
    key: () => string,
): Span[] {
    const spans: Span[] = [];
    let plain = '';
    const pushPlain = () => {
        if (plain)
            spans.push({ _type: 'span', _key: key(), text: plain, marks });
        plain = '';
    };

    let i = 0;
    while (i < raw.length) {
        const rest = raw.slice(i);
        if (rest[0] === '\\' && rest.length > 1) {
            plain += rest[1];
            i += 2;
            continue;
        }
        if (rest[0] === '`') {
            const end = rest.indexOf('`', 1);
            if (end > 1) {
                pushPlain();
                spans.push({
                    _type: 'span',
                    _key: key(),
                    text: rest.slice(1, end),
                    marks: [...marks, 'code'],
                });
                i += end + 1;
                continue;
            }
        }
        if (rest[0] === '[') {
            const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
            if (link) {
                pushPlain();
                const href = link[2]!;
                const def: MarkDef = href.startsWith(ITEM_PREFIX)
                    ? {
                          _type: 'itemRef',
                          _key: key(),
                          itemId: href.slice(ITEM_PREFIX.length),
                      }
                    : { _type: 'link', _key: key(), href };
                markDefs.push(def);
                spans.push(
                    ...parseInline(
                        link[1]!,
                        [...marks, def._key],
                        markDefs,
                        key,
                    ),
                );
                i += link[0].length;
                continue;
            }
        }
        const decorator = DECORATOR_TOKENS.find(([token]) =>
            rest.startsWith(token),
        );
        if (decorator) {
            const [token, mark] = decorator;
            const end = rest.indexOf(token, token.length + 1);
            if (end > token.length) {
                pushPlain();
                spans.push(
                    ...parseInline(
                        rest.slice(token.length, end),
                        [...marks, mark],
                        markDefs,
                        key,
                    ),
                );
                i += end + token.length;
                continue;
            }
        }
        plain += rest[0];
        i += 1;
    }
    pushPlain();
    return spans;
}

const DECORATOR_MARKDOWN: Record<Decorator, string> = {
    strong: '**',
    em: '*',
    code: '`',
};

/** Markdown for document blocks, the reverse of `markdownToPortableText`. */
export function portableTextToMarkdown(blocks: DocumentBlock[]): string {
    const lines: string[] = [];
    let previous: DocumentBlock | undefined;
    for (const block of blocks) {
        const inList =
            block._type === 'block' &&
            block.listItem &&
            previous?._type === 'block' &&
            previous.listItem;
        if (previous && !inList) lines.push('');
        previous = block;

        if (block._type === 'itemEmbed') {
            lines.push(`![](${ITEM_PREFIX}${block.itemId})`);
            continue;
        }
        if (block._type === 'table') {
            const row = (cells: TableCell[]) =>
                `| ${cells
                    .map((cell) =>
                        cell.children
                            .map((span) => spanMarkdown(span, cell.markDefs))
                            .join('')
                            .replace(/(?<!\\)\|/g, '\\|'),
                    )
                    .join(' | ')} |`;
            block.rows.forEach((tableRow, index) => {
                lines.push(row(tableRow.cells));
                if (index === 0 && block.headerRow) {
                    lines.push(
                        `| ${tableRow.cells.map(() => '---').join(' | ')} |`,
                    );
                }
            });
            continue;
        }
        const body = block.children
            .map((span) => spanMarkdown(span, block.markDefs))
            .join('');
        if (block.listItem) {
            const indent = '  '.repeat((block.level ?? 1) - 1);
            lines.push(
                `${indent}${block.listItem === 'number' ? '1.' : '-'} ${body}`,
            );
        } else if (block.style === 'h2') lines.push(`## ${body}`);
        else if (block.style === 'h3') lines.push(`### ${body}`);
        else if (block.style === 'blockquote') lines.push(`> ${body}`);
        else lines.push(body);
    }
    return lines.join('\n');
}

function spanMarkdown(span: Span, markDefs: MarkDef[]): string {
    let text = span.text;
    // Decorators inside, links outside, whichever order the marks came in.
    const marks = [...span.marks].sort(
        (a, b) =>
            Number(!(a in DECORATOR_MARKDOWN)) -
            Number(!(b in DECORATOR_MARKDOWN)),
    );
    for (const mark of marks) {
        if (mark in DECORATOR_MARKDOWN) {
            const token = DECORATOR_MARKDOWN[mark as Decorator];
            text = `${token}${text}${token}`;
            continue;
        }
        const def = markDefs.find((candidate) => candidate._key === mark);
        if (def?._type === 'itemRef') {
            text = `[${text}](${ITEM_PREFIX}${def.itemId})`;
        } else if (def?._type === 'link') text = `[${text}](${def.href})`;
    }
    return text;
}

/** A table cell's text, without marks. */
export function cellText(cell: TableCell): string {
    return cell.children.map((span) => span.text).join('');
}

/** Every item a document points at, through `itemRef`s or `itemEmbed`s. */
export function referencedItemIds(blocks: DocumentBlock[]): string[] {
    const ids = new Set<string>();
    const fromMarks = (markDefs: MarkDef[]) => {
        for (const def of markDefs) {
            if (def._type === 'itemRef') ids.add(def.itemId);
        }
    };
    for (const block of blocks) {
        if (block._type === 'itemEmbed') ids.add(block.itemId);
        else if (block._type === 'table') {
            for (const row of block.rows) {
                for (const cell of row.cells) fromMarks(cell.markDefs);
            }
        } else fromMarks(block.markDefs);
    }
    return [...ids];
}
