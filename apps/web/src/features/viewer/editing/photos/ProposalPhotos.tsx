import {
  stockPhotoUrl,
  type AiProposal,
  type DeckEditState,
  type Rect,
  type StockPhoto,
} from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useChooseProposalPhoto, useDeckEdit } from '@/lib/api';
import { cn } from '@/ui';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { PhotoCredit } from './PhotoCredit';
import { photoPreviews } from './photo-previews';

/** Clicks through the photos send only where they stop. */
const SEND_AFTER_MS = 450;
const THUMB_HEIGHT = 44;

/**
 * The AI's stock photo in its thread (BER-183): who took it, and – for who may edit – the others
 * it would take, one click each. The photo shows in its frame at once (Unsplash's picture over
 * the slide); the server puts it into the file behind, only the last of quick clicks.
 */
export function ProposalPhotos({
  proposal,
  photos,
}: {
  proposal: AiProposal;
  photos: NonNullable<AiProposal['photos']>;
}) {
  const { deck, canManage } = useViewerData();
  const toast = useViewerToast();
  const choose = useChooseProposalPhoto(deck.id);
  const switchable = canManage && proposal.status === 'applied' && photos.candidates.length > 1;
  const edit = useDeckEdit(deck.id, switchable);
  const [picked, setPicked] = useState<string | null>(null);
  // The server caught up with the click.
  if (picked !== null && picked === photos.chosenId) setPicked(null);
  const shownId = picked ?? photos.chosenId;
  const shown = photos.candidates.find((photo) => photo.id === shownId) ?? photos.candidates[0];

  // Where the frame is, for showing a choice at once.
  const frame = frameOf(edit.data?.slides, photos.elementId);

  const timer = useRef<number | undefined>(undefined);
  const wanted = useRef<string | null>(null);
  const sending = useRef(false);
  const preview = useRef<{ slideId: string; key: number } | null>(null);

  const send = () => {
    const photoId = wanted.current;
    if (sending.current || !photoId) return;
    wanted.current = null;
    sending.current = true;
    choose
      .mutateAsync({ proposalId: proposal.id, photoId })
      .then(() => {
        const current = preview.current;
        if (!wanted.current && current) photoPreviews.settle(current.slideId, current.key);
      })
      .catch((error: unknown) => {
        toast(
          error instanceof Error ? error.message : 'Das Foto ließ sich nicht tauschen.',
          'danger',
        );
        setPicked(null);
        const current = preview.current;
        if (current) photoPreviews.clear(current.slideId, current.key);
        wanted.current = null;
      })
      .finally(() => {
        sending.current = false;
        if (wanted.current) send();
      });
  };

  // A choice not sent yet still goes when the card leaves.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      send();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on unmount only
    [],
  );
  const pick = (photo: StockPhoto) => {
    if (photo.id === shownId) return;
    setPicked(photo.id);
    if (frame) {
      const width = Math.min(1600, Math.max(400, frame.rect.w * 1600));
      const key = photoPreviews.show(
        frame.slideId,
        frame.rect,
        stockPhotoUrl(photo, width, photos.aspect),
      );
      preview.current = { slideId: frame.slideId, key };
    }
    wanted.current = photo.id;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(send, SEND_AFTER_MS);
  };

  const aspect = Math.min(2, Math.max(0.6, photos.aspect ?? 1.5));
  return (
    <div className="flex flex-col gap-1.5" data-proposal-photos="">
      {switchable && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fotos zur Auswahl">
          {photos.candidates.map((photo, index) => {
            const active = photo.id === shownId;
            return (
              <button
                key={photo.id}
                type="button"
                aria-pressed={active}
                aria-label={`Foto ${index + 1} von ${photo.credit.name}`}
                title={photo.description ?? `Foto von ${photo.credit.name}`}
                onClick={() => pick(photo)}
                className={cn(
                  'relative overflow-hidden rounded-thumb outline-none transition-shadow',
                  'focus-visible:ring-2 focus-visible:ring-fg/60',
                  active ? 'ring-2 ring-fg' : 'opacity-75 hover:opacity-100',
                )}
                style={{
                  height: THUMB_HEIGHT,
                  width: Math.round(THUMB_HEIGHT * aspect),
                  backgroundColor: photo.color ?? undefined,
                }}
              >
                <img
                  src={stockPhotoUrl(photo, 200, photos.aspect)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
      {shown && <PhotoCredit credit={shown.credit} />}
    </div>
  );
}

function frameOf(
  slides: readonly DeckEditState['slides'][number][] | undefined,
  elementId: string | null,
): { slideId: string; rect: Rect } | null {
  if (!elementId) return null;
  for (const slide of slides ?? []) {
    const element = slide.elements.find((item) => item.id === elementId);
    if (element) return { slideId: slide.slideId, rect: element.bbox };
  }
  return null;
}
