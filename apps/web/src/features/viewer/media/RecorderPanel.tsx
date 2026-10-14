import { MAX_MEDIA_DURATION_MS, type MediaKind } from '@slider/shared';
import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from 'react';
import { Button, cn, Icon, Spinner } from '@/ui';
import { AudioPlayer, VideoPlayer } from './MediaPlayer';
import { formatBytes, formatDuration } from './recording';
import { useMediaUsage } from './useMediaComment';
import { useRecorder, type Recording } from './useRecorder';

interface RecorderPanelProps {
  kind: MediaKind;
  deckId: string;
  /** The finished recording, or `null` while there is none (again). */
  onChange: (recording: Recording | null) => void;
  /** Start recording right away (audio), e.g. after a click on the reply bar's mic. */
  autoStart?: boolean;
  /** Take the keyboard on opening: Space and ↵ work right away. */
  autoFocus?: boolean;
  /** Tab / Shift+Tab out of the panel – the composer moves to the next or previous format. */
  onTab?: (backwards: boolean) => void;
}

/**
 * Records a voice or video comment (BER-116): record → stop → listen/watch → send or record
 * again. Five minutes at most; compressed while recording, transcribed on this device after
 * sending. Keyboard: Space starts, pauses and resumes (afterwards: plays and pauses the
 * recording), ↵ stops.
 */
export function RecorderPanel({
  kind,
  deckId,
  onChange,
  autoStart = false,
  autoFocus = false,
  onTab,
}: RecorderPanelProps) {
  const { state, stream, levels, elapsedMs, start, stop, pause, resume, reset } = useRecorder(
    kind,
    { autoStart: autoStart && kind === 'audio' },
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const recording = state.status === 'recorded' ? state.recording : null;
  const paused = state.status === 'paused';
  const recordingNow = state.status === 'recording' || paused;

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.key === 'Tab' && onTab) {
      event.preventDefault();
      onTab(event.shiftKey);
      return;
    }
    // Only the panel itself and its record button – other buttons and fields keep their keys.
    if (event.target !== rootRef.current && event.target !== recordButtonRef.current) return;
    const player = rootRef.current?.querySelector<HTMLMediaElement>('audio, video');
    if (event.key === ' ') {
      event.preventDefault();
      if (state.status === 'recording') pause();
      else if (paused) resume();
      else if (state.status === 'idle' || state.status === 'ready') void start();
      else if (recording && player) {
        if (player.paused) void player.play().catch(() => undefined);
        else player.pause();
      }
      return;
    }
    if (event.key === 'Enter') {
      if (recordingNow) stop();
      else if (player && !player.paused) {
        player.pause();
        player.currentTime = 0;
      } else return;
      event.preventDefault();
    }
  };

  const report = useEffectEvent((value: Recording | null) => onChange(value));
  useEffect(() => report(recording), [recording]);

  const remaining = MAX_MEDIA_DURATION_MS - elapsedMs;

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      aria-label={
        kind === 'audio'
          ? 'Sprachkommentar – Leertaste: Aufnahme starten/pausieren, ↵: beenden'
          : 'Videokommentar – Leertaste: Aufnahme starten/pausieren, ↵: beenden'
      }
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2 rounded-control outline-none focus-visible:shadow-[0_0_0_1px_rgb(255_255_255/0.35)]"
    >
      {kind === 'video' && !recording && (
        <CameraPreview
          stream={stream}
          recording={recordingNow}
          paused={paused}
          elapsedMs={elapsedMs}
        />
      )}

      {state.status === 'error' ? (
        <div className="flex items-start gap-2 rounded-control-sm bg-danger/10 px-3 py-2">
          <p role="alert" className="flex-1 text-xs text-danger">
            {state.message}
          </p>
          <Button variant="ghost" size="sm" onClick={reset}>
            Erneut
          </Button>
        </div>
      ) : recording ? (
        <div className="flex flex-col gap-2">
          {recording.kind === 'audio' ? (
            <AudioPlayer
              src={recording.url}
              durationMs={recording.durationMs}
              peaks={recording.peaks}
            />
          ) : (
            <VideoPlayer src={recording.url} />
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-fg-subtle tabular-nums">
              {formatDuration(recording.durationMs)} · {formatBytes(recording.blob.size)}
            </span>
            <Button variant="ghost" size="sm" icon="replay" onClick={reset}>
              Neu aufnehmen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-control bg-black/25 py-1.5 pr-3 pl-1.5">
          <button
            ref={recordButtonRef}
            type="button"
            onClick={recordingNow ? stop : () => void start()}
            disabled={state.status === 'requesting'}
            aria-label={recordingNow ? 'Aufnahme beenden' : 'Aufnahme starten'}
            title={recordingNow ? 'Aufnahme beenden' : 'Aufnahme starten'}
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors',
              recordingNow
                ? 'bg-danger text-white hover:bg-danger/85'
                : 'bg-danger/15 text-danger hover:bg-danger/25',
            )}
          >
            {state.status === 'requesting' ? (
              <Spinner size={16} />
            ) : (
              <Icon name={recordingNow ? 'stop' : kind === 'audio' ? 'mic' : 'record'} size={20} />
            )}
          </button>
          {recordingNow ? (
            <>
              <button
                type="button"
                onClick={paused ? resume : pause}
                aria-label={paused ? 'Aufnahme fortsetzen' : 'Aufnahme pausieren'}
                title={paused ? 'Fortsetzen (Leertaste)' : 'Pausieren (Leertaste)'}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-white/10 hover:text-fg"
              >
                <Icon name={paused ? 'playArrow' : 'pause'} size={18} />
              </button>
              <LiveLevels levels={levels} paused={paused} />
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  remaining < 30_000 ? 'text-warning' : 'text-fg-muted',
                )}
                title="Höchstens 5 Minuten"
              >
                {formatDuration(elapsedMs)} / {formatDuration(MAX_MEDIA_DURATION_MS)}
              </span>
            </>
          ) : (
            <span className="text-xs text-fg-muted">
              {state.status === 'requesting'
                ? `Zugriff auf ${kind === 'audio' ? 'Mikrofon' : 'Kamera'} …`
                : kind === 'audio'
                  ? 'Sprachkommentar aufnehmen'
                  : 'Videokommentar aufnehmen'}
              {state.status !== 'requesting' && <span className="text-fg-faint"> · Leertaste</span>}
            </span>
          )}
        </div>
      )}

      <StorageHint deckId={deckId} />
    </div>
  );
}

