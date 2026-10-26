import {
    ChartColumnIcon,
    FileTextIcon,
    GlobeIcon,
    GitPullRequestIcon,
    ImageIcon,
    KanbanSquareIcon,
    MessageCircleIcon,
    SquarePlayIcon,
    StickyNoteIcon,
    PaletteIcon,
    type LucideIcon,
} from 'lucide-react';
import type { SurfaceItemKind } from '~/lib/surface';

/** One icon per kind of item, wherever items are listed or linked. */
export const KIND_ICONS: Record<SurfaceItemKind, LucideIcon> = {
    chat: MessageCircleIcon,
    document: FileTextIcon,
    'pull-request': GitPullRequestIcon,
    chart: ChartColumnIcon,
    board: KanbanSquareIcon,
    video: SquarePlayIcon,
    web: GlobeIcon,
    image: ImageIcon,
    note: StickyNoteIcon,
    sketch: PaletteIcon,
};

export const KIND_NAMES: Record<SurfaceItemKind, string> = {
    chat: 'Chat',
    document: 'Document',
    'pull-request': 'Pull request',
    chart: 'Chart',
    board: 'Board',
    video: 'Video',
    web: 'Web page',
    image: 'Image',
    note: 'Sticky note',
    sketch: 'Sketch',
};
