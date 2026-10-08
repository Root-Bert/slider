import { MAX_MEDIA_DURATION_MS, type MediaKind } from '@slider/shared';
import { useEffect, useEffectEvent, useRef } from 'react';
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
}

/**
 * Records a voice or video comment (BER-116): record → stop → listen/watch → send or record
 * again. Five minutes at most; compressed while recording, transcribed on this device after
 * sending.
 */
export function RecorderPanel({ kind, deckId, onChange, autoStart = false }: RecorderPanelProps) {
  const { state, stream, levels, elapsedMs, start, stop, reset } = useRecorder(kind, {
    autoStart: autoStart && kind === 'audio',
  });
  const recording = state.status === 'recorded' ? state.recording : null;
  const recordingNow = state.status === 'recording';

  const report = useEffectEvent((value: Recording | null) => onChange(value));
  useEffect(() => report(recording), [recording]);

  const remaining = MAX_MEDIA_DURATION_MS - elapsedMs;

  return (
    <div className="flex flex-col gap-2">
      {kind === 'video' && !recording && (
        <CameraPreview stream={stream} recording={recordingNow} elapsedMs={elapsedMs} />
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
              <LiveLevels levels={levels} />
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
            </span>
          )}
        </div>
      )}

      <StorageHint deckId={deckId} />
    </div>
  );
}

function LiveLevels({ levels }: { levels: readonly number[] }) {
  const bars = Array.from({ length: 40 }, (_, i) => levels[levels.length - 40 + i] ?? 0);
  return (
    <div aria-hidden className="flex h-6 min-w-0 flex-1 items-center gap-[2px]">
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
  elapsedMs,
}: {
  stream: MediaStream | null;
  recording: boolean;
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
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          {formatDuration(elapsedMs)}
        </span>
      )}
    </div>
  );
}

/** "Transkript entsteht auf deinem Gerät · 1,2 GB von 5 GB belegt". */
function StorageHint({ deckId }: { deckId: string }) {
  const usage = useMediaUsage(deckId).data;
  const nearlyFull = usage && usage.usedBytes / usage.limitBytes > 0.9;
  return (
    <p className={cn('text-[11px]', nearlyFull ? 'text-warning' : 'text-fg-faint')}>
      Max. 5 Min. · Transkript entsteht auf deinem Gerät
      {usage && ` · ${formatBytes(usage.usedBytes)} von ${formatBytes(usage.limitBytes)} belegt`}
    </p>
  );
}