function LiveLevels({ levels, paused }: { levels: readonly number[]; paused: boolean }) {
  const bars = Array.from({ length: 40 }, (_, i) => levels[levels.length - 40 + i] ?? 0);
  return (
    <div
      aria-hidden
      className={cn('flex h-6 min-w-0 flex-1 items-center gap-[2px]', paused && 'opacity-40')}
    >
      {bars.map((level, index) => (
        <span
          key={index}
          className="min-w-[2px] flex-1 rounded-full bg-danger/80"
          style={{ height: `${Math.max(8, Math.round(level * 100))}%` }}
        />
      ))}
    </div>
  );
}

function CameraPreview({
  stream,
  recording,
  paused,
  elapsedMs,
}: {
  stream: MediaStream | null;
  recording: boolean;
  paused: boolean;
  elapsedMs: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-black">
      {stream ? (
        // Mirrored like a mirror – the recording itself is not.
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="size-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-fg-faint">
          <Icon name="cameraVideo" size={28} />
        </div>
      )}
      {recording && (
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-chip bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
          <span className={cn('size-2 rounded-full bg-danger', !paused && 'animate-pulse')} />
          {formatDuration(elapsedMs)}
          {paused && ' · Pause'}
        </span>
      )}
    </div>
  );
}

/** "Transkript entsteht auf deinem Gerät · 1,2 GB von 5 GB belegt" – no storage line without a quota. */
function StorageHint({ deckId }: { deckId: string }) {
  const usage = useMediaUsage(deckId).data;
  const limitBytes = usage?.limitBytes ?? null;
  const nearlyFull = usage && limitBytes !== null && usage.usedBytes / limitBytes > 0.9;
  return (
    <p className={cn('text-[11px]', nearlyFull ? 'text-warning' : 'text-fg-faint')}>
      Max. 5 Min. · Transkript entsteht auf deinem Gerät
      {usage &&
        limitBytes !== null &&
        ` · ${formatBytes(usage.usedBytes)} von ${formatBytes(limitBytes)} belegt`}
    </p>
  );
}
