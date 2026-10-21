import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/lib/routes';
import { useDeleteDeck } from '@/lib/api';
import { motionMs } from '@/lib/motion';
import { Button, ErrorText, GlassPanel, Icon, IconTile } from '@/ui';
import { slidesLabel, sourceLabel } from '@/lib/deck-labels';
import { ImportStage, type StagePhase } from './ImportStage';
import type { ViewerOpening } from './stage/GhostControls';
import {
  BUILD_MS,
  HOME_MS,
  importPicture,
  REVEAL_MS,
  tourDwell,
  tourPicture,
  tourPrintAt,
} from './lib/import-skeleton';
import { importStatusText, importStepViews } from './lib/import-steps';
import { isDeckLinked } from '../state/revision-data';

interface ImportProgressProps {
  deck: Deck;
  /** The real slides' aspect ratios once the deck is ready and the viewer has its data: starts the morph. */
  aspectRatios?: readonly number[] | null;
  /** What the viewer will open with, once it has its data – the stage's controls row shows it. */
  opening?: ViewerOpening | null;
  /** The deck is ready and every slide has printed: time to mount the viewer underneath. */
  onPrinted?: () => void;
  /** The morph has finished – the real viewer underneath is all that is left. */
  onRevealed?: () => void;
}

/**
 * A2: shown by the deck page while the import is queued, running or failed (BER-97) – the
 * viewer's layout building itself in placeholders, one per slide once the import has counted
 * them; only a failure docks a card where the first comment would be. While the import runs the
 * stage tours the deck slide by slide (`useTour`). Once the deck is ready the slide at work
 * finishes, the camera glides home, the deck page mounts the viewer underneath and passes the
 * slides' aspect ratios – and after a moment of rest the real slides appear and the stage leaves.
 */
export function ImportProgress({
  deck,
  aspectRatios = null,
  opening = null,
  onPrinted,
  onRevealed,
}: ImportProgressProps) {
  const imported = importPicture(deck.import, deck.slideCount);
  const done = deck.import.status === 'ready';
  const [shownAt] = useState(() => performance.now());
  const countedAt = useCountedAt(imported.count !== null);
  const printed = useTour(shownAt, countedAt, imported.count, done);
  const picture = tourPicture(imported, printed, done);
  // The viewer mounts once the camera is home: its first render and slide images would make the
  // glide stutter.
  const home = useHome(done);
  const notifyPrinted = useEffectEvent(() => onPrinted?.());
  useEffect(() => {
    if (home) notifyPrinted();
  }, [home]);
  const { phase, dissolved } = useMorph(aspectRatios !== null, onRevealed);
  return (
    <>
      {phase === 'import' && <title>{`${deck.title} wird importiert | Slider`}</title>}
      <p role="status" aria-live="polite" className="sr-only">
        {importStatusText(importStepViews(deck.import))}
      </p>
      <ImportStage
        picture={picture}
        phase={phase}
        aspectRatios={aspectRatios}
        done={done}
        viewer={{
          canComment: deck.permissions.canComment,
          // Like `UploadRevisionControl`: whoever manages an uploaded (not linked) deck.
          canUpload: deck.permissions.canManage && !isDeckLinked(deck),
          opening,
        }}
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

/** Settled: the last sketch has built up, the viewer is up underneath – a moment of rest. */
const REST_MS = Math.max(500, BUILD_MS - HOME_MS + 300);
/** Longest wait for the real slide images before revealing them anyway. */
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
    Promise.all(pending).then(() => sleep(pending.length > 0 ? motionMs(IMAGE_FADE_MS) : 0)),
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
 * How many slides the tour has printed: one more every `tourDwell` (`tourPrintAt`) – until all
 * are, or the import is done. Then the slide at work still prints (its build-up ends in a print,
 * not in a cut) and the tour stops: nothing is caught up at the end.
 */
function useTour(
  shownAt: number,
  countedAt: number | null,
  count: number | null,
  done: boolean,
): number {
  const [printed, setPrinted] = useState(0);
  const [stopped, setStopped] = useState(false);
  if (done && !stopped) {
    setStopped(true);
    // Once the slides are counted, one is at work – also when the count and `done` arrive
    // together (a quick import) and the tour never got to start: else nothing would print.
    if (count !== null) setPrinted((value) => Math.min(count, value + 1));
  }
  useEffect(() => {
    if (stopped || countedAt === null || count === null || printed >= count) return;
    const nextAt = tourPrintAt(printed, shownAt, countedAt, tourDwell(count));
    const timer = setTimeout(
      () => setPrinted(printed + 1),
      Math.max(0, nextAt - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [stopped, shownAt, countedAt, count, printed]);
  return printed;
}

/** True once the import is done and the camera has glided home. */
function useHome(done: boolean): boolean {
  const [home, setHome] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setHome(true), motionMs(HOME_MS));
    return () => clearTimeout(timer);
  }, [done]);
  return home;
}

/**
 * `import` until the viewer is up underneath (`ready`: its slides' aspect ratios are in); then
 * `settle` – the placeholders take the real slides' sizes, the last print finishes, the real
 * slides load, a moment of rest – then `reveal`: the real slides appear, the stage leaves, and
 * `onRevealed` once it reports that over (`dissolved`).
 */
function useMorph(
  ready: boolean,
  onRevealed?: () => void,
): { phase: StagePhase; dissolved: () => void } {
  const [revealing, setRevealing] = useState(false);
  const latest = useRef(onRevealed);
  useEffect(() => {
    latest.current = onRevealed;
  });
  // Once only: from the stage's fade, or from the fallback timer.
  const done = useRef(false);
  const revealed = useCallback(() => {
    if (done.current) return;
    done.current = true;
    latest.current?.();
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const run = async () => {
      await Promise.all([sleep(motionMs(REST_MS)), slideImagesLoaded()]);
      if (cancelled) return;
      setRevealing(true);
      // The stage reports the fade's end; this only guards against a missed event.
      await sleep(REVEAL_MS + 400);
      if (!cancelled) revealed();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, revealed]);

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
    .join(' | ');
  return (
    <div className="flex items-center gap-3">
      <IconTile size={40} tone={failed ? 'danger' : 'muted'} tint="hover">
        <Icon name={failed ? 'error' : 'description'} size="xl" />
      </IconTile>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-base font-semibold text-fg">{deck.fileName}</h1>
        <p className="truncate text-xs text-fg-subtle">{meta}</p>
      </div>
    </div>
  );
}

export function ImportFailed({ deck, error }: { deck: Deck; error: string }) {
  const navigate = useNavigate();
  const remove = useDeleteDeck();
  // Removing it or uploading another file is for whoever may manage the deck; everyone else
  // (reviewers, viewers, other members) is told who can.
  const { canManage } = deck.permissions;

  return (
    <div className="flex flex-col gap-4">
      <DeckHeading deck={deck} failed />
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
            Entfernen
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
    </div>
  );
}
