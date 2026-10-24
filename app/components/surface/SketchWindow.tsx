import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { Handle, type FlowNode, type NodeProps } from '@sethdavis512/trellis';
import {
    EraserIcon,
    PaletteIcon,
    PencilIcon,
    Trash2Icon,
    Undo2Icon,
} from 'lucide-react';
import { cx } from 'cva.config';
import {
    SKETCH_COLORS,
    SKETCH_SIZE,
    isAgentMade,
    type SketchItem,
    type SketchStroke,
} from '~/lib/surface';
import {
    ERASER_SCALE,
    SKETCH_BRUSHES,
    SKETCH_PAPER,
    extendStroke,
    strokePath,
} from '~/lib/sketch';
import { AgentBadge, AgentStripe } from './AgentMark';
import {
    FocusedItemContext,
    useSurfaceLinks,
    useWindowColors,
} from './surface-context';
import { windowBorderClass } from './window-colors';
import { WindowControls } from './WindowControls';
import { ZoomOverlay } from './ZoomOverlay';
import { LinkHandle } from './LinkHandle';
import { CardTitle } from './CardTitle';

export type SketchNode = FlowNode<{ item: SketchItem }, 'sketch'>;

/** Wait this long after the last stroke before saving. */
const SAVE_DELAY_MS = 600;
const PAPER = SKETCH_PAPER;

type Tool = 'pencil' | 'eraser';

/**
 * A quick drawing, MS Paint style: pencil and eraser, three brush widths,
 * Paint's sixteen colors, undo and clear, on white paper. Strokes are
 * vectors in the paper's own units (`SKETCH_SIZE`), so the drawing scales
 * with the card and the canvas zoom. Saves the whole drawing a moment
 * after the last stroke (`update-sketch`); an agent's change shows when
 * you aren't drawing.
 */
