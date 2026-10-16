import { MAX_MEDIA_DURATION_MS, type MediaKind } from '@slider/shared';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Button,
  cn,
  ErrorText,
  Icon,
  IconButton,
  Kbd,
  SegmentedControl,
  Spinner,
  type Segment,
} from '@/ui';
import { AudioPlayer, VideoPlayer } from './MediaPlayer';
import { formatDuration, formatFileSize } from '@/lib/format';
import { canShareScreen, type VideoSource } from './lib/recording';
import { useMediaUsage } from './hooks/useMediaComment';
import { useRecorder, type Recording } from './hooks/useRecorder';
import { isModKey } from '@/lib/keyboard';

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

const NO_SCREEN = 'Bildschirm teilen geht in diesem Browser nicht';

const VIDEO_SOURCES = (screen: boolean): readonly Segment<VideoSource>[] => [
  { value: 'camera', label: 'Kamera', icon: 'cameraVideo' },
  {
    value: 'screen',
    label: 'Bildschirm',
    icon: 'screenShare',
    disabled: !screen,
    title: screen ? undefined : NO_SCREEN,
  },
  {
    value: 'both',
    label: 'Beides',
    icon: 'pictureInPicture',
    disabled: !screen,
    title: screen ? 'Bildschirm mit Kamera in der Ecke' : NO_SCREEN,
  },
];

/** What the start button records – told by its icon alone, the label is always „Aufnahme starten“. */
const IDLE_ICONS = {
  camera: 'cameraVideo',
  screen: 'screenShare',
  both: 'pictureInPicture',
} as const satisfies Record<VideoSource, string>;

/**
 * Records a voice or video comment (BER-116): record → stop → listen/watch → send or record
 * again. Five minutes at most; compressed while recording. Keyboard: Space starts, pauses and
 * resumes (afterwards: plays and pauses the recording), ↵ stops.
 *
 * Video picks its picture first: camera, shared screen, or both (camera bubble in the corner).
 */
export function RecorderPanel(props: RecorderPanelProps) {
  const [source, setSource] = useState<VideoSource>('camera');
  if (props.kind !== 'video') return <RecorderBody {...props} source="camera" />;
  // Remount per source: the previous camera or screen goes off.
  return <RecorderBody key={source} {...props} source={source} onSourceChange={setSource} />;
}

function RecorderBody({
  kind,
  deckId,
  onChange,
  autoStart = false,
  autoFocus = false,
  onTab,
  source,
  onSourceChange,
}: RecorderPanelProps & {
  source: VideoSource;
  onSourceChange?: (source: VideoSource) => void;
}) {
  const { state, stream, levels, elapsedMs, start, stop, pause, resume, reset } = useRecorder(
    kind,
    { autoStart: autoStart && kind === 'audio', source },
  );
  const [screenSupported] = useState(canShareScreen);
  const rootRef = useRef<HTMLDivElement>(null);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const recording = state.status === 'recorded' ? state.recording : null;
  const paused = state.status === 'paused';
  const recordingNow = state.status === 'recording' || paused;

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isModKey(event) || event.altKey || event.nativeEvent.isComposing) return;
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
      className="flex flex-col gap-2 rounded-control outline-none"
    >
      {onSourceChange && !recording && !recordingNow && (
        <SegmentedControl
          label="Bildquelle"
          segments={VIDEO_SOURCES(screenSupported)}
          value={source}
          onChange={onSourceChange}
        />
      )}

      {kind === 'video' && !recording && (
        <CameraPreview
          stream={stream}
          source={source}
          recording={recordingNow}
          paused={paused}
          elapsedMs={elapsedMs}
        />
      )}

      {state.status === 'error' ? (
        <div className="flex items-start gap-2 rounded-control-sm bg-danger/10 px-3 py-2">
          <ErrorText role="alert" size="xs" className="flex-1">
            {state.message}
          </ErrorText>
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
            <span className="text-caption text-fg-subtle tabular-nums">
              {formatDuration(recording.durationMs)} · {formatFileSize(recording.blob.size)}
            </span>
            <Button variant="ghost" size="sm" icon="replay" onClick={reset}>
              Neu aufnehmen
            </Button>
          </div>
        </div>
      ) : recordingNow ? (
        <div className="flex items-center gap-3 rounded-control bg-well-dark py-1.5 pr-3 pl-1.5">
          <IconButton
            ref={recordButtonRef}
            variant="danger"
            size="lg"
            shape="round"
            icon="stop"
            label="Aufnahme beenden"
            title="Aufnahme beenden (↵)"
            onClick={stop}
          />
          <IconButton
            size="compact"
            shape="round"
            icon={paused ? 'playArrow' : 'pause'}
            label={paused ? 'Aufnahme fortsetzen' : 'Aufnahme pausieren'}
            title={paused ? 'Fortsetzen (Leertaste)' : 'Pausieren (Leertaste)'}
            onClick={paused ? resume : pause}
          />
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
        </div>
      ) : (
        <Button
          ref={recordButtonRef}
          variant="secondary"
          onClick={() => void start()}
          disabled={state.status === 'requesting'}
          title="Aufnahme starten (Leertaste)"
          className="w-full"
        >
          {state.status === 'requesting' ? (
            <Spinner size={16} />
          ) : (
            <Icon
              name={kind === 'audio' ? 'mic' : IDLE_ICONS[source]}
              size={18}
              className="text-danger"
            />
          )}
          {state.status === 'requesting'
            ? kind === 'audio'
              ? 'Zugriff auf Mikrofon …'
              : source === 'camera'
                ? 'Zugriff auf Kamera …'
                : 'Bildschirm auswählen …'
            : 'Aufnahme starten'}
          {state.status !== 'requesting' && <Kbd className="-mr-1">Leertaste</Kbd>}
        </Button>
      )}

      <StorageHint deckId={deckId} />
    </div>
  );
}

