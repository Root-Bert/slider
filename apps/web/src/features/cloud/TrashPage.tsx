import { useState } from 'react';
import { CLOUD_TRASH_DAYS, searchFold } from '@slider/shared';
import { TrashedDecks } from '@/features/reviews';
import { useTrashedDecks } from '@/lib/api';
import { Button, TextField } from '@/ui';
import { AcrossPage } from './components/AcrossPage';
import { useCloud } from './hooks/useCloud';

/** „Gelöscht“: what was deleted, with where it lay and how long it stays. */
export function Component() {
  const ui = useCloud();
  // Cloud shows everything deleted: the files, and the presentations out of Slider.
  const decks = useTrashedDecks(ui.workspace.id).data ?? [];
  const [query, setQuery] = useState('');
  const needle = searchFold(query.trim());
  const found = decks.filter((deck) => searchFold(deck.title).includes(needle));
  return (
    <AcrossPage
      scope="trash"
      mode="trash"
      title="Gelöscht"
      subtitle={`Gelöschtes bleibt ${CLOUD_TRASH_DAYS} Tage hier und lässt sich so lange wiederherstellen.`}
      query={query}
      lead={
        // In the page, where ⌘F types (`SearchPalette`): nothing opens over it.
        <search data-cloud-search className="block w-88 max-w-full max-sm:w-full">
          <TextField
            type="search"
            icon="search"
            aria-label="Gelöschtes durchsuchen"
            placeholder="Gelöschtes durchsuchen…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                setQuery('');
              }
            }}
          />
        </search>
      }
      actions={(nodes) =>
        nodes.length > 0 && (
          <Button variant="ghost" icon="deleteForever" onClick={ui.emptyTrash}>
            Alles endgültig löschen
          </Button>
        )
      }
      filled={found.length > 0}
      above={(nodes, view) => (
        <TrashedDecks
          workspaceId={ui.workspace.id}
          onNotify={ui.notify}
          query={query}
          view={view === 'tiles' ? 'tiles' : 'list'}
          heading={nodes.length > 0 || decks.length > 0 ? 'Präsentationen' : undefined}
        />
      )}
      empty={{
        icon: 'delete',
        title: 'Nichts gelöscht',
        message: `Was du löschst, liegt hier noch ${CLOUD_TRASH_DAYS} Tage, mit allem, was darin war.`,
      }}
    />
  );
}
