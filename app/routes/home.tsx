import { useState } from 'react';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { LayersIcon, PlusIcon } from 'lucide-react';
import { z } from 'zod';
import { KIND_ICONS, KIND_NAMES } from '~/components/surface/kind-icons';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { APP_NAME } from '~/config';
import { requireUserFromContext } from '~/context';
import { surfacePath, type SurfaceSummary } from '~/lib/surface';
import { authMiddleware } from '~/middleware/auth';
import {
    createSpace,
    createSurface,
    getWorkspace,
    SurfaceError,
} from '~/models/surface.server';
import type { Route } from './+types/home';

export const middleware: Route.MiddlewareFunction[] = [authMiddleware];

/**
 * The workspace: every space, each with its surfaces. Open a surface, or
 * start a space or a surface (which opens once it exists).
 */
export async function loader({ context }: Route.LoaderArgs) {
    requireUserFromContext(context);
    return { workspace: getWorkspace() };
}

const intentSchema = z.discriminatedUnion('intent', [
    z.object({
        intent: z.literal('create-space'),
        name: z.string().trim().min(1).max(60),
    }),
    z.object({
        intent: z.literal('create-surface'),
        spaceId: z.string().min(1),
        name: z.string().trim().min(1).max(60),
    }),
]);

export async function action({ request, context }: Route.ActionArgs) {
    requireUserFromContext(context);
    const parsed = intentSchema.safeParse(
        Object.fromEntries(await request.formData()),
    );
    if (!parsed.success) {
        return data({ error: 'Give it a name.' }, { status: 400 });
    }
    const input = parsed.data;
    try {
        if (input.intent === 'create-space') {
            createSpace({ name: input.name });
            return { error: null };
        }
        const surface = createSurface({
            spaceId: input.spaceId,
            name: input.name,
        });
        throw redirect(surfacePath(surface.id));
    } catch (error) {
        if (error instanceof SurfaceError) {
            return data({ error: error.message }, { status: 404 });
        }
        throw error;
    }
}

export default function Home({ loaderData }: Route.ComponentProps) {
    const { spaces } = loaderData.workspace;

    return (
        <div className="bg-background min-h-0 flex-1 overflow-y-auto">
            <title>{`Spaces | ${APP_NAME}`}</title>
            <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Spaces
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            Each space holds surfaces; each surface holds cards.
                        </p>
                    </div>
                    <NewForm
                        intent="create-space"
                        label="New space"
                        placeholder="Space name"
                    />
                </header>

                {spaces.map((space) => (
                    <section
                        key={space.id}
                        aria-labelledby={`space-${space.id}`}
                        className="flex flex-col gap-4"
                    >
                        <div>
                            <h2
                                id={`space-${space.id}`}
                                className="text-lg font-semibold"
                            >
                                {space.name}
                            </h2>
                            {space.description && (
                                <p className="text-muted-foreground text-sm">
                                    {space.description}
                                </p>
                            )}
                        </div>
                        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {space.surfaces.map((surface) => (
                                <li key={surface.id}>
                                    <SurfaceTile surface={surface} />
                                </li>
                            ))}
                            <li className="flex items-center rounded-xl border border-dashed p-4">
                                <NewForm
                                    intent="create-surface"
                                    label="New surface"
                                    placeholder="Surface name"
                                    spaceId={space.id}
                                />
                            </li>
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}

function SurfaceTile({ surface }: { surface: SurfaceSummary }) {
    return (
        <Link
            to={surfacePath(surface.id)}
            className="bg-card hover:border-ring/60 focus-visible:ring-ring flex h-full flex-col gap-3 rounded-xl border p-4 shadow-xs transition-colors outline-none focus-visible:ring-2"
        >
            <span className="flex items-center gap-2">
                <LayersIcon
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                />
                <span className="truncate font-medium">{surface.name}</span>
            </span>
            {surface.description && (
                <span className="text-muted-foreground line-clamp-2 text-sm">
                    {surface.description}
                </span>
            )}
            <span className="text-muted-foreground mt-auto flex items-center gap-2 text-xs">
                <span>
                    {surface.cardCount === 0
                        ? 'Empty'
                        : `${surface.cardCount} card${surface.cardCount === 1 ? '' : 's'}`}
                </span>
                <span aria-hidden="true" className="flex gap-1">
                    {surface.kinds.map((kind) => {
                        const Icon = KIND_ICONS[kind];
                        return (
                            <Icon
                                key={kind}
                                className="size-3.5"
                                aria-label={KIND_NAMES[kind]}
                            />
                        );
                    })}
                </span>
            </span>
        </Link>
    );
}

type NewFormProps = {
    intent: 'create-space' | 'create-surface';
    label: string;
    placeholder: string;
    spaceId?: string;
};

/** A button that turns into a one-field form to name the new thing. */
function NewForm({ intent, label, placeholder, spaceId }: NewFormProps) {
    const [open, setOpen] = useState(false);
    const navigation = useNavigation();
    const busy = navigation.formData?.get('intent') === intent;

    if (!open) {
        return (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <PlusIcon aria-hidden="true" />
                {label}
            </Button>
        );
    }
    return (
        <Form
            method="post"
            onSubmit={() => setOpen(false)}
            className="flex w-full max-w-sm items-center gap-2"
        >
            <input type="hidden" name="intent" value={intent} />
            {spaceId && <input type="hidden" name="spaceId" value={spaceId} />}
            <Input
                name="name"
                aria-label={placeholder}
                placeholder={placeholder}
                maxLength={60}
                required
                autoFocus
                onKeyDown={(event) => {
                    if (event.key === 'Escape') setOpen(false);
                }}
            />
            <Button type="submit" size="sm" disabled={busy}>
                Create
            </Button>
        </Form>
    );
}