// Anchored right and clipped: in a narrow panel the oldest bars drop off instead of running under the time.
function LiveLevels({ levels, paused }: { levels: readonly number[]; paused: boolean }) {
  const bars = Array.from({ length: 40 }, (_, i) => levels[levels.length - 40 + i] ?? 0);
  return (
    <div
      aria-hidden
      className={cn(
        'flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden',
        paused && 'opacity-40',
      )}
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
  source,
  recording,
  paused,
  elapsedMs,
}: {
  stream: MediaStream | null;
  source: VideoSource;
  recording: boolean;
  paused: boolean;
  elapsedMs: number;
}) {
  // A callback ref: the preview's video element changes between the full frame and the bubble.
  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      if (video && video.srcObject !== stream) video.srcObject = stream;
    },
    [stream],
  );
  // Before recording, "Beides" shows the layout: the screen to come, the camera as its bubble.
  const bubbleOnly = source === 'both' && !recording;
  const showsScreen = source !== 'camera' && recording;

  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-canvas">
      {bubbleOnly || (source === 'screen' && !recording) ? (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-surface-1 text-fg-faint">
          <Icon name="screenShare" size={28} />
          <span className="text-caption">Bildschirm wählst du beim Start</span>
        </div>
      ) : stream ? (
        // Not mirrored: the preview shows exactly what the recording will show.
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={cn('size-full', showsScreen ? 'object-contain' : 'object-cover')}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-fg-faint">
          <Icon name="cameraVideo" size={28} />
        </div>
      )}
      {bubbleOnly && (
        <div className="absolute right-[4%] bottom-[6%] flex aspect-[4/3] h-[46%] items-center justify-center overflow-hidden rounded-[10.5%/14%] bg-canvas text-fg-faint shadow-float after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-hairline-strong">
          {stream ? (
            <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover" />
          ) : (
            <Icon name="cameraVideo" size={20} />
          )}
        </div>
      )}
      {recording && (
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-chip bg-scrim px-2 py-0.5 text-caption font-medium text-fg tabular-nums">
          <span className={cn('size-2 rounded-full bg-danger', !paused && 'animate-pulse')} />
          {formatDuration(elapsedMs)}
          {paused && ' · Pause'}
        </span>
      )}
    </div>
  );
}

/** "Max. 5 Min., Transkript entsteht auf deinem Gerät. 1,2 GB von 5 GB belegt." – no storage line without a quota. */
function StorageHint({ deckId }: { deckId: string }) {
  const usage = useMediaUsage(deckId).data;
  const limitBytes = usage?.limitBytes ?? null;
  const nearlyFull = usage && limitBytes !== null && usage.usedBytes / limitBytes > 0.9;
  return (
    <p className={cn('text-caption', nearlyFull ? 'text-warning' : 'text-fg-faint')}>
      Max. 5 Min., Transkript entsteht auf deinem Gerät.
      {usage &&
        limitBytes !== null &&
        ` ${formatFileSize(usage.usedBytes)} von ${formatFileSize(limitBytes)} belegt.`}
    </p>
  );
}
