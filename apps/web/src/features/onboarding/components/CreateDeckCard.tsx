import { useId, type KeyboardEvent } from 'react';
import { MAX_CREATION_PROMPT_LENGTH, type DeckKind } from '@slider/shared';
import { isModEnter } from '@/lib/keyboard';
import { Button, cn, ErrorText, Icon, Spinner, usePointerSpot } from '@/ui';
import { Sky, SlideStack } from './BlankDeckCard';
import { KindChoice, PagesChoice } from './CreationChoices';

/**
 * „Neue Präsentation“ on top of the page, the featured way in: the welcome page's space (stars,
 * the light from above, the slides fanned out top right, glowing on hover) holding all the AI
 * needs to build the deck – what it is about, the kind, how many slides. „Erstellen“ has the AI
 * build it, „Leer anfangen“ opens it blank in the editor. The template is picked below the card.
 */
export function CreateDeckCard({
  description,
  kind,
  pages,
  byAi,
  onDescription,
  onKind,
  onPages,
  onByAi,
  onCreate,
  onBlank,
  pending,
  error,
}: {
  description: string;
  kind: DeckKind;
  pages: number;
  byAi: boolean;
  onDescription: (description: string) => void;
  onKind: (kind: DeckKind) => void;
  onPages: (pages: number) => void;
  onByAi: (byAi: boolean) => void;
  onCreate: () => void;
  onBlank: () => void;
  /** Which of the two is under way. */
  pending: 'ai' | 'blank' | null;
  error: string | null;
}) {
  const followPointer = usePointerSpot();
  const textId = useId();
  const ready = description.trim().length > 0;
  const busy = pending !== null;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isModEnter(event)) {
      event.preventDefault();
      if (ready && !busy) onCreate();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <section
        aria-label="Neue Präsentation"
        onPointerMove={followPointer}
        className={cn(
          'group hero-glow relative overflow-hidden rounded-panel shadow-card-rest',
          'transition-shadow duration-500 ease-emphasized',
          'hover:shadow-card-glow has-focus-visible:shadow-card-glow',
        )}
      >
        {/* First, so the positioned content after it paints on top. */}
        <Sky />
        <span className="pointer-light pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <span className="pointer-rim pointer-events-none absolute inset-0 rounded-panel opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        {/* The slides, top right beside the heading; on narrow screens there is no room. */}
        <SlideStack className="top-7 right-12 w-36 max-lg:hidden" />

        <div className="relative flex flex-col gap-5 p-6 sm:p-8">
          {/* The page's title says „Neue Präsentation“ already: the card says what to do. */}
          <header className="flex flex-col gap-1.5 lg:min-h-20 lg:pr-56">
            <p className="max-w-md text-base text-fg-muted">
              Beschreibe, worum es geht. Die KI schreibt eine Gliederung und baut die Folien.
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,38rem)]">
            <div className="flex flex-col gap-2">
              <label htmlFor={textId} className="text-xs font-medium text-fg-muted">
                Beschreibung
              </label>
              <textarea
                id={textId}
                value={description}
                onChange={(event) => onDescription(event.target.value)}
                onKeyDown={onKeyDown}
                maxLength={MAX_CREATION_PROMPT_LENGTH}
                placeholder="Worum geht es, für wen ist sie, was soll hängen bleiben?"
                className="field-well focus-field block min-h-28 w-full flex-1 resize-none rounded-control px-3 py-2.5 text-sm leading-5 text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            <KindChoice kind={kind} onChange={onKind} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PagesChoice pages={pages} byAi={byAi} onPages={onPages} onByAi={onByAi} />
            <span className="flex-1" />
            <Button variant="ghost" onClick={onBlank} disabled={busy}>
              {pending === 'blank' && <Spinner size={16} />}
              Leer anfangen
            </Button>
            <button
              type="button"
              onClick={onCreate}
              disabled={!ready || busy}
              title={ready ? undefined : 'Erst beschreiben, worum es geht'}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-control bg-primary px-3.5 text-sm font-medium text-on-primary shadow-glow',
                'transition-[background-color,box-shadow,opacity] duration-150 hover:bg-primary-hover hover:shadow-glow-hover',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:bg-primary',
                pending === 'ai' && 'disabled:cursor-progress disabled:opacity-100',
              )}
            >
              {pending === 'ai' ? <Spinner size={16} /> : <Icon name="autoAwesome" size={18} />}
              Erstellen
            </button>
          </div>
        </div>
      </section>
      {error && (
        <ErrorText role="alert" size="xs">
          {error}
        </ErrorText>
      )}
    </div>
  );
}
