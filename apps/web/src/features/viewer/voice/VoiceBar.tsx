import type { Author, VoiceItem, VoiceItemState, VoiceSession } from '@slider/shared';
import { useEffect, useState, type AnimationEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { isTextTarget } from '@/lib/dom';
import { ringColor } from '@/lib/accent';
import {
  Avatar,
  Badge,
  cn,
  GlassPanel,
  IconButton,
  Toolbar,
  ToolbarDivider,
  Tooltip,
  type BadgeTone,
} from '@/ui';
import { slideLabel } from '../comments/lib/labels';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { useViewerData } from '../state/viewer-data';
import { isSidePanelOpen, useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useVoiceLevel } from './hooks/useVoiceLevel';
import { liveCaption } from './lib/caption';
import { useVoice, type VoiceStatus } from './voice-context';

const STATE_LABEL: Record<VoiceItemState, { text: string; tone: BadgeTone }> = {
  draft: { text: 'Du sprichst noch', tone: 'info' },
  queued: { text: 'Wartet', tone: 'neutral' },
  working: { text: 'KI arbeitet', tone: 'info' },
  applied: { text: 'Geändert', tone: 'success' },
  answered: { text: 'Beantwortet', tone: 'success' },
  comment: { text: 'Kommentar', tone: 'neutral' },
  failed: { text: 'Fehlgeschlagen', tone: 'danger' },
  dropped: { text: 'Verworfen', tone: 'neutral' },
  reverted: { text: 'Rückgängig', tone: 'neutral' },
};

const STATUS_TEXT: Record<VoiceStatus, string> = {
  off: 'Sprechen',
  starting: 'Mikrofon startet …',
  listening: 'Hört zu – sag einfach, was dir auffällt',
  paused: 'Pausiert',
  ending: 'Wird gesendet …',
  ended: 'Gesendet',
};

/** A Space press shorter than this is a tap (pause / go on); longer, it is the hand. */
const SPACE_TAP_MS = 250;

/** A focused button takes Space itself (presses it). */
const isButtonTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest('button, [role="button"], a, summary') !== null;

const BUSY: ReadonlySet<VoiceItemState> = new Set(['draft', 'queued', 'working']);
/** The live caption: the latest pieces heard, this many at most. */
const CAPTION_PIECES = 4;

/**
 * Counts up each time the server made something of what was said – a new comment, more of one,
 * a command – so the bar can show it was understood. Nothing counts for the session's start.
 */
function useRecognitions(session: VoiceSession | null): number {
  const [seen, setSeen] = useState<{
    session: VoiceSession | null;
    keys: ReadonlySet<string>;
    count: number;
  }>({ session: null, keys: new Set(), count: 0 });
  if (session !== seen.session) {
    const keys = new Set([
      ...(session?.items ?? [])
        .filter((item) => item.state !== 'dropped')
        .map((item) => `${item.commentId}:${item.text}`),
      ...(session?.commands ?? []).map(({ id }) => `command:${id}`),
    ]);
    const fresh = seen.session !== null && [...keys].some((key) => !seen.keys.has(key));
    setSeen({ session, keys, count: seen.count + (fresh ? 1 : 0) });
  }
  return seen.count;
}

/**
 * Speaking to the AI (a click on its avatar): one flat bar grown out of the split handle's line
 * under the track and shrunk back into it, like the find bar (`FindBar`) – the live caption, the
 * comments made of it (a click opens their list above the bar) and pause / stop. Gives way while
 * the find bar or a handle hint takes the slot; without a slot (phones) it floats at the top.
 */
export function VoiceBar({ slot = null }: { slot?: HTMLElement | null }) {
  const voice = useVoice();
  const { aiAuthor, slideIndex, viewer } = useViewerData();
  const viewerState = useViewerState();
  const sidePanelOpen = isSidePanelOpen(viewerState);
  // A box for the AI open: what is said now shows in its field only, not here as well.
  const boxOpen = viewerState.draft?.aiBox !== undefined;
  const dispatch = useViewerDispatch();
  const goToSlide = useGoToSlide();
  const [listOpen, setListOpen] = useState(false);
  const { status, session, speaking, sending, error } = voice;
  const recognitions = useRecognitions(session);
  // Space tapped (not held – held it is the hand that moves the view): pause / go on listening.
  const { pause, resume } = voice;
  useEffect(() => {
    if (status !== 'listening' && status !== 'paused') return;
    let downAt: number | null = null;
    let dragged = false;
    const onDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (isTextTarget(event.target) || isButtonTarget(event.target)) return;
      downAt = event.timeStamp;
      dragged = false;
    };
    const onMove = (event: PointerEvent) => {
      if (downAt !== null && event.buttons) dragged = true;
    };
    const onUp = (event: globalThis.KeyboardEvent) => {
      if (event.key !== ' ' || downAt === null) return;
      const tapped = event.timeStamp - downAt < SPACE_TAP_MS && !dragged;
      downAt = null;
      if (!tapped) return;
      if (status === 'listening') pause();
      else resume();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('pointermove', onMove);
    };
  }, [status, pause, resume]);

  // Sent: the bar goes at once – the comments carry on with the AI's work. A problem stays to read.
  const { dismiss } = voice;
  useEffect(() => {
    if (status === 'ended' && error === null) dismiss();
  }, [status, error, dismiss]);

  // Still shown while it shrinks back into the handle.
  const visible = status !== 'off' || error !== null;
  const [shown, setShown] = useState(visible);
  const [closing, setClosing] = useState(false);
  if (visible && (!shown || closing)) {
    setShown(true);
    setClosing(false);
  } else if (!visible && shown && !closing) {
    if (slot) setClosing(true);
    else setShown(false);
    setListOpen(false);
  }
  if (!shown) return null;

  const onMorphEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !closing) return;
    setShown(false);
    setClosing(false);
  };

  const items = (session?.items ?? []).filter((item) => item.state !== 'dropped').toReversed();
  const busy = items.filter((item) => BUSY.has(item.state)).length;
  const segments = session?.segments ?? [];
  // What was heard, as it comes in – the newest words at the end, older ones run out left. With
  // a live stream (`live` key) word for word, each piece replaced by its accurate text after its
  // pause; else the pieces' text alone.
  const caption =
    (voice.live && liveCaption(voice.live, segments)) ||
    segments
      .filter((segment) => segment.status === 'done' && segment.text)
      .slice(-CAPTION_PIECES)
      .map((segment) => segment.text.trim())
      .join(' ');
  // A piece that could not be heard or decided on, newer than anything heard since: say why.
  const lastHeard = segments.findLastIndex((segment) => segment.status === 'done' && segment.text);
  const failure = segments.findLast(
    (segment, index) => index > lastHeard && segment.status === 'failed',
  );
  const listening = status === 'listening';
  // Pieces sent and not yet made into text and decided on.
  const waiting = sending > 0 || (session?.pending ?? 0) > 0;
  const problem =
    error ?? (failure ? (failure.error ?? 'Ein Stück wurde nicht verstanden.') : null);
  // Sent: nothing more is heard, but what was said is still being worked on.
  const statusLine =
    status === 'ended' && busy > 0 ? `${aiAuthor.name} arbeitet weiter …` : STATUS_TEXT[status];
  const line =
    problem ??
    (listening && boxOpen
      ? ''
      : listening && caption
        ? caption
        : listening && speaking
          ? 'Du sprichst …'
          : listening && waiting
            ? 'Schreibt mit …'
            : statusLine);
  const showsCaption = problem === null && listening && !boxOpen && !!caption;
  const hint = `Geh durch die Folien und zeig mit der Maus, was du meinst. Fertige Gedanken gehen sofort an ${aiAuthor.name}. Senden beendet das Zuhören – was du gesagt hast, wird noch fertig bearbeitet. Auch: „nächste Folie“, „vergiss das“, „mach das rückgängig“, „Stopp“.${session ? ` Spracherkennung: ${session.speechService}.` : ''}`;

  const open = (item: VoiceItem) => {
    const index = item.slideId ? slideIndex.get(item.slideId) : undefined;
    if (index !== undefined) goToSlide(index);
    dispatch({ type: 'threadFocused', threadId: item.threadId, openPanel: false });
  };

  // Esc closes the list first, then leaves the rest to the viewer.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !listOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setListOpen(false);
  };

  const bar = (
    <div
      data-voice-bar
      role="region"
      aria-label={`Mit ${aiAuthor.name} sprechen`}
      inert={closing}
      onKeyDown={onKeyDown}
      className={cn(
        slot
          ? // In the gap the controls leave in the middle (`useHandleRoom`); a container, so
            // its comment count gets shorter when that's narrow.
            'absolute z-(--z-raised) w-[min(460px,calc(100%-3.5rem))] @container'
          : cn(
              'fixed inset-x-4 top-3 z-(--z-panel) transition-[right] duration-300',
              'md:top-4 md:right-6 md:left-auto md:w-[460px]',
              sidePanelOpen && 'md:right-[424px] md:max-w-[calc(100%-448px)]',
            ),
      )}
    >
      {listOpen && items.length > 0 && (
        <GlassPanel
          tone="elevated"
          className={cn(
            'absolute inset-x-0 flex animate-fade-in flex-col p-1.5',
            slot ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <ul
            aria-label="Gesprochene Kommentare"
            className="flex max-h-[min(320px,40vh)] flex-col gap-0.5 overflow-y-auto"
          >
            {items.map((item) => {
              const label = STATE_LABEL[item.state];
              const index = item.slideId ? slideIndex.get(item.slideId) : undefined;
              return (
                <li key={item.commentId}>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="flex w-full flex-col gap-1 rounded-control px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-caption text-fg-muted">
                        {index === undefined ? 'Präsentation' : slideLabel(index)}
                      </span>
                      <Badge tone={label.tone}>{label.text}</Badge>
                    </span>
                    <span className="line-clamp-2 text-sm text-fg">{item.text}</span>
                    {item.note && item.state !== 'applied' && (
                      <span className="text-caption text-fg-muted">{item.note}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </GlassPanel>
      )}
      <Toolbar
        role={false}
        tone="elevated"
        onAnimationEnd={onMorphEnd}
        title={hint}
        className={cn(
          'relative min-w-0 pl-2',
          !slot
            ? 'animate-fade-in'
            : closing
              ? 'animate-morph-into-handle'
              : 'animate-morph-out-of-handle',
        )}
      >
        {/* The handle's line, fading into the bar as it grows. */}
        {slot && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 bg-fg-muted',
              closing ? 'animate-handle-fade-in' : 'animate-handle-fade-out',
            )}
          />
        )}
        <VoiceAvatar
          author={aiAuthor}
          active={listening}
          recognitions={recognitions}
          color={ringColor(viewer.author.color)}
        />
        {/* rtl + ltr inside: a long caption is cut at its start, so the newest words stay. */}
        <span
          aria-live="polite"
          dir={showsCaption ? 'rtl' : undefined}
          className={cn(
            'h-8 min-w-0 flex-1 truncate pl-1 text-left text-body leading-8',
            problem ? 'text-danger' : 'text-fg',
          )}
        >
          {showsCaption ? <bdi dir="ltr">{line}</bdi> : line}
        </span>
        {listening && waiting && showsCaption && <TypingDots />}
        {/* The AI may not change the slides here: say so where it's seen, not only to a screen
            reader – else finished thoughts silently stay comments. */}
        {session && !session.aiEdits && session.aiEditsReason && (
          <Tooltip label={session.aiEditsReason} maxWidth={64} decorative>
            <Badge tone="neutral" tabIndex={0} aria-label={session.aiEditsReason}>
              Nur Kommentare
            </Badge>
          </Tooltip>
        )}
        {items.length > 0 && (
          <button
            type="button"
            aria-expanded={listOpen}
            onClick={() => setListOpen((was) => !was)}
            title={listOpen ? 'Kommentare ausblenden' : 'Kommentare zeigen'}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-fg-subtle tabular-nums hover:bg-hover"
          >
            {busy > 0 && (
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
            )}
            {items.length}
            {/* Short of room, just the count. */}
            <span className="@max-[340px]:hidden">
              {items.length === 1 ? ' Kommentar' : ' Kommentare'}
            </span>
          </button>
        )}
        {status !== 'starting' && status !== 'ending' && <ToolbarDivider spacing="none" />}
        {status === 'listening' && (
          <IconButton icon="pause" label="Pausieren" size="sm" onClick={voice.pause} />
        )}
        {status === 'paused' && (
          <IconButton icon="playArrow" label="Weiter zuhören" size="sm" onClick={voice.resume} />
        )}
        {(status === 'listening' || status === 'paused') && (
          // Ends listening only: what was said still goes to the AI and gets done.
          <IconButton
            icon="send"
            label={`An ${aiAuthor.name} senden`}
            size="sm"
            onClick={voice.stop}
          />
        )}
        {(status === 'ended' || status === 'off') && (
          <IconButton icon="close" label="Schließen" size="sm" onClick={voice.dismiss} />
        )}
      </Toolbar>
    </div>
  );
  return slot ? createPortal(bar, slot) : bar;
}

/**
 * The AI's avatar where a recording dot would be: while it listens the AI's light runs round it
 * (`ai-rim`, as round a card it works on) and a soft sage glow behind it swells with the
 * microphone's level – the avatar itself stays still. It flares up once in the person's colour
 * each time something said was understood (`recognitions` counts up).
 */
export function VoiceAvatar({
  author,
  active,
  recognitions,
  color,
}: {
  author: Author;
  active: boolean;
  recognitions: number;
  color: string;
}) {
  const level = useVoiceLevel(active);
  return (
    <span aria-hidden className="relative flex size-7 shrink-0 items-center justify-center">
      {recognitions > 0 && (
        <>
          {/* Keyed by the count: each one plays anew. */}
          <span
            key={`fill-${recognitions}`}
            className="pointer-events-none absolute inset-0 rounded-full opacity-0 motion-safe:animate-voice-understood"
            style={{ backgroundColor: color }}
          />
          <span
            key={`ring-${recognitions}`}
            className="pointer-events-none absolute -inset-1 rounded-full border-2 opacity-0 motion-safe:animate-reaction-ring"
            style={{ borderColor: color }}
          />
        </>
      )}
      {active && (
        <>
          <span
            className="pointer-events-none absolute inset-0 rounded-full transition-[opacity,scale] duration-150 ease-out"
            style={{
              background:
                'radial-gradient(closest-side, color-mix(in srgb, var(--color-sage) 70%, transparent), transparent)',
              opacity: 0.25 + level * 0.75,
              scale: 1.1 + level * 0.6,
            }}
          />
          <span className="ai-rim pointer-events-none absolute -inset-0.5 rounded-full" />
        </>
      )}
      <span className={cn('relative flex transition-opacity', !active && 'opacity-60')}>
        <Avatar author={author} size={24} nativeTitle={false} />
      </span>
    </span>
  );
}

/** Pieces still being written down and decided on, behind the caption. */
function TypingDots() {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-0.5 pr-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1 animate-pulse rounded-full bg-fg-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
