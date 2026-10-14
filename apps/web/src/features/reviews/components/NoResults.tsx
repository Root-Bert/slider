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
        title="Noch keine Reviews"
        message={
          onAdd
            ? 'Füge eine PowerPoint per OneDrive- oder SharePoint-Link hinzu oder lade eine PPTX hoch – Feedback landet direkt auf der Folie.'
            : 'In dieser Organisation gibt es noch keine Präsentationen. Sobald jemand eine hinzufügt, erscheint sie hier.'
        }
        action={
          onAdd && (
            <Button icon="add" onClick={onAdd}>
              Präsentation hinzufügen
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
    all: 'Alle Reviews sind archiviert.',
    open: 'Keine offenen Kommentare – alles erledigt.',
    archive: 'Archivierte Reviews erscheinen hier.',
  };
  return <EmptyState title="Hier ist nichts" message={messages[tab]} />;
}
