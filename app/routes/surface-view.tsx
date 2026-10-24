import { data, isRouteErrorResponse, Link, useParams } from 'react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { APP_NAME } from '~/config';
import { requireUserFromContext } from '~/context';
import { surfacePath } from '~/lib/surface';
import { getSavedView } from '~/models/surface.server';
import type { Route } from './+types/surface-view';

/**
 * A saved view: the parent's canvas flies to it. This route only checks the
 * view exists and names the page; the parent's auth middleware already ran.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
    requireUserFromContext(context);
    const view = getSavedView(params.viewId);

    if (!view || view.surfaceId !== params.surfaceId) {
        throw data('View not found', { status: 404 });
    }

    return { name: view.name };
}

export default function SurfaceView({ loaderData }: Route.ComponentProps) {
    return <title>{`${loaderData.name} | ${APP_NAME}`}</title>;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    const { surfaceId } = useParams();
    const message =
        isRouteErrorResponse(error) && error.status === 404
            ? 'That view was deleted or never saved.'
            : 'Something went wrong opening that view.';

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
