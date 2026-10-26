import { cx } from 'cva.config';
import type { Person } from '~/lib/surface';
import { Avatar } from './Avatar';

/** More than this many, and the rest are a count. */
const MAX_SHOWN = 4;

type Props = {
    /** Everyone viewing the surface, from its event stream. */
    people: Person[];
    meId: string;
    className?: string;
};

/** Who's on this surface right now: everyone else first, then you. */
export function PresenceAvatars({ people, meId, className }: Props) {
    if (people.length === 0) return null;
    const ordered = [
        ...people.filter((person) => person.id !== meId),
        ...people.filter((person) => person.id === meId),
    ];
    const shown = ordered.slice(0, MAX_SHOWN);
    const hidden = ordered.slice(MAX_SHOWN);
    const nameOf = (person: Person) =>
        person.id === meId ? `${person.name} (you)` : person.name;

    return (
        <div
            role="group"
            aria-label={`Here now: ${ordered.map(nameOf).join(', ')}`}
            className={cx(
                'bg-card pointer-events-auto flex items-center gap-1 rounded-full border p-1 shadow-md',
                className,
            )}
        >
            <ul className="flex -space-x-1.5">
                {shown.map((person) => (
                    <li key={person.id} title={nameOf(person)}>
                        <Avatar person={person} size="md" />
                        <span className="sr-only">{nameOf(person)}</span>
                    </li>
                ))}
            </ul>
            {hidden.length > 0 && (
                <span
                    title={hidden.map(nameOf).join(', ')}
                    className="text-muted-foreground px-1.5 text-xs font-medium"
                >
                    +{hidden.length}
                </span>
            )}
        </div>
    );
}
