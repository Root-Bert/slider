import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/app/routes';
import { useDeleteDeck } from '@/lib/queries';
import { Button, cn, Icon, ProgressBar } from '@/ui';
import { slidesLabel, sourceLabel } from '@/features/reviews/lib/deck-labels';
import { importStatusText, importStepViews, type ImportStepView } from './lib/import-steps';

/**
 * A2: shown by the deck page while the import is queued, running or failed (BER-97).
 * Purely presentational – the deck page polls `useDeck` and re-renders this with fresh state.
 */
export function ImportProgress({ deck }: { deck: Deck }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas p-4">
      <title>{`${deck.title} wird importiert · Slider`}</title>
      <ViewerSkeleton />
      <div className="glass-elevated relative w-full max-w-[420px] animate-pop-in rounded-panel p-5">
        {deck.import.status === 'failed' ? (
          <ImportFailed deck={deck} error={deck.import.error} />
        ) : (
          <ImportRunning deck={deck} />
        )}
      </div>
    </div>
  );
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

/** Dimmed outline of the viewer (stage, side panel, filmstrip) so the page doesn't jump once ready. */
function ViewerSkeleton() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex flex-col gap-4 p-4 opacity-60 md:p-6"
    >
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex flex-1 flex-col gap-4 rounded-panel bg-[#111] p-8">
          <div className="skeleton h-8 w-1/3 rounded-md" />
          <div className="skeleton h-3 w-1/4 rounded" />
          <div className="mt-auto grid grid-cols-3 gap-4">
            <div className="skeleton h-20 rounded-md" />
            <div className="skeleton h-20 rounded-md" />
            <div className="skeleton h-20 rounded-md" />
          </div>
        </div>
        <div className="hidden w-60 rounded-panel bg-[#111] lg:block" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="skeleton aspect-video w-20 shrink-0 rounded-thumb md:w-24" />
        ))}
      </div>
    </div>
  );
}
