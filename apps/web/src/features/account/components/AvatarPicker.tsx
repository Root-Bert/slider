import type { Author } from '@slider/shared';
import { useUpdateAvatar } from '@/lib/queries';
import { Avatar, Button, IconButton, type ShowToast } from '@/ui';

/**
 * "Profil" → avatar: "Neu würfeln" saves a fresh random seed, "Zurücksetzen" goes back to the
 * avatar seeded by the name. Shows the roll right away, before the save returns.
 */
export function AvatarPicker({
  author,
  seeded,
  onNotify,
}: {
  author: Author;
  /** A re-rolled avatar is set (there is something to reset). */
  seeded: boolean;
  onNotify: ShowToast;
}) {
  const update = useUpdateAvatar();
  const shown = update.isPending ? { ...author, avatarSeed: update.variables } : author;
  const save = (seed: string | null) =>
    update.mutate(seed, {
      onError: () => onNotify('Avatar konnte nicht gespeichert werden.', 'danger'),
    });

  return (
    <div className="flex items-center gap-4">
      <Avatar author={shown} size={64} />
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          onClick={() => save(crypto.randomUUID())}
        >
          Neu würfeln
        </Button>
        {(seeded || (update.isPending && update.variables !== null)) && (
          <IconButton
            icon="undo"
            label="Zurücksetzen"
            size="sm"
            disabled={update.isPending}
            onClick={() => save(null)}
          />
        )}
      </div>
    </div>
  );
}
