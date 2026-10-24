import { Outlet } from 'react-router';
import { SiteHeader } from '~/components/SiteHeader';

export default function AppLayout() {
    return (
        <div className="grid h-dvh grid-rows-[auto_1fr]">
            <SiteHeader />
            <main id="main-content" className="flex min-h-0 flex-col">
                <Outlet />
            </main>
        </div>
    );
}
