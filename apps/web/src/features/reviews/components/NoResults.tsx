import { Button } from '@/ui';
import type { ReviewTab } from '../lib/deck-filters';
import { EmptyState } from './EmptyState';

/** Empty states of the deck list: first run, no search hits, empty tab. */
export function NoResults({
  hasDecks,
  query,
  tab,
  onAdd,
}: {
  hasDecks: boolean;
  query: string;
  tab: ReviewTab;
  /** Missing for reviewers, who can't add decks. */
  onAdd?: () => void;
}) {
  if (!hasDecks) {
    return (
      <EmptyState
        title="Noch keine Präsentationen"
        message={
          onAdd
            ? 'Füge eine Präsentation per Link hinzu oder lade eine Datei hoch, um gemeinsam daran zu arbeiten.'
            : 'In diesem Workspace gibt es noch keine Präsentationen. Sobald jemand eine anlegt, erscheint sie hier.'
        }
        action={
          onAdd && (
            <Button icon="add" onClick={onAdd}>
              Neue Präsentation
            </Button>
          )
        }
      />
    );
  }
  if (query.trim() !== '') {
    return (
      <EmptyState
        title={`Keine Treffer für „${query.trim()}“`}
        message="Versuche einen anderen Suchbegriff."
      />
    );
  }
  const messages: Record<ReviewTab, string> = {
    all: 'Alle Präsentationen sind archiviert.',
    open: 'Keine offenen Kommentare – alles erledigt.',
    archive: 'Archivierte Präsentationen erscheinen hier.',
  };
  return <EmptyState title="Hier ist nichts" message={messages[tab]} />;
}
