import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/lib/routes';
import { useDeleteDeck } from '@/lib/api';
import { slidesLabel, sourceLabel } from '@/lib/deck-labels';
import { Button, ErrorText, GlassPanel, Icon, IconTile } from '@/ui';

/** The deck page of a deck whose import failed: why, and – for whoever manages it – what next. */
export function ImportFailed({ deck, error }: { deck: Deck; error: string }) {
  const navigate = useNavigate();
  const remove = useDeleteDeck();
  // Deleting it or uploading another file is for whoever may manage the deck; everyone else
  // (reviewers, viewers, other members) is told who can.
  const { canManage } = deck.permissions;
  const meta = [
    sourceLabel(deck.source),
    deck.owner.name,
    deck.slideCount > 0 ? slidesLabel(deck.slideCount) : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center px-4">
      <title>{`${deck.title} | Slider`}</title>
      <GlassPanel tone="elevated" className="flex w-full max-w-[480px] flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <IconTile size={40} tone="danger" tint="hover">
            <Icon name="error" size="xl" />
          </IconTile>
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-base font-semibold text-fg">{deck.fileName}</h1>
            <p className="truncate text-xs text-fg-subtle">{meta}</p>
          </div>
        </div>
        <div role="alert" className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-fg">Import fehlgeschlagen</h2>
          <p className="text-body text-fg-subtle">{error}</p>
          {!canManage && (
            <p className="text-body text-fg-subtle">
              Bitte {deck.owner.name}, die Präsentation erneut hochzuladen.
            </p>
          )}
          {remove.error && <ErrorText size="xs">{remove.error.message}</ErrorText>}
        </div>
        {canManage && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(deck.id, {
                  onSuccess: () => void navigate(routes.workspace(deck.workspaceId)),
                })
              }
            >
              Löschen
            </Button>
            {/* Into the deck's workspace – not whichever one was used last. */}
            <Button
              size="sm"
              icon="upload"
              onClick={() => void navigate(routes.newReview(deck.workspaceId))}
            >
              Andere Datei hochladen
            </Button>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
