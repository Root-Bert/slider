import { useMemberDeparture } from '@/lib/api';
import { ErrorText, LoadingState } from '@/ui';

/**
 * What happens to someone's reviews when they leave or are removed (BER-165), in the confirm
 * dialog before: linked ones are deleted – Slider reads their files with that person's accounts,
 * nobody else can update or re-render them – and uploads pass to the workspace owner.
 */
export function DepartureDecks({
  workspaceId,
  userId,
  successor,
  self,
  viewerId,
}: {
  workspaceId: string;
  /** Who goes. */
  userId: string;
  /** Whom a leaving last admin names. */
  successor?: string;
  /** They leave themselves (else an admin removes them). */
  self: boolean;
  /** The signed-in account – "an dich" when they are the heir. */
  viewerId: string;
}) {
  const departure = useMemberDeparture(workspaceId, userId, successor);
  if (departure.isPending) return <LoadingState padding="sm" />;
  if (departure.isError) return <ErrorText>{departure.error.message}</ErrorText>;
  const { deleted, transferred, heir } = departure.data;
  if (deleted.length === 0 && transferred.length === 0) {
    return (
      <p className="text-body text-fg-subtle">
        {self
          ? 'Du hast hier keine eigenen Reviews.'
          : 'Die Person hat hier keine eigenen Reviews.'}
      </p>
    );
  }
  const heirName = heir?.userId === viewerId ? 'dich' : heir?.name;
  return (
    <div className="flex flex-col gap-3">
      {deleted.length > 0 && (
        <DeckList
          label={
            !heir
              ? 'Diese Reviews werden mit allen Kommentaren gelöscht – sonst ist niemand mehr da:'
              : self
                ? 'Diese verknüpften Reviews werden mit allen Kommentaren gelöscht – Slider liest ihre Dateien mit deinen Konten:'
                : 'Diese verknüpften Reviews werden mit allen Kommentaren gelöscht – Slider liest ihre Dateien mit den Konten der Person:'
          }
          decks={deleted}
        />
      )}
      {transferred.length > 0 && heirName && (
        <DeckList label={`Diese hochgeladenen Reviews gehen an ${heirName}:`} decks={transferred} />
      )}
    </div>
  );
}

function DeckList({ label, decks }: { label: string; decks: { id: string; title: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body text-fg-muted">{label}</p>
      <ul
        aria-label={label}
        className="flex max-h-40 list-disc flex-col gap-1 overflow-y-auto pl-4 text-body leading-5 text-fg"
      >
        {decks.map((deck) => (
          <li key={deck.id} className="break-words">
            {deck.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
