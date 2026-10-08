import { EmptyState } from './EmptyState';

/** Empty states of "Mit mir geteilt": nothing shared yet, no search hits, empty tab. */
export function SharedEmpty({ hasDecks, query }: { hasDecks: boolean; query: string }) {
  if (!hasDecks) {
    return (
      <EmptyState
        title="Noch nichts geteilt"
        message="Sobald jemand in einer deiner Organisationen eine Präsentation hinzufügt, erscheint sie hier."
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
  return <EmptyState title="Hier ist nichts" message="In diesem Tab gibt es keine Reviews." />;
}
