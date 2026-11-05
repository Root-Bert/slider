import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  boardSchema,
  DECK_KINDS,
  DEFAULT_DECK_KIND,
  MAX_CREATED_SLIDES,
  MAX_CREATION_PROMPT_LENGTH,
  MIN_CREATED_SLIDES,
  type DeckKind,
} from '@slider/shared';
import { useHeardWords } from '../voice/hooks/useHeardWords';
import {
  clearCreationDraft,
  loadCreationDraft,
  saveCreationDraft,
  type CreationDraft,
} from './creation-draft';
import { MasterChoice } from '@/features/onboarding';
import { api } from '@/lib/api-client';
import { queryKeys, useDismissCreation, useStartCreation, useWorkspaceMasters } from '@/lib/api';
import { isModEnter } from '@/lib/keyboard';
import { smoothScroll } from '@/lib/motion';
import {
  Button,
  cn,
  Icon,
  IconButton,
  NumberField,
  TextLink,
  useFocusLoop,
  type IconName,
} from '@/ui';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

const KIND_ICONS: Record<DeckKind, IconName> = {
  school: 'article',
  pitch: 'arrowUpward',
  consulting: 'compareArrows',
  brand: 'localOffer',
  sales: 'send',
  status: 'checkCircleOutline',
  training: 'draw',
  keynote: 'mic',
};

const pagesOf = (kind: DeckKind) => DECK_KINDS.find((each) => each.id === kind)?.pages ?? 10;

/**
 * Folie 1 of a new deck while it is still blank: a large window on the slide to have the AI
 * build the deck – what it is about, the kind (8 cards, one picked), the workspace's template,
 * how many slides – and how much material lies on Folie 0 (always read, never a switch).
 * „Erstellen“ starts the run (the window closes at once, the progress shows), „Leer anfangen“
 * closes it for good.
 */
