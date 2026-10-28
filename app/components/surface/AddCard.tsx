import {
    createContext,
    useContext,
    useState,
    type FormEvent,
    type ReactNode,
} from 'react';
import { Form, useFetcher } from 'react-router';
import { useFlowState } from '@sethdavis512/trellis';
import { Button } from '~/components/ui/button';
import {
    Dialog,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogPanel,
    DialogPopup,
    DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
    isUrlKind,
    normalizeWebUrl,
    viewCenter,
    WINDOW_SIZES,
    youtubeVideoId,
    type SurfaceItemKind,
    type UrlKind,
} from '~/lib/surface';
import { useSurfaceLinks } from './surface-context';
import { TOP_PX } from './ZoomOverlay';

type AddCard = {
    /**
     * Adds a card of this kind: in the middle of what you're looking at (or
     * centered on `at`, a point on the canvas), or hanging from
     * `attachedTo`. Videos, web pages, and images ask for their address
     * first; a new document opens, ready to write in.
     */
    add: (
        kind: SurfaceItemKind,
        options?: {
            attachedTo?: string;
            at?: { x: number; y: number };
        },
    ) => void;
};

const AddCardContext = createContext<AddCard | null>(null);

export function useAddCard(): AddCard {
    const value = useContext(AddCardContext);
    if (!value) throw new Error('useAddCard needs an AddCardProvider');
    return value;
}

const ADDRESS_COPY: Record<
    UrlKind,
    { title: string; label: string; placeholder: string; hint: string }
> = {
    video: {
        title: 'Add a video',
        label: 'YouTube link',
        placeholder: 'https://www.youtube.com/watch?v=…',
        hint: 'Any YouTube link: watch, youtu.be, shorts, or embed.',
    },
    web: {
        title: 'Add a web page',
        label: 'Web address',
        placeholder: 'example.com',
        hint: 'https only. Some sites refuse to be embedded.',
    },
    image: {
        title: 'Add an image',
        label: 'Image address',
        placeholder: 'https://…/picture.png',
        hint: 'An https link to a picture or animated GIF.',
    },
};

/** Whether an address will work for this kind, as the server will check. */
function addressWorks(kind: UrlKind, address: string): boolean {
    return kind === 'video'
        ? youtubeVideoId(address) !== null
        : normalizeWebUrl(address) !== null;
}

type Asking = {
    kind: UrlKind;
    attachedTo?: string;
    at?: { x: number; y: number };
};

/**
 * Lets anything on the surface add cards (`useAddCard`), and holds the
 * address dialog videos, web pages, and images need. Inside the surface
 * route and Trellis's provider: it reads where the canvas is looking.
 */
export function AddCardProvider({ children }: { children: ReactNode }) {
    const links = useSurfaceLinks();
    const fetcher = useFetcher({ key: 'create-card' });
    const viewport = useFlowState((s) => s.viewport);
    const canvas = useFlowState((s) => s.size);
    const [asking, setAsking] = useState<Asking | null>(null);

    function submit(
        kind: SurfaceItemKind,
        fields: {
            attachedTo?: string;
            at?: { x: number; y: number };
            url?: string;
            title?: string;
        },
    ) {
        const form: Record<string, string> = { intent: 'create-card', kind };
        if (fields.attachedTo) form.attachedTo = fields.attachedTo;
        else if (fields.at || canvas.width > 0) {
            // Centered on the point given, or in the view below the filter
            // bar.
            const center =
                fields.at ??
                viewCenter(viewport, {
                    width: canvas.width,
                    height: canvas.height + TOP_PX,
                });
            form.x = String(
                Math.round(center.x - WINDOW_SIZES[kind].width / 2),
            );
            form.y = String(
                Math.round(center.y - WINDOW_SIZES[kind].height / 2),
            );
        }
        if (fields.url) form.url = fields.url;
        if (fields.title) form.title = fields.title;
        void fetcher.submit(form, { method: 'post', action: links.action });
    }

    const value: AddCard = {
        add(kind, options = {}) {
            if (isUrlKind(kind)) setAsking({ kind, ...options });
            else submit(kind, options);
        },
    };

    return (
        <AddCardContext.Provider value={value}>
            {children}
            <AddressDialog
                asking={asking}
                onClose={() => setAsking(null)}
                onAdd={(url, title) => {
                    if (!asking) return;
                    submit(asking.kind, {
                        attachedTo: asking.attachedTo,
                        at: asking.at,
                        url,
                        title,
                    });
                    setAsking(null);
                }}
            />
        </AddCardContext.Provider>
    );
}

type DialogProps = {
    asking: Asking | null;
    onClose: () => void;
    onAdd: (url: string, title: string) => void;
};

/** Asks for a video, web page, or image's address (and an optional title). */
function AddressDialog({ asking, onClose, onAdd }: DialogProps) {
    const [address, setAddress] = useState('');
    const [title, setTitle] = useState('');
    const [tried, setTried] = useState(false);
    const kind = asking?.kind ?? 'web';
    const copy = ADDRESS_COPY[kind];
    const works = addressWorks(kind, address);

    function reset() {
        setAddress('');
        setTitle('');
        setTried(false);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setTried(true);
        if (!works) return;
        onAdd(address.trim(), title.trim());
        reset();
    }

    return (
        <Dialog
            open={asking !== null}
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                    reset();
                }
            }}
        >
            <DialogPopup>
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.hint}</DialogDescription>
                </DialogHeader>
                <Form onSubmit={handleSubmit} className="contents">
                    <DialogPanel className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="add-card-address">
                                {copy.label}
                            </Label>
                            <Input
                                id="add-card-address"
                                value={address}
                                onChange={(event) =>
                                    setAddress(event.target.value)
                                }
                                placeholder={copy.placeholder}
                                aria-invalid={tried && !works}
                                aria-describedby={
                                    tried && !works
                                        ? 'add-card-address-error'
                                        : undefined
                                }
                                autoFocus
                                spellCheck={false}
                            />
                            {tried && !works && (
                                <p
                                    id="add-card-address-error"
                                    className="text-destructive-foreground text-xs"
                                >
                                    {kind === 'video'
                                        ? "That isn't a YouTube link."
                                        : "That isn't an https address."}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="add-card-title">
                                Title (optional)
                            </Label>
                            <Input
                                id="add-card-title"
                                value={title}
                                onChange={(event) =>
                                    setTitle(event.target.value)
                                }
                                maxLength={120}
                            />
                        </div>
                    </DialogPanel>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                onClose();
                                reset();
                            }}
                        >
                            Cancel
                        </Button>
                        <Button type="submit">Add</Button>
                    </DialogFooter>
                </Form>
            </DialogPopup>
        </Dialog>
    );
}
