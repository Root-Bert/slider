import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { speechOf } from '@/features/attachments';
import { formatDuration } from '@/lib/format';
import { Badge, Button, cn, ErrorText, Icon, ProgressBar, Spinner } from '@/ui';
import {
  canCutVideo,
  cutVideo,
  keptParts,
  mergedCuts,
  partsLength,
  type TimeRange,
} from './lib/cut-video';

/** A part the AI would cut, and why („Pause“, „Versprecher“). */
export interface SuggestedCut extends TimeRange {
  why: string;
}

/** A cut on the timeline – the AI's says why. */
type Cut = TimeRange & { why?: string };

/** Bars of the waveform over the timeline's width. */
const BARS = 96;
/** A drag shorter than this (px) is a click: it seeks. */
const CLICK_PX = 4;

/** The peaks stretched or thinned to `BARS`, the loudest of each. */
function bars(peaks: readonly number[]): number[] {
  if (peaks.length === 0) return Array.from({ length: BARS }, () => 0.3);
  return Array.from({ length: BARS }, (_, index) => {
    const from = Math.floor((index * peaks.length) / BARS);
    const to = Math.max(from + 1, Math.floor(((index + 1) * peaks.length) / BARS));
    return Math.max(...peaks.slice(from, Math.min(to, peaks.length)), 0);
  });
}

/**
 * A recorded video cut before it goes (a message in Sender, a video comment in Slider): its start and
 * end drawn in, parts in between marked by dragging and cut out (⌫), the AI's suggestions where
 * one asks it (Beta). The preview plays as it will be – over what is cut. `onDone` gets the file
 * as kept: cut in the browser when anything is cut (a bar shows how far), else the take itself.
 */
