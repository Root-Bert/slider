import { useState } from 'react';
import type { Deck } from '@slider/shared';
import { useUpdateDeck } from '@/lib/queries';
import { Button, Dialog, TextField } from '@/ui';

const MAX_TITLE_LENGTH = 200;

export function RenameDeckDialog({
  deck,
  onClose,
  onRenamed,
}: {
  deck: Deck;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [title, setTitle] = useState(deck.title);
  const update = useUpdateDeck(deck.id);
  const trimmed = title.trim();
  const formId = `rename-${deck.id}`;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Review umbenennen"
      description="Ändert nur den Namen in Slider – die PowerPoint-Datei bleibt unverändert."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={update.isPending}
            disabled={trimmed === '' || trimmed === deck.title}
          >
            Speichern
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed === '') return;
          update.mutate({ title: trimmed }, { onSuccess: onRenamed });
        }}
      >
        <TextField
          label="Name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={MAX_TITLE_LENGTH}
          autoFocus
          required
          error={update.error?.message}
        />
      </form>
    </Dialog>
  );
}
