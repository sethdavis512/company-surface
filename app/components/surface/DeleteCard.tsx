import { createContext, use, useMemo, type PropsWithChildren } from 'react';
import { useFetcher, useNavigate } from 'react-router';
import { Trash2Icon } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
} from '~/components/ui/alert-dialog';
import { Button } from '~/components/ui/button';
import { useDialogState } from '~/hooks';
import { hangingUnder } from '~/lib/surface';
import { KIND_NAMES } from './kind-icons';
import {
    FocusedItemContext,
    useSurfaceItems,
    useSurfaceLinks,
} from './surface-context';

/** The fetcher every delete goes through (the canvas hides what's going). */
export const DELETE_FETCHER_KEY = 'delete-card';

type DeleteCard = {
    /** Asks first, in a modal; deletes on yes. */
    confirmDelete: (itemId: string) => void;
};

const DeleteCardContext = createContext<DeleteCard | null>(null);

export function useDeleteCard(): DeleteCard {
    const value = use(DeleteCardContext);
    if (!value) throw new Error('useDeleteCard needs a DeleteCardProvider');
    return value;
}

/**
 * Deleting a card: the confirm modal (naming the cards hanging under it,
 * which go too) and the `delete-card` post. Leaving a focused card that's
 * going takes you back to the canvas first.
 */
export function DeleteCardProvider({ children }: PropsWithChildren) {
    const dialog = useDialogState<string>();
    const fetcher = useFetcher({ key: DELETE_FETCHER_KEY });
    const navigate = useNavigate();
    const links = useSurfaceLinks();
    const focusedId = use(FocusedItemContext);
    const { items, itemOf } = useSurfaceItems();
    const { openDialog } = dialog;
    const value = useMemo(
        () => ({ confirmDelete: (itemId: string) => openDialog(itemId) }),
        [openDialog],
    );

    const item = dialog.target ? itemOf(dialog.target) : undefined;
    const hanging = item
        ? hangingUnder(item.id, items).flatMap((id) => itemOf(id) ?? [])
        : [];

    function handleDelete() {
        if (!item) return;
        if (
            focusedId &&
            [item.id, ...hanging.map((h) => h.id)].includes(focusedId)
        ) {
            void navigate(links.action);
        }
        void fetcher.submit(
            { intent: 'delete-card', itemId: item.id },
            { method: 'post', action: links.action },
        );
        dialog.close();
    }

    return (
        <DeleteCardContext value={value}>
            {children}
            <AlertDialog open={dialog.open} onOpenChange={dialog.onOpenChange}>
                <AlertDialogPopup>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete {item ? `“${item.title}”` : 'this card'}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {item
                                ? `This ${KIND_NAMES[item.kind].toLowerCase()} and its links go for everyone on this surface. This can't be undone.`
                                : null}
                        </AlertDialogDescription>
                        {hanging.length > 0 && (
                            <div className="text-sm">
                                <p className="text-muted-foreground">
                                    {hanging.length === 1
                                        ? 'The card hanging under it goes too:'
                                        : `The ${hanging.length} cards hanging under it go too:`}
                                </p>
                                <ul className="mt-1 list-disc ps-5">
                                    {hanging.map((card) => (
                                        <li key={card.id}>
                                            {KIND_NAMES[card.kind]}:{' '}
                                            {card.title}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogClose render={<Button variant="ghost" />}>
                            Cancel
                        </AlertDialogClose>
                        <Button variant="destructive" onClick={handleDelete}>
                            <Trash2Icon aria-hidden="true" />
                            Delete
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogPopup>
            </AlertDialog>
        </DeleteCardContext>
    );
}
