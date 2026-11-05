import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Slide } from '@slider/shared';
import { Button, cn, IconButton, Select } from '@/ui';
import { useDeckNotes } from '@/lib/api';
import { useEditing } from '../editing/editing-context';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { slideSrcSet } from '../stage/lib/slide-image';
import { useViewerData } from '../state/viewer-data';
import { notesFromText, notesToHtml } from '../timeline/lib/notes-html';
import { canUseSecondScreen, openAudienceWindow } from './lib/audience-window';
import { presenterRoom } from './lib/presenter-room';
import { BOX_STAYS, parseBoxStay } from './lib/show-times';
import { SummaryLine, SummaryRows } from './RunSummary';
import { boxStayStore, useBoxColor, useBoxStay, useShowBoxes } from './show-boxes';
import { ShowBoxLayer } from './ShowBoxLayer';
import { CameraPreview } from './CameraPreview';
import { RecordControls } from './RecordControls';
import { useShowRecording } from './show-recording';
import { useSaveShowRun, showRunOf, type ShowRun } from './lib/show-runs';
import { useViewerToast } from '../state/viewer-toast';
import type { ShowScene } from './lib/show-recorder';
import { useTransitionOf } from '../editing/transition/picked-transitions';
import { presentationStart, presentedSlides } from './lib/presentation';
import {
  atIndex,
  atMessage,
  formatElapsed,
  FULLSCREEN_MESSAGE,
  stopwatchElapsed,
} from './lib/show-sync';
import {
  useShowChannel,
  useShowFullscreen,
  useShowKeys,
  useShowClock,
  useShowMessages,
  useWakeLock,
  type ShowClock,
} from './show-hooks';

interface PresenterViewProps {
  /** The slide it starts on (a hidden one hands over to the next one shown). */
  startSlideId: string | null;
  /** Ended (Esc, ✕, past the last slide, the audience's show ended): with the slide it was on. */
  onExit: (slideId: string | null) => void;
}

/**
 * „Referentenansicht“ (Keynote's and PowerPoint's presenter display) in this tab, fullscreen: the
 * slide shown large, the next one beside it, the slide's notes with their formatting, where the
 * show is, a stopwatch and the time. The slide show's keys step through it. „Publikum öffnen“
 * opens the audience's slide show in a window of its own – on the second screen where the browser
 * can put it there – kept on the same step (`show-sync.ts`); it plays the transitions, this view
 * steps without them.
 */
