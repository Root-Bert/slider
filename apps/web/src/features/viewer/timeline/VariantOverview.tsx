import { commentWords, type Slide } from '@slider/shared';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useCreateProposal } from '@/lib/api';
import { Button, cn, Icon, IconButton } from '@/ui';
import type { Thread } from '../comments/lib/comment-selectors';
import { useEditing } from '../editing/editing-context';
import { useAskAi } from '../editing/hooks/useAskAi';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import { useTrackDots } from './lib/track-dots';
import { setVariantRequest, useVariantRequest } from './lib/variant-requests';

/** At most this many side by side on a slide's place. */
const PER_PAGE = 4;
/** A touch moving this far sideways is a swipe (as in the presentation). */
const SWIPE_PX = 50;
/** Under each slide: its name and „Verwenden“. */
const CAPTION_PX = 32;
/** Under them all: ‹ 1 / 2 › and „Mit KI mischen“. */
const FOOTER_PX = 36;
/** The AI takes a brief this long at most (`CreateAiProposalInput`). */
const PROMPT_MAX = 4000;

interface Entry {
  slide: Slide;
  label: string;
  /** Its track: 0 the slide, -n its n-th variant. */
  track: number;
}

/** What is said in a thread – a sticker's text with it – its replies after it. */
const said = (thread: Thread): string =>
  [thread.root, ...thread.replies]
    .map((comment) => commentWords(comment).trim())
    .filter(Boolean)
    .join(' / ');

/** Where on the slide a comment sits, as the AI reads it. */
function where(thread: Thread): string {
  const { anchor } = thread.root;
  const at =
    anchor.type === 'point'
      ? anchor.point
      : anchor.type === 'rect'
        ? { x: anchor.rect.x + anchor.rect.w / 2, y: anchor.rect.y + anchor.rect.h / 2 }
        : null;
  return at
    ? ` (bei ${Math.round(at.x * 100)} % von links, ${Math.round(at.y * 100)} % von oben)`
    : '';
}

/** The brief for the mix: what the open comments on each say, the rest as the slide is. */
function mixPrompt(asked: readonly { entry: Entry; threads: Thread[] }[]): string {
  const lines = asked.flatMap(({ entry, threads }) =>
    threads.map((thread) => {
      const which =
        entry.track === 0
          ? 'Auf der Folie selbst'
          : `Auf ${entry.label} (der ${-entry.track}. als Variante dieser Folie markierten Folie)`;
      return `- ${which}${where(thread)}: „${said(thread)}“`;
    }),
  );
  return [
    'Erstelle aus dieser Folie und ihren Varianten eine neue Variante, die sie mischt – so, wie es die Kommentare dazu sagen:',
    ...lines,
    'Wozu nichts gesagt ist, bleibt wie auf der Folie selbst.',
  ]
    .join('\n')
    .slice(0, PROMPT_MAX);
}

/**
 * „Varianten vergleichen“ – on the top track, in a slide's place: the slide and its variants side
 * by side, as large as the place allows (two next to each other, three or four in two rows), at
 * most four at once; more page on with ‹ › or a swipe. Each is the slide itself to review
 * (`frame`: `SlideFrame` with `review`) – a click comments, a dragged box takes a sticker, its
 * cards under the place named „Variante 2“. Under each its name (a click shows it on its track)
 * and „Verwenden“ for a variant (as its badge: it takes the slide's place). „Mit KI mischen“ has
 * the AI make a new variant as the open comments on them say („das Bild von hier“, „die Farben
 * von da“) – at work on the variant track's tile, as „Variante erstellen“.
 */
