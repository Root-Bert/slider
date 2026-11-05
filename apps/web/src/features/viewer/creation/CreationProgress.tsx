import { useEffect, useRef } from 'react';
import { useCancelCreation, useDeckCreation } from '@/lib/api';
import { Button, cn, Icon, ProgressBar, Spinner } from '@/ui';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

/**
 * While the AI builds the deck from the prompt on Folie 1: a panel bottom left in the AI's light
 * – what it does („Folie 4 von 12“), the outline as soon as it is written (the slides built
 * ticked off) and „Abbrechen“ (the slides built stay). Each slide shows on the track as it is
 * done, like any other edit. Done, the deck goes to Folie 1; failed, a toast says why.
 */
export function CreationProgress() {
  const { deck } = useViewerData();
  const creation = useDeckCreation(deck.id, !deck.template).data;
  const cancel = useCancelCreation(deck.id);
  const toast = useViewerToast();
  const goTo = useGoToSlide();

  // The run ending while watched: to Folie 1 when done, the reason when it failed.
  const last = useRef(creation?.status);
  useEffect(() => {
    const before = last.current;
    last.current = creation?.status;
    if (before !== 'running' || !creation || creation.status === 'running') return;
    if (creation.status === 'done') {
      goTo(0);
      toast('Präsentation erstellt');
    } else if (creation.status === 'failed' && creation.error) {
      toast(creation.error, 'danger');
    }
  }, [creation, goTo, toast]);

  if (creation?.status !== 'running') return null;
  const outline = creation.outline;
  const total = outline?.length ?? creation.pages ?? 0;
  return (
    <section
      aria-label="KI erstellt die Präsentation"
      className="glass-elevated fixed bottom-4 left-4 z-(--z-chrome) flex max-h-[min(60vh,520px)] w-[min(360px,calc(100vw-2rem))] flex-col rounded-panel md:bottom-6 md:left-6"
    >
      <span className="ai-rim pointer-events-none absolute -inset-px rounded-[inherit]" />
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <Spinner size={16} label="KI arbeitet" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-body font-medium text-fg">KI erstellt die Präsentation</h2>
          <p aria-live="polite" className="truncate text-xs text-fg-subtle">
            {creation.step ?? 'Arbeitet'}
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={() => cancel.mutate()}>
          Abbrechen
        </Button>
      </div>
      <div className="px-4 pb-3">
        <ProgressBar
          value={outline && total > 0 ? creation.built / total : null}
          label={`${creation.built} von ${total} Folien fertig`}
        />
      </div>
      {outline && (
        <ol className="min-h-0 overflow-y-auto border-t border-hairline px-2 py-2">
          {outline.map((slide, index) => {
            const done = index < creation.built;
            const current = index === creation.built;
            return (
              <li
                key={index}
                className={cn(
                  'flex items-start gap-2.5 rounded-control-sm px-2 py-1.5',
                  current && 'bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'mt-px flex size-4.5 shrink-0 items-center justify-center rounded-full text-tiny tabular-nums',
                    done ? 'text-success' : current ? 'bg-fg text-on-primary' : 'text-fg-subtle',
                  )}
                >
                  {done ? <Icon name="check" size={14} label="Fertig" /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'truncate text-body leading-4.5',
                      done || current ? 'text-fg' : 'text-fg-muted',
                    )}
                  >
                    {slide.title}
                  </span>
                  <span className="truncate text-xs text-fg-subtle">{slide.message}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
