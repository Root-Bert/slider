import { useEffect, useEffectEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/app/routes';
import { useDeleteDeck } from '@/lib/queries';
import { Button, cn, GlassPanel, Icon, ProgressBar } from '@/ui';
import { slidesLabel, sourceLabel } from '@/features/reviews/lib/deck-labels';
import { ImportStage, type StagePhase } from './components/ImportStage';
import { importPicture, INTRO_MS, REVEAL_MS } from './lib/import-skeleton';
import { importStatusText, importStepViews, type ImportStepView } from './lib/import-steps';

interface ImportProgressProps {
  deck: Deck;
  /** The real slides' aspect ratios once the deck is ready and the viewer has its data: starts the morph. */
  aspectRatios?: readonly number[] | null;
  /** The morph has finished – the real viewer underneath is all that is left. */
  onRevealed?: () => void;
}

/**
 * A2: shown by the deck page while the import is queued, running or failed (BER-97) – the
 * viewer's layout building itself in placeholders, the progress docked where the first comment
 * would be. Once the deck is ready the deck page mounts the viewer underneath and passes the
 * slides' aspect ratios: the placeholders settle onto the real slides and dissolve into them.
 */
export function ImportProgress({ deck, aspectRatios = null, onRevealed }: ImportProgressProps) {
  const phase = useMorph(aspectRatios !== null, onRevealed);
  return (
    <>
      {phase === 'import' && <title>{`${deck.title} wird importiert · Slider`}</title>}
      <ImportStage
        picture={importPicture(deck.import, deck.slideCount)}
        phase={phase}
        aspectRatios={aspectRatios}
      >
        <GlassPanel tone="elevated" className="p-5">
          {deck.import.status === 'failed' ? (
            <ImportFailed deck={deck} error={deck.import.error} />
          ) : (
            <ImportRunning deck={deck} />
          )}
        </GlassPanel>
      </ImportStage>
    </>
  );
}

const SETTLE_MS = 560;
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

/**
 * `import` until `ready`; then `settle` – at least until the intro has played and the real
 * slides have loaded – then `reveal`, and `onRevealed` once the placeholders are gone.
 */
function useMorph(ready: boolean, onRevealed?: () => void): StagePhase {
  const [mountedAt] = useState(() => performance.now());
  const [revealing, setRevealing] = useState(false);
  const revealed = useEffectEvent(() => onRevealed?.());

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const run = async () => {
      const introLeft = Math.max(0, mountedAt + INTRO_MS - performance.now());
      await Promise.all([sleep(Math.max(SETTLE_MS, introLeft)), slideImagesLoaded()]);
      if (cancelled) return;
      setRevealing(true);
      await sleep(REVEAL_MS);
      if (!cancelled) revealed();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, mountedAt]);

  return !ready ? 'import' : revealing ? 'reveal' : 'settle';
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

function ImportRunning({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const remove = useDeleteDeck();
  const steps = importStepViews(deck.import);

  return (
    <div className="flex flex-col gap-4">
      <DeckHeading deck={deck} />
      <div className="h-px bg-hairline" />
      <ol className="flex flex-col gap-3" aria-label="Import-Fortschritt">
        {steps.map((step) => (
          <ImportStepRow key={step.step} step={step} />
        ))}
      </ol>
      {/* One concise announcement per step change instead of re-reading the whole list. */}
      <p role="status" aria-live="polite" className="sr-only">
        {importStatusText(steps)}
      </p>
      {remove.error && (
        <p role="alert" className="text-xs text-danger">
          {remove.error.message}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-fg-subtle">Dauert meist unter einer Minute.</p>
        <Button
          variant="ghost"
          size="sm"
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(deck.id, { onSuccess: () => void navigate(routes.newReview()) })
          }
        >
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

const STEP_ICONS = {
  done: 'checkCircle',
  current: 'sync',
  pending: 'radioButtonUnchecked',
} as const;

function ImportStepRow({ step }: { step: ImportStepView }) {
  const { status, progress } = step;
  return (
    <li className="flex flex-col gap-2" aria-current={status === 'current' ? 'step' : undefined}>
      <div
        className={cn(
          'flex items-center gap-3 text-[13px]',
          status === 'pending' ? 'text-fg-faint' : 'text-fg',
        )}
      >
        <Icon
          name={STEP_ICONS[status]}
          size={18}
          className={cn('shrink-0', status === 'current' && 'animate-spin [animation-duration:2s]')}
        />
        <span className={cn('flex-1', status === 'current' && 'font-medium')}>
          {step.label}
          {status === 'done' && <span className="sr-only"> – erledigt</span>}
        </span>
        {progress && (
          <span className="text-xs text-fg-subtle tabular-nums">
            {progress.done} / {progress.total}
          </span>
        )}
      </div>
      {progress && progress.total > 0 && (
        <ProgressBar
          value={progress.done / progress.total}
          label={step.label}
          className="ml-[30px]"
        />
      )}
    </li>
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