export function VideoEditor({
  blob,
  url,
  durationMs,
  peaks,
  doneLabel,
  onDone,
  onlyWhenCut = false,
  autoCut,
  actions,
}: {
  blob: Blob;
  url: string;
  durationMs: number;
  peaks: readonly number[];
  /** The main button's words („Anhängen“). */
  doneLabel: string;
  /** The file as kept, how long it is now and which of the peaks are left. */
  onDone: (file: Blob, kept: { durationMs: number; peaks: number[] }) => void;
  /** The main button only once something is cut (the take goes on its own, as in Slider). */
  onlyWhenCut?: boolean;
  /** The AI's cuts from the recording's speech – none offered without it. */
  autoCut?: (speech: Blob, signal: AbortSignal) => Promise<SuggestedCut[]>;
  /** Buttons beside the main one (again, the bin). */
  actions?: ReactNode;
}) {
  const duration = durationMs / 1000;
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trim, setTrim] = useState<TimeRange>({ start: 0, end: duration });
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [selection, setSelection] = useState<TimeRange | null>(null);
  const [at, setAt] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  const [cuttable] = useState(canCutVideo);

  const removed: Cut[] = [
    { start: 0, end: trim.start },
    ...cuts,
    { start: trim.end, end: duration },
  ];
  const kept = keptParts(duration, removed);
  const keptLength = partsLength(kept);
  const untouched = kept.length === 1 && kept[0]!.start <= 0.05 && kept[0]!.end >= duration - 0.05;

  // Whatever runs stops with the editor.
  useEffect(() => () => work.current?.abort(), []);

  // The preview plays as it will be: over what is cut, to the end drawn in.
  const keptRef = useRef(kept);
  useLayoutEffect(() => {
    keptRef.current = kept;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const follow = () => {
      const now = video.currentTime;
      const parts = keptRef.current;
      const last = parts.at(-1);
      if (!video.paused && parts.length > 0) {
        const inside = parts.find((part) => now >= part.start - 0.02 && now < part.end);
        if (!inside) {
          const next = parts.find((part) => part.start > now);
          if (next) video.currentTime = next.start;
          else {
            video.pause();
            if (last) video.currentTime = last.end;
          }
        }
      }
      setAt(video.currentTime);
      frame = requestAnimationFrame(follow);
    };
    const onPlay = () => {
      const parts = keptRef.current;
      const last = parts.at(-1);
      // At the end (or before the start) it plays from the start drawn in.
      if (
        parts[0] &&
        last &&
        (video.currentTime >= last.end - 0.05 || video.currentTime < parts[0].start)
      )
        video.currentTime = parts[0].start;
    };
    video.addEventListener('play', onPlay);
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('play', onPlay);
    };
  }, []);

  const timeAt = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.min(duration, Math.max(0, ((clientX - box.left) / box.width) * duration));
  };
  const seek = (time: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = time;
    setAt(time);
  };

  const drag = useRef<{ kind: 'select' | 'start' | 'end'; from: number; x: number } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>, kind: 'select' | 'start' | 'end') => {
    if (progress !== null || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    trackRef.current?.focus({ preventScroll: true });
    trackRef.current?.setPointerCapture(event.pointerId);
    drag.current = { kind, from: timeAt(event.clientX), x: event.clientX };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const now = drag.current;
    if (!now) return;
    const time = timeAt(event.clientX);
    if (now.kind === 'start') {
      setTrim((old) => ({ ...old, start: Math.min(time, old.end - 0.5) }));
      seek(Math.min(time, trim.end - 0.5));
    } else if (now.kind === 'end') {
      setTrim((old) => ({ ...old, end: Math.max(time, old.start + 0.5) }));
      seek(Math.max(time, trim.start + 0.5));
    } else if (Math.abs(event.clientX - now.x) >= CLICK_PX) {
      setSelection({ start: Math.min(now.from, time), end: Math.max(now.from, time) });
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const now = drag.current;
    drag.current = null;
    if (now?.kind === 'select' && Math.abs(event.clientX - now.x) < CLICK_PX) {
      setSelection(null);
      seek(now.from);
    }
  };

  const cutSelection = () => {
    if (!selection) return;
    setCuts((old) => mergedCuts([...old, selection]));
    setSelection(null);
  };
  const restore = (cut: Cut) => setCuts((old) => old.filter((one) => one !== cut));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (!selection) return;
      cutSelection();
    } else if (event.key === 'Escape' && selection) {
      setSelection(null);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = (event.shiftKey ? 5 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
      seek(Math.min(duration, Math.max(0, at + step)));
    } else if (event.key === ' ') {
      const video = videoRef.current;
      if (video?.paused) void video.play().catch(() => undefined);
      else video?.pause();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const askAi = async () => {
    if (!autoCut) return;
    setError(null);
    setNote(null);
    setAsking(true);
    const controller = new AbortController();
    work.current = controller;
    try {
      const speech = await speechOf(blob, controller.signal);
      const suggested = await autoCut(speech, controller.signal);
      if (controller.signal.aborted) return;
      if (suggested.length === 0) setNote('Die KI fand nichts zum Herausschneiden.');
      setCuts((old) => {
        const merged = mergedCuts([...old, ...suggested]);
        // A merged cut keeps the reason of an AI cut inside it.
        return merged.map((cut) => ({
          ...cut,
          why: suggested.find((one) => one.start >= cut.start && one.end <= cut.end)?.why,
        }));
      });
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : 'Die KI konnte nicht schneiden.');
    } finally {
      if (work.current === controller) work.current = null;
      setAsking(false);
    }
  };

  const done = async () => {
    setError(null);
    // The peaks of the parts kept – the waveform of what stays.
    const keptPeaks = peaks.filter((_, index) => {
      const time = ((index + 0.5) / peaks.length) * duration;
      return kept.some((part) => time >= part.start && time < part.end);
    });
    const result = { durationMs: Math.round(keptLength * 1000), peaks: keptPeaks };
    if (untouched) return onDone(blob, { durationMs, peaks: [...peaks] });
    const controller = new AbortController();
    work.current = controller;
    setProgress(0);
    try {
      videoRef.current?.pause();
      const file = await cutVideo(blob, kept, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) onDone(file, result);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          caught instanceof Error ? caught.message : 'Die Aufnahme ließ sich nicht schneiden.',
        );
    } finally {
      if (work.current === controller) work.current = null;
      setProgress(null);
    }
  };

  const percent = (time: number) => `${(time / duration) * 100}%`;
  const shownCuts = [
    ...(trim.start > 0 ? [{ start: 0, end: trim.start }] : []),
    ...cuts,
    ...(trim.end < duration ? [{ start: trim.end, end: duration }] : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative isolate overflow-hidden rounded-control bg-canvas [transform:translateZ(0)]">
        <video
          ref={videoRef}
          // Safari draws no first frame for `metadata` alone; a start just past 0 makes it.
          src={`${url}#t=0.001`}
          controls
          playsInline
          preload="metadata"
          className="block max-h-72 w-full bg-canvas object-contain"
        />
      </div>

      {cuttable && (
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Zeitleiste – Ziehen markiert einen Teil, ⌫ schneidet ihn heraus"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(at)}
          aria-valuetext={formatDuration(at * 1000)}
          onPointerDown={(event) => onPointerDown(event, 'select')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'relative h-12 cursor-crosshair touch-none rounded-control bg-well-dark outline-none select-none focus-visible:ring-focus',
            progress !== null && 'pointer-events-none opacity-60',
          )}
        >
          <div aria-hidden className="absolute inset-x-1.5 inset-y-2 flex items-center gap-px">
            {bars(peaks).map((peak, index) => (
              <span
                key={index}
                className="min-w-0 flex-1 rounded-full bg-fg-muted"
                style={{ height: `${Math.max(8, peak * 100)}%` }}
              />
            ))}
          </div>
          {shownCuts.map((cut) => (
            <div
              key={`${cut.start}-${cut.end}`}
              title={'why' in cut && cut.why ? cut.why : undefined}
              className="absolute inset-y-0 bg-scrim-strong"
              style={{ left: percent(cut.start), width: percent(cut.end - cut.start) }}
            >
              {cuts.includes(cut as Cut) && cut.end - cut.start > duration * 0.03 && (
                <button
                  type="button"
                  aria-label="Schnitt zurücknehmen"
                  title={'why' in cut && cut.why ? `${cut.why} – zurücknehmen` : 'Zurücknehmen'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => restore(cut as Cut)}
                  className="absolute top-1/2 left-1/2 flex size-5 -translate-1/2 items-center justify-center rounded-full glass-dark text-fg-muted hover:text-fg"
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          {selection && (
            <div
              className="pointer-events-none absolute inset-y-0 bg-selected ring-1 ring-fg ring-inset"
              style={{
                left: percent(selection.start),
                width: percent(selection.end - selection.start),
              }}
            />
          )}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-fg"
            style={{ left: percent(at) }}
          />
          {(['start', 'end'] as const).map((edge) => (
            <div
              key={edge}
              aria-hidden
              onPointerDown={(event) => onPointerDown(event, edge)}
              className={cn(
                'absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center rounded-control-sm bg-fg',
                // Inside the bar: the start's handle right of its line, the end's left of it.
                edge === 'start' ? 'rounded-r-none' : '-translate-x-full rounded-l-none',
              )}
              style={{ left: percent(edge === 'start' ? trim.start : trim.end) }}
            >
              <span className="h-4 w-0.5 rounded-full bg-canvas" />
            </div>
          ))}
        </div>
      )}

      {progress !== null ? (
        <div className="flex items-center gap-3">
          <ProgressBar value={progress} label="Wird geschnitten" className="flex-1" />
          <span className="shrink-0 text-xs text-fg-muted tabular-nums">
            {Math.round(progress * 100)} %
          </span>
          <Button variant="ghost" size="sm" onClick={() => work.current?.abort()}>
            Abbrechen
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {cuttable && selection ? (
            <Button size="sm" variant="secondary" icon="contentCut" onClick={cutSelection}>
              Herausschneiden
            </Button>
          ) : cuttable && autoCut ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void askAi()}
              disabled={asking}
              title="Pausen und Versprecher markieren – jeder Schnitt lässt sich zurücknehmen"
            >
              {asking ? (
                <Spinner size={14} label="Die KI hört zu" />
              ) : (
                <Icon name="autoAwesome" size={16} />
              )}
              KI-Schnitt
              <Badge>Beta</Badge>
            </Button>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted tabular-nums">
            {untouched
              ? formatDuration(durationMs)
              : `${formatDuration(keptLength * 1000)} von ${formatDuration(durationMs)}`}
          </span>
          {actions}
          {(!onlyWhenCut || !untouched) && (
            <Button size="sm" variant="primary" onClick={() => void done()} disabled={asking}>
              {doneLabel}
            </Button>
          )}
        </div>
      )}
      {error ? (
        <ErrorText role="alert" size="xs">
          {error}
        </ErrorText>
      ) : (
        note && (
          <p role="status" className="text-xs text-fg-muted">
            {note}
          </p>
        )
      )}
    </div>
  );
}
