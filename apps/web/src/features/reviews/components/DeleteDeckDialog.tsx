import type { Deck } from '@slider/shared';
import { useDeleteDeck } from '@/lib/queries';
import { Button, Dialog } from '@/ui';

export function DeleteDeckDialog({
  deck,
  onClose,
  onDeleted,
}: {
  deck: Deck;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useDeleteDeck();

  return (
    <Dialog
      open
      onClose={onClose}
      title={`„${deck.title}“ löschen?`}
      description={
        <div className="flex flex-col gap-2">
          <span>Wird endgültig entfernt:</span>
          <ul className="list-disc pl-5">
            <li>Kommentare und Zeichnungen</li>
            <li>Folienbilder</li>
            <li>Hochgeladene Datei</li>
          </ul>
          <span>Original in OneDrive/SharePoint bleibt.</span>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            icon="delete"
            loading={remove.isPending}
            onClick={() => remove.mutate(deck.id, { onSuccess: onDeleted })}
          >
            Endgültig löschen
          </Button>
        </>
      }
    >
      {remove.error && (
        <p role="alert" className="text-[13px] text-danger">
          {remove.error.message}
        </p>
      )}
    </Dialog>
  );
}