export function VariantOverview({
  slideId,
  index,
  x,
  w,
  h,
  frame,
}: {
  slideId: string;
  index: number;
  x: number;
  w: number;
  h: number;
  /** One of them as a frame to review, at its place in here. */
  frame: (slide: Slide, place: { x: number; top: number; w: number; h: number }) => ReactNode;
}) {
  const { deck, slides, variantsOf, threadsBySlide } = useViewerData();
  const editing = useEditing();
  const ai = useAskAi();
  const toast = useViewerToast();
  const dispatch = useViewerDispatch();
  const dots = useTrackDots();
  const create = useCreateProposal(deck.id);
  const request = useVariantRequest(slideId);
  const slide = slides[index];
  const variants = variantsOf.get(slideId) ?? [];
  const all: Entry[] = slide
    ? [
        { slide, label: `Folie ${index + 1}`, track: 0 },
        ...variants.map((item, at) => ({
          slide: item,
          label: `Variante ${at + 1}`,
          track: -(at + 1),
        })),
      ]
    : [];
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const [wanted, setPage] = useState(0);
  const page = Math.min(wanted, pages - 1);
  const shown = all.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const step = (by: number) => setPage(Math.max(0, Math.min(pages - 1, page + by)));
  const pointerStart = useRef<number | null>(null);
  const onPointerDown = (event: PointerEvent) => {
    if (pages > 1 && event.pointerType === 'touch') pointerStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    const from = pointerStart.current;
    pointerStart.current = null;
    if (from === null) return;
    const dx = event.clientX - from;
    if (Math.abs(dx) >= SWIPE_PX) step(dx < 0 ? 1 : -1);
  };

  const use = (variantId: string) => {
    const pageId = editing.state?.slides.find((item) => item.slideId === variantId)?.pageId;
    if (!pageId) return;
    void editing
      .apply([{ type: 'useVariant', pageId }])
      .then((ok) => ok && toast('Variante verwendet'));
  };
  const show = (entry: Entry) => {
    dispatch({ type: 'activeSlideChanged', slideId: entry.slide.id });
    dots?.go(entry.track);
  };

  // The mix: from the open comments and stickers on any of them (all pages), for who may ask.
  const canMix = editing.available && ai.available;
  const asked = all
    .map((entry) => ({
      entry,
      threads: (threadsBySlide.get(entry.slide.id) ?? []).filter(
        (thread) => thread.root.status === 'open' && said(thread) !== '',
      ),
    }))
    .filter(({ threads }) => threads.length > 0);
  const mixing = !!request || create.isPending;
  const mix = () => {
    if (asked.length === 0 || mixing) return;
    if (ai.reason) {
      toast(ai.reason);
      return;
    }
    const prompt = mixPrompt(asked);
    create.mutate(
      { variantOf: slideId, prompt },
      {
        onSuccess: (proposal) => setVariantRequest(slideId, { proposalId: proposal.id, prompt }),
        onError: (error) => toast(error.message, 'danger'),
      },
    );
  };

  // Each fitted whole into its cell, its caption under it – nothing over the slide.
  const cols = shown.length === 1 ? 1 : 2;
  const rows = shown.length <= 2 ? 1 : 2;
  const footer = pages > 1 || canMix;
  const gap = Math.max(8, Math.round(h * 0.02));
  const innerH = h - (footer ? FOOTER_PX : 0);
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (innerH - gap * (rows - 1)) / rows - CAPTION_PX;
  const ratio = slide?.aspectRatio ?? 16 / 9;
  const pictureW = Math.max(0, Math.floor(Math.min(cellW, cellH * ratio)));
  const pictureH = Math.round(pictureW / ratio);
  const blockH = rows * (pictureH + CAPTION_PX) + gap * (rows - 1);
  const top0 = Math.max(0, Math.round((innerH - blockH) / 2));
  const places = shown.map((entry, at) => {
    const row = cols === 2 ? Math.floor(at / 2) : 0;
    const col = cols === 2 ? at % 2 : 0;
    const inRow = cols === 2 ? Math.min(2, shown.length - row * 2) : 1;
    // A third alone in its row: centred under the two.
    const left = inRow === 1 ? (w - pictureW) / 2 : col * (cellW + gap) + (cellW - pictureW) / 2;
    return { entry, left: Math.round(x + left), top: top0 + row * (pictureH + CAPTION_PX + gap) };
  });

  return (
    <>
      {places.map(({ entry, left, top }) => (
        <div key={entry.slide.id} data-overview-item={entry.slide.id} className="contents">
          {frame(entry.slide, { x: left, top, w: pictureW, h: pictureH })}
          <div
            className="pointer-events-auto absolute flex items-center gap-2 text-xs text-fg"
            style={{ left, top: top + pictureH, width: pictureW, height: CAPTION_PX }}
          >
            <button
              type="button"
              title={`${entry.label} zeigen`}
              onClick={() => show(entry)}
              className="rounded-badge px-1 py-1 transition-colors hover:bg-hover"
            >
              {entry.label}
            </button>
            <span className="flex-1" />
            {entry.track < 0 && editing.available && (
              <button
                type="button"
                onClick={() => use(entry.slide.id)}
                disabled={editing.busy}
                title="Statt der Folie verwenden"
                className="flex shrink-0 items-center gap-1 rounded-badge px-2 py-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
              >
                <Icon name="compareArrows" size="sm" />
                Verwenden
              </button>
            )}
          </div>
        </div>
      ))}
      {footer && (
        <div
          data-variant-overview={slideId}
          className={cn(
            'pointer-events-auto absolute flex items-center justify-center gap-2 select-none',
            pages > 1 && 'touch-pan-y',
          )}
          style={{ left: x, top: h - FOOTER_PX, width: w, height: FOOTER_PX }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (pointerStart.current = null)}
        >
          {pages > 1 && (
            <>
              <IconButton
                icon="chevronLeft"
                label="Vorherige Varianten"
                size="sm"
                disabled={page === 0}
                onClick={() => step(-1)}
              />
              <span className="text-xs text-fg-muted tabular-nums">
                {page + 1} / {pages}
              </span>
              <IconButton
                icon="chevronRight"
                label="Weitere Varianten"
                size="sm"
                disabled={page === pages - 1}
                onClick={() => step(1)}
              />
            </>
          )}
          {canMix && (
            <Button
              size="sm"
              variant={asked.length > 0 ? 'primary' : 'soft'}
              icon="autoAwesome"
              loading={mixing}
              disabled={asked.length === 0 || mixing}
              title={
                asked.length > 0
                  ? 'Neue Variante, wie es die Kommentare auf den Folien sagen'
                  : 'Kommentiere auf den Folien, was du von welcher übernehmen willst'
              }
              onClick={mix}
            >
              {mixing ? 'KI mischt …' : 'Mit KI mischen'}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