export function CreatePrompt({
  x,
  w,
  h,
  templateId,
}: {
  x: number;
  w: number;
  h: number;
  /** The template picked to begin with: the one the deck is made from, if any. */
  templateId: string | null;
}) {
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const registry = useStageRegistry();
  const start = useStartCreation(deck.id);
  const dismiss = useDismissCreation(deck.id);
  const masters =
    useWorkspaceMasters(deck.workspaceId).data?.filter((master) => master.format === 'odp') ?? [];
  const board = useQuery({
    queryKey: queryKeys.board(deck.id),
    queryFn: async () => boardSchema.parse(await api.get(`/decks/${deck.id}/board`)),
    networkMode: 'always',
  }).data;

  // What is typed here is kept per deck in the browser – the window goes and comes back (the
  // editor, the track scrolled away, a reload) with it – until „Erstellen“ or „Leer anfangen“.
  const [draft, setDraft] = useState(() => loadCreationDraft(deck.id));
  const change = (next: Partial<CreationDraft>) => setDraft((now) => ({ ...now, ...next }));
  useEffect(() => saveCreationDraft(deck.id, draft), [deck.id, draft]);
  const description = draft.description;
  const setDescription = (update: (now: string) => string) =>
    setDraft((now) => ({ ...now, description: update(now.description) }));
  const kind = draft.kind ?? DEFAULT_DECK_KIND;
  // The kind's suggestion until a number is typed.
  const shownPages = draft.pages ?? pagesOf(kind);
  // The deck's own template first; one removed meanwhile falls back to none.
  const wanted = draft.templateId ?? templateId ?? '';
  const masterId = masters.some((master) => master.id === wanted) ? wanted : '';

  // Speaking to the AI while the window is open: what is said goes into the description, live –
  // never to the session (the AI must not act on the deck meanwhile).
  const { voice, listening, lit } = useHeardWords(setDescription, { claim: 'strict' });
  const canSpeak = !!deck.ai?.available;
  const speakingOn = voice.status === 'listening' || voice.status === 'paused';
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusLoop(panelRef);
  const kindsId = useId();
  const textId = useId();

  const files = board?.materials ?? [];
  const reading = files.filter((file) => file.readState === 'pending').length;
  const items = board?.items.length ?? 0;
  const materialLine =
    files.length + items === 0
      ? 'Noch kein Material da.'
      : `Die KI nutzt das Material auf Folie 0: ${[
          files.length > 0 && `${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'}`,
          items > 0 && `${items} ${items === 1 ? 'Notiz oder Link' : 'Notizen und Links'}`,
        ]
          .filter(Boolean)
          .join(
            ', ',
          )}.${reading > 0 ? ` ${reading === 1 ? 'Eine Datei wird' : `${reading} Dateien werden`} noch gelesen, die KI wartet darauf.` : ''}`;

  const ready = description.trim().length > 0;
  const create = () => {
    if (!ready || start.isPending) return;
    start.mutate(
      {
        description: description.trim(),
        kind,
        pages: shownPages,
        templateId: masterId || null,
      },
      {
        // Not before the server took it: refused, the window comes back with it.
        onSuccess: () => clearCreationDraft(deck.id),
        onError: (error) => toast(error.message, 'danger'),
      },
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isModEnter(event)) {
      event.preventDefault();
      create();
    }
  };

  const toBoard = () => {
    registry.endProgrammaticScroll();
    registry.scrollTrackTo(0, smoothScroll());
    document
      .querySelector<HTMLElement>('[data-material-board] [tabindex]')
      ?.focus({ preventScroll: true });
  };

  // The slide itself is the window: its whole area, no card in it. Too small for everything, the
  // middle scrolls – the text never shrinks – and the actions stay bottom right.
  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Präsentation mit KI erstellen"
      data-create-prompt
      data-own-wheel
      className="@container absolute top-0 z-(--z-raised) flex flex-col overflow-hidden rounded-panel bg-glass-solid text-fg"
      // Picked tiles and cards look as on Neue Präsentation, not in the viewer's own colour.
      style={
        {
          left: x,
          width: w,
          height: h,
          '--selection': 'initial',
          '--on-selection': 'initial',
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pt-6 pb-4 @3xl:px-10 @3xl:pt-9">
        <header className="flex shrink-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg">
            <Icon name="autoAwesome" size={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-fg">Präsentation mit KI erstellen</h2>
            <p className="text-body text-fg-subtle">
              Beschreibe, worum es geht. Die KI schreibt eine Gliederung und baut die Folien.
            </p>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-6 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-h-56 flex-col gap-2">
            <label htmlFor={textId} className="text-xs font-medium text-fg-muted">
              Beschreibung
            </label>
            <div
              className="field-well focus-field relative flex min-h-40 flex-1 items-start gap-1 rounded-control py-2.5 pr-1.5 pl-3"
              // Listening: the AI box's sage edge – the words said land here.
              style={
                speakingOn
                  ? {
                      boxShadow:
                        'inset 0 0 0 1px color-mix(in srgb, var(--color-sage) 55%, transparent), 0 0 24px color-mix(in srgb, var(--color-sage) 25%, transparent)',
                    }
                  : undefined
              }
            >
              {lit && (
                <span
                  aria-hidden
                  className="ai-rim pointer-events-none absolute -inset-px rounded-[inherit]"
                />
              )}
              <textarea
                ref={fieldRef}
                id={textId}
                value={description}
                onChange={(event) => change({ description: event.target.value })}
                onKeyDown={onKeyDown}
                maxLength={MAX_CREATION_PROMPT_LENGTH}
                placeholder={
                  listening && voice.live
                    ? 'Sag oder tippe, worum es geht, für wen und was hängen bleiben soll'
                    : 'Worum geht es, für wen ist sie, was soll hängen bleiben?'
                }
                className="block h-full min-w-0 flex-1 resize-none self-stretch bg-transparent text-sm leading-5 text-fg outline-none placeholder:text-fg-subtle"
              />
              {canSpeak && (
                <IconButton
                  icon={voice.status === 'listening' ? 'pause' : 'mic'}
                  label={
                    voice.status === 'listening'
                      ? 'Pausieren'
                      : voice.status === 'paused'
                        ? 'Weiter zuhören'
                        : 'Beschreibung sprechen'
                  }
                  size="compact"
                  active={voice.status === 'listening'}
                  onClick={() => {
                    if (voice.status === 'listening') voice.pause();
                    else if (voice.status === 'paused') voice.resume();
                    else voice.toggle();
                    fieldRef.current?.focus({ preventScroll: true });
                  }}
                />
              )}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-fg-subtle">
              <Icon name="attachFile" size={14} className="mt-px shrink-0" />
              <span>
                {materialLine}{' '}
                <TextLink variant="underline" tone="muted" onClick={toBoard}>
                  Zu Folie 0
                </TextLink>
              </span>
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2" aria-describedby={kindsId}>
              <legend className="mb-2 text-xs font-medium text-fg-muted">
                Art der Präsentation
              </legend>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                {DECK_KINDS.map((each) => {
                  const selected = each.id === kind;
                  return (
                    <label
                      key={each.id}
                      title={each.meaning}
                      className={cn(
                        'group relative flex h-10 cursor-pointer items-center gap-2 rounded-control bg-surface-1 px-2.5 text-body whitespace-nowrap text-fg-muted ring-2 ring-transparent transition-[box-shadow,background-color,color,scale] duration-150',
                        'hover:bg-hover hover:text-fg has-focus-visible:ring-fg',
                        selected && 'bg-selected! font-medium text-fg! ring-fg!',
                      )}
                    >
                      <input
                        type="radio"
                        name={`${kindsId}-kind`}
                        checked={selected}
                        onChange={() => change({ kind: each.id })}
                        className="sr-only"
                      />
                      <Icon name={KIND_ICONS[each.id]} size={16} className="shrink-0" />
                      <span>{each.label}</span>
                    </label>
                  );
                })}
              </div>
              <p id={kindsId} className="sr-only">
                Die Art bestimmt Aufbau, Ton und Textmenge der Folien.
              </p>
            </fieldset>

            {masters.length > 0 && (
              <MasterChoice
                compact
                legend="Stil"
                name={`${kindsId}-style`}
                masters={masters}
                masterId={masterId}
                onChange={(id) => change({ templateId: id })}
              />
            )}

            <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              Seitenzahl
              <NumberField
                label="Seitenzahl"
                value={shownPages}
                onChange={(value) => change({ pages: Math.round(value) })}
                min={MIN_CREATED_SLIDES}
                max={MAX_CREATED_SLIDES}
                step={1}
                decimals={0}
                size="md"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-6 py-3 @3xl:px-10">
        <Button
          variant="ghost"
          onClick={() => {
            clearCreationDraft(deck.id);
            dismiss.mutate();
          }}
        >
          Leer anfangen
        </Button>
        <Button
          icon="autoAwesome"
          onClick={create}
          disabled={!ready}
          title={ready ? undefined : 'Erst beschreiben, worum es geht'}
        >
          Erstellen
        </Button>
      </div>
    </div>
  );
}
