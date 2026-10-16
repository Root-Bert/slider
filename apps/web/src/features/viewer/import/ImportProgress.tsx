import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/lib/routes';
import { useDeleteDeck } from '@/lib/api';
import { Button, cn, GlassPanel, Icon } from '@/ui';
import { slidesLabel, sourceLabel } from '@/lib/deck-labels';
import { ImportStage, type StagePhase } from './ImportStage';
import {
  importPicture,
  landsAt,
  PRINT_CASCADE_MAX,
  PRINT_MS,
  PRINT_STAGGER,
  printedPicture,
  REVEAL_MS,
} from './lib/import-skeleton';
import { importStatusText, importStepViews } from './lib/import-steps';

interface ImportProgressProps {
  deck: Deck;
  /** The real slides' aspect ratios once the deck is ready and the viewer has its data: starts the morph. */
  aspectRatios?: readonly number[] | null;
  /** The deck is ready and every slide has printed: time to mount the viewer underneath. */
  onPrinted?: () => void;
  /** The morph has finished – the real viewer underneath is all that is left. */
  onRevealed?: () => void;
}

/**
 * A2: shown by the deck page while the import is queued, running or failed (BER-97) – the
 * viewer's layout building itself in placeholders, one per slide once the import has counted
 * them; only a failure docks a card where the first comment would be. Once the deck is ready the
 * deck page mounts the viewer underneath and passes the slides' aspect ratios: the placeholders
 * settle onto the real slides and dissolve into them, one after another.
 */
export function ImportProgress({
  deck,
  aspectRatios = null,
  onPrinted,
  onRevealed,
}: ImportProgressProps) {
  const imported = importPicture(deck.import, deck.slideCount);
  const countedAt = useCountedAt(imported.count !== null);
  const printed = usePrinted(imported.count === null ? 0 : imported.rendered, countedAt);
  const picture = printedPicture(imported, printed);
  const allPrinted = printed >= (imported.count ?? 0);
  // The viewer mounts only now: its first render and slide images would stall the prints.
  const printedReady = allPrinted && deck.import.status === 'ready';
  const notifyPrinted = useEffectEvent(() => onPrinted?.());
  useEffect(() => {
    if (printedReady) notifyPrinted();
  }, [printedReady]);
  const { phase, dissolved } = useMorph(aspectRatios !== null, allPrinted, onRevealed);
  return (
    <>
      {phase === 'import' && <title>{`${deck.title} wird importiert · Slider`}</title>}
      <p role="status" aria-live="polite" className="sr-only">
        {importStatusText(importStepViews(deck.import))}
      </p>
      <ImportStage
        picture={picture}
        phase={phase}
        aspectRatios={aspectRatios}
        onDissolved={dissolved}
      >
        {deck.import.status === 'failed' && (
          <GlassPanel tone="elevated" className="p-5">
            <ImportFailed deck={deck} error={deck.import.error} />
          </GlassPanel>
        )}
      </ImportStage>
    </>
  );
}

/** Settling: the camera's pan home (900 ms) and the last print (`PRINT_MS`) both end within it. */
const SETTLE_MS = Math.max(920, PRINT_MS + 200);
/** Longest wait for the real slide images before dissolving into them anyway. */
const IMAGE_WAIT_MS = 2000;
/** The viewer fades a slide image in once it has loaded. */
const IMAGE_FADE_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves once the real track's slide images in view have loaded (or failed), at most `IMAGE_WAIT_MS`. */
async function slideImagesLoaded(): Promise<void> {
  // The track lays its slides out once it has measured itself: give it a frame.
  await sleep(32);
  const images = [...document.querySelectorAll<HTMLImageElement>('[data-track] img')].filter(
    (image) => image.getBoundingClientRect().left < window.innerWidth,
  );
  const pending = images
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }),
    );
  return Promise.race([
    Promise.all(pending).then(() => sleep(pending.length > 0 ? IMAGE_FADE_MS : 0)),
    sleep(IMAGE_WAIT_MS),
  ]);
}

