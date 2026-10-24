import { useRouteLoaderData } from 'react-router';
import { APP_NAME } from '~/config';
import type { loader as surfaceLoader } from './surface';

/** The whole canvas, nothing focused: the parent route draws it. */
export default function SurfaceIndex() {
    const data = useRouteLoaderData<typeof surfaceLoader>('routes/surface');
    const name = data?.surface.name;
    return (
        <>
            <title>{name ? `${name} | ${APP_NAME}` : APP_NAME}</title>
            <meta
                name="description"
                content={
                    data?.surface.description ||
                    'Every kind of company information, and how it relates.'
                }
            />
        </>
    );
}
