import type { CloudEvent } from '@slider/shared';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Avatar, cn } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { shownName, useShowExtensions } from '../hooks/useShowExtensions';

/** What an event says after the person's name; `name` is the file or folder, set in bold. */
function sentence(event: CloudEvent): { before: string; after: string } {
  const more = event.more > 0 ? ` und ${event.more} weitere` : '';
  const thing = event.nodeKind === 'folder' ? 'den Ordner ' : '';
  switch (event.kind) {
    case 'uploaded':
      return { before: 'hat ', after: `${more} hochgeladen` };
    case 'version':
      return { before: 'hat eine neue Fassung von ', after: `${more} hochgeladen` };
    case 'folder_created':
      return { before: 'hat den Ordner ', after: ' angelegt' };
    case 'renamed':
      return { before: `hat „${event.detail ?? ''}“ in `, after: ' umbenannt' };
    case 'moved':
      return { before: `hat ${thing}`, after: `${more} nach „${event.detail ?? ''}“ verschoben` };
    case 'copied':
      return { before: `hat ${thing}`, after: `${more} nach „${event.detail ?? ''}“ kopiert` };
    case 'deleted':
      return { before: `hat ${thing}`, after: `${more} gelöscht` };
    case 'restored':
      return { before: `hat ${thing}`, after: `${more} wiederhergestellt` };
    case 'purged':
      return { before: `hat ${thing}`, after: `${more} endgültig gelöscht` };
    case 'shared':
      return { before: `hat ${thing}`, after: ` mit ${event.detail ?? 'jemandem'} geteilt` };
    case 'unshared':
      return {
        before: `hat die Freigabe von ${thing}`,
        after: event.detail ? ` für ${event.detail} entfernt` : ' entfernt',
      };
    case 'link_created':
      return { before: 'hat einen Link zu ', after: ' erstellt' };
    case 'link_removed':
      return { before: 'hat den Link zu ', after: ' entfernt' };
    case 'version_restored':
      return { before: `hat ${event.detail ?? 'eine Fassung'} von `, after: ' wiederhergestellt' };
    case 'version_named':
      return { before: 'hat eine Fassung von ', after: ` „${event.detail ?? ''}“ genannt` };
    case 'area_created':
      return { before: 'hat den Bereich ', after: ' angelegt' };
    case 'area_changed':
      return { before: `hat den Bereich „${event.detail ?? ''}“ in `, after: ' umbenannt' };
    case 'area_people':
      return {
        before: 'hat die Personen im Bereich ',
        after: ` geändert${event.detail ? ` (${event.detail})` : ''}`,
      };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
function dayOf(iso: string, now: Date): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= start.getTime()) return 'Heute';
  if (at >= start.getTime() - DAY_MS) return 'Gestern';
  if (at >= start.getTime() - 6 * DAY_MS) return 'Diese Woche';
  return 'Früher';
}

/**
 * „Aktivität“: who did what, newest first, under the day it happened. A file that is still
 * there opens from its name.
 */
export function ActivityFeed({
  events,
  compact = false,
  empty = 'Noch nichts passiert.',
}: {
  events: readonly CloudEvent[];
  /** In a narrow column: no day headings, smaller avatars. */
  compact?: boolean;
  empty?: string;
}) {
  const ui = useCloud();
  const extensions = useShowExtensions();
  if (events.length === 0) return <p className="py-3 text-body text-fg-subtle">{empty}</p>;
  const now = new Date();
  const days = events.map((event) => dayOf(event.at, now));
  return (
    <ol className="flex flex-col">
      {events.map((event, index) => {
        const day = days[index];
        const heading = !compact && day !== days[index - 1];
        // Names as the lists show them – also the old one of a rename.
        const shown = (name: string) =>
          shownName({ name, kind: event.nodeKind ?? 'other' }, extensions);
        const { before, after } = sentence(
          event.kind === 'renamed' && event.detail
            ? { ...event, detail: shown(event.detail) }
            : event,
        );
        const opens =
          event.nodeId && event.nodeKind && event.kind !== 'deleted' && event.kind !== 'purged';
        const you = event.actor.id === ui.userId;
        return (
          <li key={event.id} className="flex flex-col">
            {heading && (
              <h3 className="pt-4 pb-2 text-caption font-medium tracking-wide text-fg-subtle uppercase first:pt-0">
                {day}
              </h3>
            )}
            <div className={cn('flex items-start gap-3', compact ? 'py-2' : 'py-2.5')}>
              <Avatar author={event.actor} size={compact ? 24 : 28} nativeTitle={false} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-body leading-4.5 text-fg-muted">
                  <span className="font-medium text-fg">{you ? 'Du' : event.actor.name}</span>{' '}
                  {you ? before.replace(/^hat /, 'hast ') : before}
                  {opens ? (
                    <button
                      type="button"
                      className="font-medium text-fg hover:underline"
                      onClick={() =>
                        event.nodeId &&
                        (event.nodeKind === 'folder'
                          ? ui.open({ id: event.nodeId, kind: 'folder' } as never)
                          : ui.openFile(event.nodeId))
                      }
                    >
                      {shown(event.name)}
                    </button>
                  ) : (
                    <span className="font-medium text-fg">{shown(event.name)}</span>
                  )}
                  {after}
                </p>
                <time
                  dateTime={event.at}
                  title={formatDateTime(event.at)}
                  className="text-caption text-fg-subtle"
                >
                  {formatRelativeTime(event.at)}
                </time>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