export function SketchWindow({ data, selected }: NodeProps<SketchNode>) {
    const sketch = data.item;
    const links = useSurfaceLinks();
    const { colorOf } = useWindowColors();
    const focused = use(FocusedItemContext) === sketch.id;
    const fetcher = useFetcher({ key: `sketch:${sketch.id}` });
    const svgRef = useRef<SVGSVGElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [tool, setTool] = useState<Tool>('pencil');
    const [color, setColor] = useState<string>(SKETCH_COLORS[0]);
    const [brush, setBrush] = useState<number>(SKETCH_BRUSHES[1]);
    // Your latest drawing and the saved version it was drawn over; the
    // stroke under the pointer; and whether a save is waiting to go.
    const [draft, setDraft] = useState<{
        strokes: SketchStroke[];
        base: string;
    } | null>(null);
    const [live, setLive] = useState<SketchStroke | null>(null);
    const [waiting, setWaiting] = useState(false);

    // Yours until the saved sketch moves past the version you drew over and
    // nothing is left to send, so the old drawing never flashes back in
    // between. After that, the saved one (an agent's change shows).
    const mine =
        draft &&
        (waiting ||
            fetcher.state !== 'idle' ||
            draft.base === sketch.updatedAt);
    const strokes = mine ? draft.strokes : sketch.strokes;
    // Ink outlines for the finished strokes, worked out once per drawing
    // rather than on every pointer move.
    const paths = useMemo(
        () => strokes.map((stroke) => strokePath(stroke)),
        [strokes],
    );

    useEffect(() => () => clearTimeout(timer.current), []);

    function commit(next: SketchStroke[], { now = false } = {}) {
        setDraft({ strokes: next, base: sketch.updatedAt });
        clearTimeout(timer.current);
        const send = () => {
            void fetcher.submit(
                {
                    intent: 'update-sketch',
                    sketchId: sketch.id,
                    strokes: JSON.stringify(next),
                },
                { method: 'post', action: links.action },
            );
            setWaiting(false);
        };
        setWaiting(!now);
        if (now) send();
        else timer.current = setTimeout(send, SAVE_DELAY_MS);
    }

    /** The pointer's spot in paper units, whatever the zoom. */
    function paperPoint(event: PointerEvent): [number, number] {
        const svg = svgRef.current!;
        const point = new DOMPoint(
            event.clientX,
            event.clientY,
        ).matrixTransform(svg.getScreenCTM()!.inverse());
        return [point.x, point.y];
    }

    /** A pen's pressure; mice and fingers leave it to the ink's speed. */
    function penPressure(event: PointerEvent) {
        return event.pointerType === 'pen' ? event.pressure : undefined;
    }

    function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const [x, y] = paperPoint(event.nativeEvent);
        const pressure = penPressure(event.nativeEvent);
        setLive(
            extendStroke(
                {
                    color: tool === 'eraser' ? PAPER : color,
                    size: tool === 'eraser' ? brush * ERASER_SCALE : brush,
                    points: [],
                    ...(pressure !== undefined && { pressures: [] }),
                },
                x,
                y,
                pressure,
            ),
        );
    }

    function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
        if (!live) return;
        // Every sample the browser merged into this event, so fast strokes
        // keep their curves.
        const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
        let next = live;
        for (const sample of samples.length ? samples : [event.nativeEvent]) {
            const [x, y] = paperPoint(sample);
            next = extendStroke(next, x, y, penPressure(sample));
        }
        if (next !== live) setLive(next);
    }

    function handlePointerUp() {
        if (!live) return;
        commit([...strokes, live]);
        setLive(null);
    }

    return (
        <div className="group/window relative size-full">
            <Handle type="target" position="top" />
            <LinkHandle />
            <WindowControls
                itemId={sketch.id}
                title={sketch.title}
                focused={focused}
                selected={selected}
            />
            <ZoomOverlay
                itemId={sketch.id}
                title={sketch.title}
                kind="Sketch"
                rounded="rounded-xl"
            />
            <article
                aria-label={`Sketch: ${sketch.title}`}
                className={cx(
                    'bg-card text-card-foreground relative flex size-full flex-col overflow-hidden rounded-xl shadow-lg transition-shadow',
                    windowBorderClass(colorOf(sketch.id)),
                    selected && 'ring-ring ring-2',
                )}
            >
                {isAgentMade(sketch) && <AgentStripe />}
                <header className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b px-4 active:cursor-grabbing">
                    <PaletteIcon
                        aria-hidden="true"
                        className="text-muted-foreground size-4 shrink-0"
                    />
                    <CardTitle
                        itemId={sketch.id}
                        title={sketch.title}
                        className="min-w-0 flex-1 truncate text-sm font-semibold"
                    />
                    {isAgentMade(sketch) && <AgentBadge />}
                </header>
                <div
                    role="toolbar"
                    aria-label="Drawing tools"
                    className="nodrag flex h-10 shrink-0 items-center gap-1 border-b px-2"
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <ToolButton
                        label="Pencil"
                        pressed={tool === 'pencil'}
                        onClick={() => setTool('pencil')}
                    >
                        <PencilIcon aria-hidden="true" className="size-4" />
                    </ToolButton>
                    <ToolButton
                        label="Eraser"
                        pressed={tool === 'eraser'}
                        onClick={() => setTool('eraser')}
                    >
                        <EraserIcon aria-hidden="true" className="size-4" />
                    </ToolButton>
                    <span
                        aria-hidden="true"
                        className="bg-border mx-1 h-5 w-px"
                    />
                    {SKETCH_BRUSHES.map((size) => (
                        <ToolButton
                            key={size}
                            label={`Brush size ${size}`}
                            pressed={brush === size}
                            onClick={() => setBrush(size)}
                        >
                            <span
                                aria-hidden="true"
                                className="bg-foreground rounded-full"
                                style={{
                                    width: Math.min(14, size + 2),
                                    height: Math.min(14, size + 2),
                                }}
                            />
                        </ToolButton>
                    ))}
                    <span className="flex-1" />
                    <ToolButton
                        label="Undo"
                        disabled={strokes.length === 0}
                        onClick={() => commit(strokes.slice(0, -1))}
                    >
                        <Undo2Icon aria-hidden="true" className="size-4" />
                    </ToolButton>
                    <ToolButton
                        label="Clear the sketch"
                        disabled={strokes.length === 0}
                        onClick={() => commit([], { now: true })}
                    >
                        <Trash2Icon aria-hidden="true" className="size-4" />
                    </ToolButton>
                </div>
                <div className="bg-muted/50 nodrag nowheel flex min-h-0 flex-1 items-center justify-center p-2">
                    <svg
                        ref={svgRef}
                        role="img"
                        aria-label={`Drawing: ${strokes.length} strokes`}
                        data-testid="sketch-paper"
                        viewBox={`0 0 ${SKETCH_SIZE.width} ${SKETCH_SIZE.height}`}
                        preserveAspectRatio="xMidYMid meet"
                        className="max-h-full max-w-full cursor-crosshair touch-none shadow-sm select-none"
                        style={{ background: PAPER }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    >
                        {strokes.map((stroke, index) => (
                            <path
                                key={index}
                                d={paths[index]}
                                fill={stroke.color}
                            />
                        ))}
                        {live && (
                            <path d={strokePath(live)} fill={live.color} />
                        )}
                    </svg>
                </div>
                <footer
                    className="nodrag flex shrink-0 items-center gap-3 border-t px-3 py-2"
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    {/* Paint's "current colors" well. */}
                    <span
                        aria-hidden="true"
                        className="size-7 shrink-0 rounded border shadow-inner"
                        style={{
                            background: tool === 'eraser' ? PAPER : color,
                        }}
                    />
                    <div
                        role="radiogroup"
                        aria-label="Color"
                        className="grid grid-flow-col grid-rows-2 gap-0.5"
                    >
                        {SKETCH_COLORS.map((swatch) => (
                            <button
                                key={swatch}
                                type="button"
                                role="radio"
                                aria-checked={color === swatch}
                                aria-label={`Color ${swatch}`}
                                title={swatch}
                                onClick={() => {
                                    setColor(swatch);
                                    setTool('pencil');
                                }}
                                className={cx(
                                    'focus-visible:ring-ring border border-black/30 outline-none focus-visible:ring-2 pointer-coarse:size-6',
                                    focused ? 'size-6' : 'size-3.5',
                                    color === swatch &&
                                        tool === 'pencil' &&
                                        'ring-foreground ring-2 ring-offset-1',
                                )}
                                style={{ background: swatch }}
                            />
                        ))}
                    </div>
                </footer>
            </article>
        </div>
    );
}

function ToolButton({
    label,
    pressed,
    disabled,
    onClick,
    children,
}: {
    label: string;
    pressed?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cx(
                'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 disabled:opacity-40 pointer-coarse:size-11',
                pressed && 'bg-accent text-foreground',
            )}
        >
            {children}
        </button>
    );
}