/** When the import first counted the slides – the moment the placeholders are dealt in. */
function useCountedAt(counted: boolean): number | null {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!counted || at !== null) return;
    const frame = requestAnimationFrame(() => setAt(performance.now()));
    return () => cancelAnimationFrame(frame);
  }, [counted, at]);
  return at;
}

/**
 * How many slides the stage shows rendered: follows `rendered` one slide at a time, each once its
 * placeholder has landed and at least `PRINT_STAGGER` after the one before – a burst of progress
 * (or the import finishing at once) prints left to right instead of flipping every placeholder.
 */
function usePrinted(rendered: number, countedAt: number | null): number {
  const [printed, setPrinted] = useState(0);
  useEffect(() => {
    if (countedAt === null || printed >= rendered) return;
    // Far behind (a long deck finished at once): catch up to the last few, which still cascade.
    const next = Math.max(printed + 1, rendered - PRINT_CASCADE_MAX + 1);
    const wait = Math.max(PRINT_STAGGER, countedAt + landsAt(next - 1) - performance.now());
    const timer = setTimeout(() => setPrinted(next), wait);
    return () => clearTimeout(timer);
  }, [printed, rendered, countedAt]);
  return Math.min(printed, rendered);
}

/**
 * `import` until `ready`; then `settle` – until every slide has printed, the camera is home and
 * the real slides have loaded – then
 * `reveal`, and `onRevealed` once the stage reports its placeholders dissolved (`dissolved`).
 */
function useMorph(
  ready: boolean,
  allPrinted: boolean,
  onRevealed?: () => void,
): { phase: StagePhase; dissolved: () => void } {
  const [revealing, setRevealing] = useState(false);
  const latest = useRef(onRevealed);
  useEffect(() => {
    latest.current = onRevealed;
  });
  // Once only: from the stage's dissolve, or from the fallback timer.
  const done = useRef(false);
  const revealed = useCallback(() => {
    if (done.current) return;
    done.current = true;
    latest.current?.();
  }, []);

  useEffect(() => {
    if (!ready || !allPrinted) return;
    let cancelled = false;
    const run = async () => {
      // The last print fades in and the camera is home (both settle within `SETTLE_MS`), then
      // the placeholders dissolve – every one of them has landed, it printed only after that.
      await Promise.all([sleep(SETTLE_MS), slideImagesLoaded()]);
      if (cancelled) return;
      setRevealing(true);
      // The stage reports the dissolve's end; this only guards against a missed event.
      await sleep(REVEAL_MS + 400);
      if (!cancelled) revealed();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, allPrinted, revealed]);

  const phase = !ready ? 'import' : revealing ? 'reveal' : 'settle';
  return { phase, dissolved: revealed };
}

function DeckHeading({ deck, failed = false }: { deck: Deck; failed?: boolean }) {
  const meta = [
    sourceLabel(deck.source),
    deck.owner.name,
    deck.slideCount > 0 ? slidesLabel(deck.slideCount) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-control',
          failed ? 'bg-danger/15 text-danger' : 'bg-white/10 text-fg-muted',
        )}
      >
        <Icon name={failed ? 'error' : 'description'} size={20} />
      </span>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-[15px] font-semibold text-fg">{deck.fileName}</h1>
        <p className="truncate text-xs text-fg-subtle">{meta}</p>
      </div>
    </div>
  );
}

function ImportFailed({ deck, error }: { deck: Deck; error: string }) {
  const navigate = useNavigate();
  const remove = useDeleteDeck();

  return (
    <div className="flex flex-col gap-4">
      <DeckHeading deck={deck} failed />
      <div role="alert" className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-fg">Import fehlgeschlagen</h2>
        <p className="text-[13px] text-fg-subtle">{error}</p>
        {remove.error && <p className="text-xs text-danger">{remove.error.message}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(deck.id, { onSuccess: () => void navigate(routes.reviews()) })
          }
        >
          Entfernen
        </Button>
        <Button size="sm" icon="upload" onClick={() => void navigate(routes.newReview())}>
          Andere Datei hochladen
        </Button>
      </div>
    </div>
  );
}
