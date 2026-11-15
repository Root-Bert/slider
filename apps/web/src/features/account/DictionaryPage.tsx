import { useState } from 'react';
import type { SpellingWord } from '@slider/shared';
import { useOwnWords, useRemoveSpellingWord } from '@/lib/api';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { WordCollection, WordCollectionSkeleton } from '@/features/workspaces';
import { Button, ConfirmDialog, EmptyState, Icon, Section, useToast } from '@/ui';

/**
 * `/woerterbuch` – „Wörterbuch“ in the account menu: the words one taught the spell check
 * („Passt so“ on a misspelt word), for every deck one opens. Each also went into the deck's
 * workspace („Wörter“ in its Bibliothek), where it stays when deleted here.
 */
export function Component() {
  const [toast, showToast] = useToast();
  const words = useOwnWords();
  const remove = useRemoveSpellingWord(null);
  const [removing, setRemoving] = useState<SpellingWord | null>(null);

  return (
    <SettingsLayout
      docTitle="Wörterbuch | Slider"
      title="Wörterbuch"
      leading={<Icon name="spellcheck" size={32} className="text-fg-muted" />}
      back={{ to: routes.reviews() }}
      toast={toast}
    >
      <Section
        title="Deine Wörter"
        description="Die Rechtschreibprüfung markiert sie in keiner Präsentation. Rechtsklick auf ein markiertes Wort und „Passt so“ nimmt eins auf."
      >
        {words.isPending ? (
          <WordCollectionSkeleton />
        ) : words.isError ? (
          <EmptyState
            title="Wörter konnten nicht geladen werden"
            message={words.error.message}
            action={
              <Button variant="secondary" icon="refresh" onClick={() => void words.refetch()}>
                Erneut versuchen
              </Button>
            }
          />
        ) : words.data.length === 0 ? (
          <p className="text-sm text-fg-subtle">Noch keine Wörter.</p>
        ) : (
          <WordCollection
            words={words.data}
            view="list"
            onRemove={setRemoving}
            onNotify={showToast}
          />
        )}
      </Section>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`„${removing?.word ?? ''}“ löschen?`}
        description="Die Rechtschreibprüfung markiert es dann wieder, außer ein Workspace kennt es."
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          if (!removing) return;
          const { word } = removing;
          setRemoving(null);
          showToast(`„${word}“ gelöscht`);
          remove.mutate(word, { onError: (error) => showToast(error.message, 'danger') });
        }}
      />
    </SettingsLayout>
  );
}
