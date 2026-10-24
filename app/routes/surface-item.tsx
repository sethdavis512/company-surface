import { data, isRouteErrorResponse, Link, useParams } from 'react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { APP_NAME } from '~/config';
import { requireUserFromContext } from '~/context';
import { surfacePath } from '~/lib/surface';
import { getSurfaceItem } from '~/models/surface.server';
import type { Route } from './+types/surface-item';

/**
 * One card, focused: the parent's canvas zooms to the node whose id is in the
 * URL. This route only checks the card is on this surface and names the page; the
 * parent's auth middleware already ran.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
    const user = requireUserFromContext(context);
    const item = await getSurfaceItem(user, params.surfaceId, params.itemId);

    if (!item) {
        throw data('Item not found', { status: 404 });
    }

    return { title: item.title };
}

export default function SurfaceItem({ loaderData }: Route.ComponentProps) {
    return <title>{`${loaderData.title} | ${APP_NAME}`}</title>;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const { surfaceId } = useParams();
    const message =
        isRouteErrorResponse(error) && error.status === 404
            ? 'That card is not on this surface.'
            : 'Something went wrong opening that card.';

    return (
        <div
            role="alert"
            className="bg-card pointer-events-auto mx-auto mt-6 flex w-fit items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg"
        >
            <title>{`Not found | ${APP_NAME}`}</title>
            <span>{message}</span>
            <Button
                variant="outline"
                size="sm"
                render={<Link to={surfacePath(surfaceId!)} />}
            >
                <ArrowLeftIcon aria-hidden="true" />
                Back to canvas
            </Button>
        </div>
    );
}