export function PresenterView({ startSlideId, onExit }: PresenterViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { slides: viewerSlides, deck } = useViewerData();
  const [slides] = useState(() => presentedSlides(viewerSlides));
  const [index, setIndex] = useState(() => presentationStart(viewerSlides, slides, startSlideId));
  const [black, setBlack] = useState(false);
  const audienceWindow = useRef<Window | null>(null);
  // The audience's window is open and listening.
  const [audienceThere, setAudienceThere] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useRestoreFocus();

  const ended = index >= slides.length;
  const current = slides[Math.min(index, slides.length - 1)] ?? null;
  const next = slides[index + 1] ?? null;

  const show = useShowChannel(deck.id);
  // The stopwatch and the recording are made further down; the end hands both over.
  const finishing = useRef<() => void>(() => undefined);
  const leave = () => {
    finishing.current();
    onExit(current?.id ?? null);
  };
  const exit = () => {
    show.post({ type: 'end' });
    leave();
  };
  const go = (to: number) => {
    setBlack(false);
    if (to > slides.length) {
      exit();
      return;
    }
    setIndex(Math.max(0, to));
  };
  const step = (by: 1 | -1) => {
    // A black screen goes back to the slide first, like in PowerPoint.
    if (black) setBlack(false);
    else go(index + by);
  };
  const boxes = useShowBoxes(show, ended ? null : (current?.id ?? null));
  const boxColor = useBoxColor();
  const boxStay = useBoxStay();
  useShowKeys({
    step,
    go,
    count: slides.length,
    toggleBlack: () => setBlack((on) => !on),
    exit,
    clear: boxes.clear,
  });

  // A step taken on the audience's message is not told back (rapid steps would bounce).
  const fromOther = useRef(false);
  useShowMessages(show, (message) => {
    switch (message.type) {
      case 'hello':
        setAudienceThere(true);
        show.post(atMessage(slides, index, black));
        return;
      case 'gone':
        setAudienceThere(false);
        return;
      case 'end':
        leave();
        return;
      case 'at': {
        setAudienceThere(true);
        const target = atIndex(slides, message);
        if (target === null || (target === index && message.black === black)) return;
        fromOther.current = true;
        setIndex(target);
        setBlack(message.black);
        return;
      }
    }
  });
  useEffect(() => {
    if (fromOther.current) {
      fromOther.current = false;
      return;
    }
    show.post(atMessage(slides, index, black));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, black]);

  // It stays open out of fullscreen: a desk view, not the show (Esc then ends it).
  useShowFullscreen(rootRef, null);
  useWakeLock();

  const openAudience = () => {
    const shown = audienceWindow.current;
    if (shown && !shown.closed && audienceThere) {
      // Open: hand it the right to go fullscreen (where the browser has capability delegation).
      try {
        shown.postMessage(FULLSCREEN_MESSAGE, {
          targetOrigin: window.location.origin,
          delegate: 'fullscreen',
        } as WindowPostMessageOptions);
      } catch {
        shown.postMessage(FULLSCREEN_MESSAGE, window.location.origin);
      }
      shown.focus();
      return;
    }
    const opened = openAudienceWindow(deck.id, ended ? null : (current?.id ?? null));
    audienceWindow.current = opened;
    setBlocked(!opened);
  };

  // The editor's notes (just typed ones too); without edit rights, the notes alone.
  const editing = useEditing();
  const readOnly = useDeckNotes(deck.id, !editing.state).data;
  const notes = useMemo(() => {
    const own =
      current &&
      (editing.state?.slides.find((item) => item.slideId === current.id) ??
        readOnly?.slides.find((item) => item.slideId === current.id));
    const paragraphs = own ? (own.notesRich ?? notesFromText(own.notes)) : [];
    return paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))
      ? notesToHtml(paragraphs)
      : null;
  }, [current, editing.state, readOnly]);

  const clock = useShowClock(ended ? null : (current?.id ?? null));
  const secondScreen = canUseSecondScreen();
  const aspect = current?.aspectRatio ?? 16 / 9;
  const roomRef = useRef<HTMLDivElement>(null);
  const room = usePresenterRoom(roomRef, aspect);
  const transitionOf = useTransitionOf();
  // What the audience sees, for the recording's frames.
  const scene = useRef<ShowScene>({ slide: null, black: false, transition: 'none', boxes: [] });
  useEffect(() => {
    scene.current = {
      slide: ended ? null : current,
      black,
      transition: current ? (transitionOf(current.id) ?? current.transition ?? 'none') : 'none',
      boxes: boxes.boxes,
    };
  });
  const recording = useShowRecording({
    clock,
    title: deck.title,
    aspect,
    color: boxColor,
    scene,
  });
  const toast = useViewerToast();
  const saveRun = useSaveShowRun(deck.id);
  const savedRun = useRef(false);
  useEffect(() => {
    finishing.current = () => {
      if (savedRun.current) return;
      savedRun.current = true;
      if (!ended || !clock.started) return;
      const run = showRunOf(slides, clock.marks(), clock.elapsed(), new Date());
      void recording
        .complete()
        .then((blob) => saveRun(run, blob))
        .then(
          () => toast('Durchgang gespeichert'),
          (error: Error) => toast(error.message, 'danger'),
        );
    };
  });
  // At the end screen: the run as it stands then (in the next slide's pane).
  const [endRun, setEndRun] = useState<ShowRun | null>(null);
  const [endSeen, setEndSeen] = useState(ended);
  if (endSeen !== ended) {
    setEndSeen(ended);
    setEndRun(ended ? showRunOf(slides, clock.marks(), clock.elapsed(), new Date()) : null);
  }
  const recordingOn = recording.state === 'recording' || recording.state === 'paused';

  const currentSection = (
    <section
      aria-label="Aktuelle Folie"
      className="flex shrink-0 flex-col gap-2"
      style={room.kind === 'narrow' ? undefined : { width: room.current }}
    >
      <div className="flex h-8 items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-fg-subtle">Aktuelle Folie</h2>
        <label className="flex items-center gap-2 text-xs text-fg-subtle">
          Rahmen zeigen
          <Select
            size="sm"
            aria-label="Gezeichnete Rahmen zeigen"
            value={String(boxStay)}
            onChange={(value) =>
              boxStayStore.set(parseBoxStay(value === 'slide' ? value : Number(value)))
            }
            options={BOX_STAYS.map((stay) => ({
              value: String(stay),
              label: stay === 'slide' ? 'bis zur nächsten Folie' : `${stay} s`,
            }))}
          />
        </label>
      </div>
      <SlideBox aspect={aspect}>
        {/* The one before and after stay mounted: loaded before they show. */}
        {slides.map((slide, at) =>
          Math.abs(at - index) <= 1 ? (
            <SlidePicture
              key={slide.id}
              slide={slide}
              label={`Folie ${at + 1}`}
              shown={at === index}
              onClick={() => step(1)}
            />
          ) : null,
        )}
        {recording.camera && <CameraPreview stream={recording.camera} aspect={aspect} />}
        {!ended && (
          <ShowBoxLayer
            boxes={boxes.boxes}
            now={boxes.now}
            color={boxColor}
            onDraw={boxes.add}
            onClick={() => step(1)}
          />
        )}
        {(ended || black) && (
          <p
            className={cn(
              'pointer-events-none absolute inset-0 z-4 grid place-items-center text-sm',
              ended ? 'bg-surface-1 text-fg-subtle' : 'bg-scrim-strong text-fg',
            )}
          >
            {ended ? 'Ende der Präsentation' : 'Das Publikum sieht Schwarz (B)'}
          </p>
        )}
      </SlideBox>
    </section>
  );
  const nextSection = (
    <section
      aria-label={ended ? 'Übersicht' : 'Nächste Folie'}
      className="flex min-w-0 flex-1 shrink-0 flex-col gap-2"
    >
      <h2 className="flex h-8 items-center text-xs font-medium text-fg-subtle">
        {ended ? 'Übersicht' : 'Nächste Folie'}
      </h2>
      {ended ? (
        // The show's end: each slide's time, in the next slide's place (scrolls when long).
        <div
          className="flex flex-col gap-3 overflow-y-auto rounded-panel bg-surface-1 p-4"
          style={{ aspectRatio: aspect }}
        >
          <p className="text-sm text-fg-muted">
            <SummaryLine
              total={endRun?.total ?? 0}
              skipped={endRun?.rows.filter((row) => row.skipped).length ?? 0}
            />
          </p>
          <SummaryRows rows={endRun?.rows ?? []} />
          {recording.state !== 'idle' && (
            <div className="flex">
              <RecordControls recording={recording} />
            </div>
          )}
        </div>
      ) : (
        <SlideBox aspect={aspect}>
          {slides.map((slide, at) =>
            at === index + 1 || at === index + 2 ? (
              <SlidePicture
                key={slide.id}
                slide={slide}
                label={`Folie ${at + 1}`}
                shown={at === index + 1}
                onClick={() => go(at)}
              />
            ) : null,
          )}
          {!next && (
            <p className="absolute inset-0 grid place-items-center bg-surface-1 text-sm text-fg-subtle">
              Ende der Präsentation
            </p>
          )}
        </SlideBox>
      )}
    </section>
  );
  const notesSection = (
    <section aria-label="Notizen" className="flex min-h-40 min-w-0 flex-1 flex-col gap-2">
      <h2 className="text-xs font-medium text-fg-subtle">Notizen</h2>
      {notes ? (
        <div
          tabIndex={0}
          data-presenter-notes
          className={cn(
            'min-h-0 flex-1 overflow-y-auto rounded-panel bg-surface-1 px-5 py-4 text-xl leading-relaxed whitespace-pre-wrap text-fg outline-none focus-visible:ring-hairline-strong',
            '[&_ol]:list-decimal [&_ol]:pl-7 [&_ul]:list-disc [&_ul]:pl-7 [&_ul_ul]:list-[circle]',
          )}
          // `notesToHtml` escapes the text; only its own tags are markup.
          dangerouslySetInnerHTML={{ __html: notes }}
        />
      ) : (
        <p className="flex-1 rounded-panel bg-surface-1 px-5 py-4 text-sm text-fg-subtle">
          Keine Notizen zu dieser Folie
        </p>
      )}
    </section>
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal
      aria-label={`Referentenansicht: ${deck.title}`}
      tabIndex={-1}
      data-presenter
      className="fixed inset-0 z-(--z-presentation) flex flex-col gap-4 bg-canvas p-4 text-fg outline-none md:p-6"
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-1">
          <IconButton
            icon="chevronLeft"
            label="Vorherige Folie"
            size="sm"
            disabled={index === 0}
            onClick={() => step(-1)}
          />
          <p aria-live="polite" className="min-w-28 text-center text-sm text-fg-muted tabular-nums">
            {ended ? 'Ende der Präsentation' : `Folie ${index + 1} von ${slides.length}`}
          </p>
          <IconButton icon="chevronRight" label="Nächste Folie" size="sm" onClick={() => step(1)} />
        </div>
        <Times
          clock={clock}
          locked={recordingOn}
          onToggle={recordingOn ? recording.toggle : clock.toggle}
        />
        <RecordControls recording={recording} />
        <div className="ml-auto flex items-center gap-2">
          {blocked && (
            <p role="status" className="text-sm text-warning">
              Fenster blockiert. Pop-ups für Slider erlauben.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={audienceThere ? 'openInFull' : 'screenShare'}
            title={
              audienceThere
                ? 'Die Präsentation im Fenster des Publikums als Vollbild zeigen'
                : secondScreen
                  ? 'Die Präsentation auf dem zweiten Bildschirm zeigen'
                  : 'Die Präsentation in einem eigenen Fenster zeigen, zum Beamer ziehen'
            }
            onClick={openAudience}
          >
            {audienceThere ? 'Publikum im Vollbild' : 'Publikum öffnen'}
          </Button>
          <IconButton
            icon="close"
            label="Referentenansicht beenden"
            title="Referentenansicht beenden (Esc)"
            size="sm"
            onClick={exit}
          />
        </div>
      </header>

      {/* The current slide as large as the room allows (`presenterRoom`): beside the next slide
          and the notes in a wide room, above the notes and beside the next slide in a taller one. */}
      <div
        ref={roomRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-6',
          room.kind === 'narrow' && 'overflow-y-auto',
          room.kind === 'side' && 'flex-row',
        )}
      >
        {room.kind === 'below' ? (
          <>
            <div className="flex shrink-0 items-start gap-6">
              {currentSection}
              {nextSection}
            </div>
            {notesSection}
          </>
        ) : (
          <>
            {currentSection}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
              {nextSection}
              {notesSection}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function usePresenterRoom(ref: RefObject<HTMLDivElement | null>, aspect: number) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry!.contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return presenterRoom(size.width, size.height, aspect);
}

/** A slide's place: its shape, the track's rounded corners. */
function SlideBox({ aspect, children }: { aspect: number; children: ReactNode }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-panel bg-placeholder"
      style={{ aspectRatio: aspect }}
    >
      {children}
    </div>
  );
}

function SlidePicture({
  slide,
  label,
  shown,
  onClick,
}: {
  slide: Slide;
  label: string;
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <img
      src={slide.imageUrl}
      {...slideSrcSet(slide, 'screen')}
      alt={shown ? label : ''}
      aria-hidden={!shown}
      draggable={false}
      onClick={onClick}
      className={cn(
        'absolute inset-0 size-full cursor-pointer object-contain select-none',
        shown ? 'z-1' : 'invisible',
      )}
    />
  );
}

const clockFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/**
 * The stopwatch – its time (0:00, dimmed, until ▶ or a recording starts it), ▶/pause and reset –
 * and the time of day.
 */
function Times({
  clock,
  locked,
  onToggle,
}: {
  clock: ShowClock;
  /** Recording: reset waits, pausing pauses the recording too (`onToggle`). */
  locked: boolean;
  onToggle: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const { running } = clock;
  return (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-1">
        <span
          role="timer"
          aria-label="Vergangene Zeit"
          className={cn('min-w-16 text-2xl tabular-nums', running ? 'text-fg' : 'text-fg-subtle')}
        >
          {formatElapsed(stopwatchElapsed(clock.watch, now))}
        </span>
        <IconButton
          icon={running ? 'pause' : 'playArrow'}
          label={
            running ? 'Zeit anhalten' : clock.started ? 'Zeit weiterlaufen lassen' : 'Zeit starten'
          }
          size="sm"
          onClick={() => {
            setNow(Date.now());
            onToggle();
          }}
        />
        <IconButton
          icon="replay"
          label="Zeit zurücksetzen"
          title={locked ? 'Während der Aufnahme nicht' : 'Zeit zurücksetzen'}
          size="sm"
          disabled={locked || !clock.started}
          onClick={() => {
            setNow(Date.now());
            clock.reset();
          }}
        />
      </div>
      <time aria-label="Uhrzeit" className="text-2xl text-fg-muted tabular-nums">
        {clockFormat.format(now)}
      </time>
    </div>
  );
}
