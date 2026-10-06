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
      description="Der Review wird mit allen Kommentaren, Zeichnungen, Folienbildern und der hochgeladenen Datei entfernt. Das lässt sich nicht rückgängig machen. Die Original-PowerPoint in OneDrive oder SharePoint bleibt unberührt."
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
