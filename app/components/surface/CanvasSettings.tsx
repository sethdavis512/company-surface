import { useState } from 'react';
import { useFetcher } from 'react-router';
import { SettingsIcon } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
    Popover,
    PopoverPopup,
    PopoverTitle,
    PopoverTrigger,
} from '~/components/ui/popover';
import { Slider } from '~/components/ui/slider';
import { LINK_WIDTH, type CanvasSettings } from '~/lib/canvas-settings';
import { useSurfaceLinks } from './surface-context';

/**
 * This person's canvas settings: what the cookie says, with a save still
 * in flight or a slider mid-drag on top, so a change shows at once.
 */
export function useCanvasSettings(saved: CanvasSettings) {
    const links = useSurfaceLinks();
    const fetcher = useFetcher({ key: 'canvas-settings' });
    const [dragging, setDragging] = useState<number | null>(null);
    const pending = fetcher.formData?.get('linkWidth');
    const linkWidth =
        dragging ??
        (typeof pending === 'string' ? Number(pending) : null) ??
        saved.linkWidth;

    return {
        linkWidth,
        /** While the slider moves: shown, not saved. */
        previewLinkWidth: setDragging,
        /** When it's let go: saved for this browser. */
        saveLinkWidth: (value: number) => {
            void fetcher.submit(
                { intent: 'set-canvas-settings', linkWidth: String(value) },
                { method: 'post', action: links.action },
            );
            setDragging(null);
        },
    };
}

type Props = ReturnType<typeof useCanvasSettings>;

/** The cog beside who's here: how this canvas is drawn, for you only. */
export function CanvasSettingsButton({
    linkWidth,
    previewLinkWidth,
    saveLinkWidth,
}: Props) {
    const one = (value: number | readonly number[]) =>
        Array.isArray(value) ? value[0]! : (value as number);
    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        variant="outline"
                        size="icon-lg"
                        aria-label="Canvas settings"
                        title="Canvas settings"
                        className="bg-card pointer-events-auto rounded-full shadow-md"
                    />
                }
            >
                <SettingsIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverPopup side="bottom" align="end" className="w-64">
                <div className="flex flex-col gap-4 p-4">
                    <PopoverTitle className="text-sm font-semibold">
                        Canvas settings
                    </PopoverTitle>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between text-sm">
                            <span id="link-width-label">Link thickness</span>
                            <span className="text-muted-foreground tabular-nums">
                                {linkWidth}px
                            </span>
                        </div>
                        <Slider
                            min={LINK_WIDTH.min}
                            max={LINK_WIDTH.max}
                            step={LINK_WIDTH.step}
                            value={linkWidth}
                            aria-labelledby="link-width-label"
                            onValueChange={(value) =>
                                previewLinkWidth(one(value))
                            }
                            onValueCommitted={(value) =>
                                saveLinkWidth(one(value))
                            }
                        />
                        <p className="text-muted-foreground text-xs">
                            The lines between cards. Only you see this.
                        </p>
                    </div>
                </div>
            </PopoverPopup>
        </Popover>
    );
}
