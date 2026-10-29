import { Link } from 'react-router';
import { defineRegistry, useBoundProp } from '@json-render/react';
import { cx } from 'cva.config';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Separator } from '~/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '~/components/ui/table';
import { uiCatalog } from '~/lib/ui-card';
import { KIND_ICONS } from './kind-icons';
import { useSurfaceItems, useSurfaceLinks } from './surface-context';

/**
 * How each component in the UI catalog (`app/lib/ui-card.ts`) draws: with
 * the app's own COSS parts and tokens, so a UI card follows the theme and
 * dark mode like every other card. Props arrive resolved, but a spec is
 * written by an agent, so every component draws whatever it gets safely
 * (numbers and text are coerced, lists default to empty).
 */

const GAPS = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' } as const;
const COLUMNS = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
} as const;
const BADGE_TONES = {
    default: 'outline',
    info: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'error',
} as const;
const CALLOUT_TONES = {
    default: 'border-border bg-muted/40',
    info: 'border-info/40 bg-info/8',
    success: 'border-success/40 bg-success/8',
    warning: 'border-warning/40 bg-warning/8',
    danger: 'border-destructive/40 bg-destructive/8',
} as const;

type Tone = keyof typeof BADGE_TONES;

function text(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    return String(value);
}

function number(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function list<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function toneOf(value: unknown): Tone {
    return typeof value === 'string' && value in BADGE_TONES
        ? (value as Tone)
        : 'default';
}

/** A chip for another card on the surface, opening it. */
function CardChip({ cardId, label }: { cardId: string; label?: string }) {
    const links = useSurfaceLinks();
    const { itemOf } = useSurfaceItems();
    const item = itemOf(cardId);
    if (!item) {
        return (
            <span className="text-muted-foreground text-sm line-through">
                {label || cardId}
            </span>
        );
    }
    const Icon = KIND_ICONS[item.kind];
    return (
        <Link
            to={links.item(item.id)}
            className="bg-muted hover:bg-accent focus-visible:ring-ring inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium outline-none focus-visible:ring-2"
        >
            <Icon
                aria-hidden="true"
                className="text-muted-foreground size-3.5 shrink-0"
            />
            <span className="truncate">{label || item.title}</span>
        </Link>
    );
}

// Actions are handled per card (`UiWindow` passes them to the provider), so
// the registry's own are stand-ins.
const noAction = async () => {};

export const { registry: uiRegistry } = defineRegistry(uiCatalog, {
    components: {
        Stack: ({ props, children }) => (
            <div
                className={cx(
                    'flex min-w-0',
                    props.direction === 'horizontal'
                        ? 'flex-row flex-wrap items-center'
                        : 'flex-col',
                    GAPS[props.gap ?? 'md'],
                )}
            >
                {children}
            </div>
        ),
        Grid: ({ props, children }) => (
            <div
                className={cx(
                    'grid min-w-0 gap-3',
                    COLUMNS[
                        Math.min(4, Math.max(2, props.columns)) as 2 | 3 | 4
                    ],
                )}
            >
                {children}
            </div>
        ),
        Heading: ({ props }) =>
            props.level === 3 ? (
                <h3 className="text-sm font-semibold">{text(props.text)}</h3>
            ) : (
                <h2 className="text-base font-semibold tracking-tight">
                    {text(props.text)}
                </h2>
            ),
        Text: ({ props }) => (
            <p
                className={cx(
                    'text-sm leading-relaxed',
                    props.muted && 'text-muted-foreground',
                )}
            >
                {text(props.text)}
            </p>
        ),
        Metric: ({ props }) => (
            <div className="bg-muted/40 flex min-w-0 flex-col gap-0.5 rounded-xl border px-3 py-2.5">
                <span className="text-muted-foreground truncate text-xs">
                    {props.label}
                </span>
                <span className="text-2xl font-semibold tabular-nums">
                    {text(props.value)}
                </span>
                {props.hint && (
                    <span className="text-muted-foreground truncate text-xs">
                        {text(props.hint)}
                    </span>
                )}
            </div>
        ),
        Badge: ({ props }) => (
            <Badge variant={BADGE_TONES[toneOf(props.tone)]}>
                {text(props.label)}
            </Badge>
        ),
        Callout: ({ props }) => (
            <div
                className={cx(
                    'rounded-xl border px-3 py-2.5 text-sm',
                    CALLOUT_TONES[toneOf(props.tone)],
                )}
            >
                <p className="font-medium">{text(props.title)}</p>
                {props.text && (
                    <p className="text-muted-foreground mt-0.5">
                        {text(props.text)}
                    </p>
                )}
            </div>
        ),
        Progress: ({ props }) => {
            const max = number(props.max);
            const value = number(props.value);
            const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
            return (
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                            {text(props.label)}
                        </span>
                        <span className="tabular-nums">
                            {value} / {max}
                        </span>
                    </div>
                    <div
                        role="progressbar"
                        aria-label={text(props.label) || undefined}
                        aria-valuemin={0}
                        aria-valuemax={max}
                        aria-valuenow={value}
                        className="bg-muted h-2 overflow-hidden rounded-full"
                    >
                        <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${share * 100}%` }}
                        />
                    </div>
                </div>
            );
        },
        BarList: ({ props }) => {
            const items = list<{ label?: unknown; value?: unknown }>(
                props.items,
            );
            const top = Math.max(1, ...items.map((item) => number(item.value)));
            return (
                <ul className="flex flex-col gap-1.5">
                    {items.map((item, index) => (
                        <li
                            key={index}
                            className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-sm"
                        >
                            <span className="text-muted-foreground truncate">
                                {text(item.label)}
                            </span>
                            <span className="bg-muted h-2 overflow-hidden rounded-full">
                                <span
                                    className="bg-primary block h-full rounded-full"
                                    style={{
                                        width: `${(number(item.value) / top) * 100}%`,
                                    }}
                                />
                            </span>
                            <span className="tabular-nums">
                                {number(item.value)}
                                {props.unit ? ` ${props.unit}` : ''}
                            </span>
                        </li>
                    ))}
                </ul>
            );
        },
        Table: ({ props }) => {
            const rows = list<Record<string, unknown>>(props.rows);
            if (rows.length === 0) {
                return (
                    <p className="text-muted-foreground text-sm">
                        {props.empty || 'Nothing here yet.'}
                    </p>
                );
            }
            return (
                <Table>
                    <TableHeader>
                        <TableRow>
                            {props.columns.map((column) => (
                                <TableHead key={column.key}>
                                    {column.label}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row, index) => (
                            <TableRow key={text(row.id) || index}>
                                {props.columns.map((column) => (
                                    <TableCell key={column.key}>
                                        {text(row[column.key])}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            );
        },
        ListItem: ({ props, children }) => (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                    {props.cardId ? (
                        <CardChip
                            cardId={text(props.cardId)}
                            label={text(props.title)}
                        />
                    ) : (
                        <span className="truncate text-sm font-medium">
                            {text(props.title)}
                        </span>
                    )}
                    {props.subtitle && (
                        <span className="text-muted-foreground truncate text-xs">
                            {text(props.subtitle)}
                        </span>
                    )}
                </div>
                {props.badge && (
                    <Badge variant="outline">{text(props.badge)}</Badge>
                )}
                {children}
            </div>
        ),
        Button: ({ props, emit }) => (
            <Button
                size="sm"
                variant={props.variant ?? 'default'}
                onClick={() => emit('press')}
            >
                {text(props.label)}
            </Button>
        ),
        Input: ({ props, bindings }) => {
            const [value, setValue] = useBoundProp<string>(
                typeof props.value === 'string' ? props.value : undefined,
                bindings?.value,
            );
            return (
                <label className="flex flex-col gap-1 text-sm">
                    {props.label && (
                        <span className="font-medium">{props.label}</span>
                    )}
                    <Input
                        value={value ?? ''}
                        placeholder={props.placeholder ?? undefined}
                        onChange={(event) => setValue(event.target.value)}
                    />
                </label>
            );
        },
        Select: ({ props, bindings }) => {
            const [value, setValue] = useBoundProp<string>(
                typeof props.value === 'string' ? props.value : undefined,
                bindings?.value,
            );
            return (
                <label className="flex flex-col gap-1 text-sm">
                    {props.label && (
                        <span className="font-medium">{props.label}</span>
                    )}
                    <select
                        value={value ?? ''}
                        onChange={(event) => setValue(event.target.value)}
                        className="border-input bg-background focus-visible:ring-ring h-9 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-2 sm:h-8"
                    >
                        {props.options.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            );
        },
        Separator: () => <Separator />,
        CardLink: ({ props }) => (
            <span>
                <CardChip
                    cardId={text(props.cardId)}
                    label={text(props.label) || undefined}
                />
            </span>
        ),
    },
    actions: {
        openCard: noAction,
        moveIssue: noAction,
        createIssue: noAction,
        setPullRequestStatus: noAction,
        postMessage: noAction,
        addNote: noAction,
    },
});
