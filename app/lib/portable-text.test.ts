import invariant from 'tiny-invariant';
import { describe, expect, it } from 'vitest';
import {
    cellText,
    documentBlocksSchema,
    markdownToPortableText,
    portableTextToMarkdown,
    referencedItemIds,
} from './portable-text';

function counter() {
    let next = 0;
    return () => `k${next++}`;
}

describe('markdownToPortableText', () => {
    it('makes paragraphs, headings, quotes, and lists', () => {
        const blocks = markdownToPortableText(
            [
                '# Title-level heading',
                'First line',
                'joins the second.',
                '',
                '### Small heading',
                '> Quoted',
                '- One',
                '  - Nested',
                '1. First',
            ].join('\n'),
            { key: counter() },
        );
        expect(
            blocks.map((block) =>
                block._type === 'block'
                    ? [
                          block.style,
                          block.listItem ?? null,
                          block.level ?? null,
                          block.children.map((span) => span.text).join(''),
                      ]
                    : block._type,
            ),
        ).toEqual([
            ['h2', null, null, 'Title-level heading'],
            ['normal', null, null, 'First line joins the second.'],
            ['h3', null, null, 'Small heading'],
            ['blockquote', null, null, 'Quoted'],
            ['normal', 'bullet', 1, 'One'],
            ['normal', 'bullet', 2, 'Nested'],
            ['normal', 'number', 1, 'First'],
        ]);
    });

    it('marks bold, italic, code, links, and item references, nested', () => {
        const [block] = markdownToPortableText(
            'Say **hi to [Rosa](item:chat-customers)**, *see* `code` and [docs](https://example.com), not doc_sso_notes.',
            { key: counter() },
        );
        invariant(block?._type === 'block');
        const nameOf = (mark: string) => {
            const def = block.markDefs.find((d) => d._key === mark);
            if (!def) return mark;
            return def._type === 'itemRef'
                ? `itemRef:${def.itemId}`
                : `link:${def.href}`;
        };
        expect(
            block.children.map((span) => [span.text, span.marks.map(nameOf)]),
        ).toEqual([
            ['Say ', []],
            ['hi to ', ['strong']],
            ['Rosa', ['strong', 'itemRef:chat-customers']],
            [', ', []],
            ['see', ['em']],
            [' ', []],
            ['code', ['code']],
            [' and ', []],
            ['docs', ['link:https://example.com']],
            [', not doc_sso_notes.', []],
        ]);
        expect(new Set(block.children.map((span) => span._key)).size).toBe(
            block.children.length,
        );
    });

    it('embeds an item from a line of its own', () => {
        expect(
            markdownToPortableText('Before\n![](item:board-atlas)\nAfter', {
                key: counter(),
            }).map((block) => block._type),
        ).toEqual(['block', 'itemEmbed', 'block']);
    });
});

describe('tables', () => {
    const markdown = [
        'The notes:',
        '| Note | Color | Purpose |',
        '| --- | :---: | --- |',
        '| [Sticky note 1](item:note-1) | **Amber** | A first idea |',
        '| Sticky note 2 | Sky | Pipes \\| stay put |',
        'After the table.',
    ].join('\n');

    it('reads a pipe table, header row and all, between paragraphs', () => {
        const blocks = markdownToPortableText(markdown, { key: counter() });
        expect(blocks.map((block) => block._type)).toEqual([
            'block',
            'table',
            'block',
        ]);
        const table = blocks[1];
        invariant(table?._type === 'table');
        expect(table.headerRow).toBe(true);
        expect(table.rows.map((row) => row.cells.map(cellText))).toEqual([
            ['Note', 'Color', 'Purpose'],
            ['Sticky note 1', 'Amber', 'A first idea'],
            ['Sticky note 2', 'Sky', 'Pipes | stay put'],
        ]);
        // Cells keep marks and item references.
        const [ref] = table.rows[1]!.cells;
        expect(ref!.markDefs).toEqual([
            { _type: 'itemRef', _key: expect.any(String), itemId: 'note-1' },
        ]);
        expect(table.rows[1]!.cells[1]!.children[0]!.marks).toEqual(['strong']);
        expect(referencedItemIds(blocks)).toEqual(['note-1']);
    });

    it('pads short rows, and reads a table with no header', () => {
        const [table] = markdownToPortableText('| a | b |\n| c |');
        invariant(table?._type === 'table');
        expect(table.headerRow).toBe(false);
        expect(table.rows.map((row) => row.cells.map(cellText))).toEqual([
            ['a', 'b'],
            ['c', ''],
        ]);
    });

    it('writes tables back as Markdown', () => {
        const blocks = markdownToPortableText(markdown);
        expect(portableTextToMarkdown(blocks)).toBe(
            [
                'The notes:',
                '',
                '| Note | Color | Purpose |',
                '| --- | --- | --- |',
                '| [Sticky note 1](item:note-1) | **Amber** | A first idea |',
                '| Sticky note 2 | Sky | Pipes \\| stay put |',
                '',
                'After the table.',
            ].join('\n'),
        );
        expect(documentBlocksSchema.parse(blocks)).toEqual(blocks);
    });
});

describe('portableTextToMarkdown', () => {
    it('reads back what the Markdown wrote', () => {
        const markdown = [
            '## Plan',
            '',
            'Ship [**the API freeze**](item:pr-api-freeze) with *care* and `tests`.',
            '',
            '- One',
            '  - Nested',
            '1. First',
            '',
            '![](item:board-atlas)',
            '',
            '> Read [more](https://example.com)',
        ].join('\n');
        expect(portableTextToMarkdown(markdownToPortableText(markdown))).toBe(
            markdown,
        );
    });
});

describe('referencedItemIds', () => {
    it('lists each item linked or embedded once', () => {
        expect(
            referencedItemIds(
                markdownToPortableText(
                    '[a](item:chat-launch) [b](item:chat-launch)\n\n![](item:board-atlas)',
                ),
            ),
        ).toEqual(['chat-launch', 'board-atlas']);
    });
});

describe('documentBlocksSchema', () => {
    it('accepts what documents hold, and drops unknown fields', () => {
        const blocks = markdownToPortableText(
            '## Hi\n\n- [Rosa](item:chat-customers) and [docs](https://x.dev)\n\n![](item:board-atlas)',
        );
        const extra = blocks.map((block) => ({ ...block, junk: true }));
        expect(documentBlocksSchema.parse(extra)).toEqual(blocks);
    });

    it('rejects blocks it does not know', () => {
        expect(
            documentBlocksSchema.safeParse([{ _type: 'image', _key: 'a' }])
                .success,
        ).toBe(false);
        expect(
            documentBlocksSchema.safeParse([
                { _type: 'block', _key: 'a', style: 'h1', children: [] },
            ]).success,
        ).toBe(false);
    });
});
