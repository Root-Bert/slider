import { MAX_MEDIA_DURATION_MS, type MediaKind } from '@slider/shared';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
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
  /** Whether a recording is running or paused – it isn't finished (`onChange`) until stopped. */
  onRecordingChange?: (recording: boolean) => void;
  /** Start recording right away (audio), e.g. after a click on the reply bar's mic. */
  autoStart?: boolean;
  /** Take the keyboard on opening: Space and ↵ work right away. */
  autoFocus?: boolean;
  /**
   * The bin beside the take (running or finished): it goes, the recorder closes. Where the
   * recorder was opened by a mic beside a field, the bin takes that mic's place.
   */
  onDiscard?: () => void;
  /**
   * Sends while recording: the take ends and goes at once (the composer sends it, to the AI where
   * there is one). Without it the running take has a stop button there instead.
   */
  onSend?: { run: (askAi: boolean) => void; ai: boolean };
}

const NO_SCREEN = 'Bildschirm teilen geht in diesem Browser nicht';

/** Screen first – a review mostly shows something on it –, then both, then the camera alone. */
const VIDEO_SOURCES = (screen: boolean): readonly Segment<VideoSource>[] => [
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
  { value: 'camera', label: 'Kamera', icon: 'cameraVideo' },
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
 * Video picks its picture first: shared screen (the default where a browser can share it), both
 * (camera bubble in the corner) or the camera.
 */
export function RecorderPanel(props: RecorderPanelProps) {
  const [source, setSource] = useState<VideoSource>(() => (canShareScreen() ? 'screen' : 'camera'));
  if (props.kind !== 'video') return <RecorderBody {...props} source="camera" />;
  // Remount per source: the previous camera or screen goes off.
  return <RecorderBody key={source} {...props} source={source} onSourceChange={setSource} />;
}

function RecorderBody({
  kind,
  deckId,
  onChange,
  onRecordingChange,
  autoStart = false,
  autoFocus = false,
  onDiscard,
  onSend,
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

  // Starting and stopping swap the buttons: the one that had the focus is disabled, then gone,
  // and the focus would drop to <body> – where Space and ↵ no longer reach the panel. So it moves
  // on to the new record button (stop while recording), else to the panel itself.
  const holdsFocus = useRef(false);
  const phase = recording ? 'recorded' : recordingNow ? 'recording' : 'idle';
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!holdsFocus.current || (active && active !== document.body)) return;
    // A start still waiting for the camera is disabled: the panel holds the keys meanwhile.
    const button = recordButtonRef.current;
    (button && !button.disabled ? button : rootRef.current)?.focus({ preventScroll: true });
  }, [phase]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Tab moves the focus as usual: a finished recording must never go with a key press.
    if (isModKey(event) || event.altKey || event.nativeEvent.isComposing) return;
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
  const reportRecording = useEffectEvent((value: boolean) => onRecordingChange?.(value));
  useEffect(() => reportRecording(recordingNow), [recordingNow]);

  const remaining = MAX_MEDIA_DURATION_MS - elapsedMs;
  const discard = onDiscard && (
    <IconButton
      icon="delete"
      label="Aufnahme löschen"
      title="Löschen"
      variant="subtle"
      size="compact"
      onClick={onDiscard}
    />
  );
  // Recording again keeps the place: the take goes, the start comes back.
  const again = (
    <IconButton
      icon="replay"
      label="Neu aufnehmen"
      variant="subtle"
      size="compact"
      onClick={reset}
    />
  );

  // A bar of its own, as wide as the panel – under the preview for video, as the panels' buttons.
  const startButton = (
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
      {state.status === 'requesting' ? requestingLabel(kind, source) : 'Aufnahme starten'}
      {state.status !== 'requesting' && <Kbd className="-mr-1">Leertaste</Kbd>}
    </Button>
  );

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      // The composer's Tab goes on from here to the next kind while nothing is recorded.
      data-recorder
      // In a reply <Dialog> its own focus effect runs while the dialog is still closed: the
      // dialog focuses it once open.
      data-autofocus={autoFocus || undefined}
      aria-label={
        kind === 'audio'
          ? 'Sprachkommentar – Leertaste: Aufnahme starten/pausieren, ↵: beenden'
          : 'Videokommentar – Leertaste: Aufnahme starten/pausieren, ↵: beenden'
      }
      onKeyDown={onKeyDown}
      onFocus={() => {
        holdsFocus.current = true;
      }}
      onBlur={(event) => {
        // To somewhere else on the page – not to nowhere (a button removed or disabled under it).
        const to = event.relatedTarget;
        if (to && !event.currentTarget.contains(to)) holdsFocus.current = false;
      }}
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

      {kind === 'video' && !recording && state.status !== 'error' && (
        <CameraPreview stream={stream} source={source} recording={recordingNow} />
      )}
      {kind === 'video' && !recording && !recordingNow && state.status !== 'error' && startButton}

      {state.status === 'error' ? (
        <div className="flex items-start gap-2 rounded-control-sm bg-danger/10 px-3 py-2">
          <ErrorText role="alert" size="xs" className="flex-1">
            {state.message}
          </ErrorText>
          <Button variant="ghost" size="sm" onClick={reset}>
            Erneut
          </Button>
          {discard}
        </div>
      ) : recording?.kind === 'audio' ? (
        // One block: the take to listen to (its length in the player), again, the bin.
        <div className="flex items-center gap-1">
          <AudioPlayer
            src={recording.url}
            durationMs={recording.durationMs}
            peaks={recording.peaks}
            className="mr-1 min-w-0 flex-1"
          />
          {again}
          {discard}
        </div>
      ) : recording ? (
        <div className="flex flex-col gap-1.5">
          <VideoPlayer src={recording.url} />
          <div className="flex justify-end gap-1">
            {again}
            {discard}
          </div>
        </div>
      ) : recordingNow ? (
        // Pause on the left, send (or stop) on the right – nothing to throw the take away while it
        // runs: Abbrechen does that.
        <div className="flex items-center gap-3 rounded-control bg-well-dark py-1.5 pr-1.5 pl-1.5">
          <IconButton
            ref={recordButtonRef}
            size="sm"
            variant="subtle"
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
          {onSend ? (
            // As the composer's own: ✨ sends and asks the AI, the arrow only sends.
            <span className="flex shrink-0 items-center gap-1">
              {onSend.ai && (
                <IconButton
                  size="sm"
                  icon="autoAwesome"
                  label="Senden und die KI die Folie ändern lassen"
                  title="Senden und an die KI geben"
                  onClick={() => {
                    stop();
                    onSend.run(true);
                  }}
                />
              )}
              <IconButton
                size="sm"
                variant="primary"
                icon="send"
                label="Senden"
                title="Senden"
                onClick={() => {
                  stop();
                  onSend.run(false);
                }}
              />
            </span>
          ) : (
            <IconButton
              variant="danger"
              size="sm"
              icon="stop"
              label="Aufnahme beenden"
              title="Aufnahme beenden (↵)"
              onClick={stop}
            />
          )}
        </div>
      ) : (
        kind === 'audio' && startButton
      )}

      {/* The limit before the start (the running time shows it then), the storage until a take. */}
      {!recording && state.status !== 'error' && (
        <StorageHint deckId={deckId} limit={!recordingNow} />
      )}
    </div>
  );
}

function requestingLabel(kind: MediaKind, source: VideoSource) {
  if (kind === 'audio') return 'Zugriff auf Mikrofon …';
  return source === 'camera' ? 'Zugriff auf Kamera …' : 'Bildschirm auswählen …';
}

// Anchored right and clipped: in a narrow panel the oldest bars drop off instead of running under the time.
export function LiveLevels({ levels, paused }: { levels: readonly number[]; paused: boolean }) {
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

/**
 * The picture to come: the camera live (alone or as the bubble of „Beides“), the screen only once
 * it is picked at the start.
 */
function CameraPreview({
  stream,
  source,
  recording,
}: {
  stream: MediaStream | null;
  source: VideoSource;
  recording: boolean;
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
  const screenToCome = bubbleOnly || (source === 'screen' && !recording);
  const showsScreen = source !== 'camera' && recording;

  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-canvas">
      {screenToCome ? (
        <div className="size-full bg-surface-1" />
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
        <div className="size-full bg-surface-1" />
      )}
      {bubbleOnly && (
        <div className="absolute right-[4%] bottom-[6%] flex aspect-[4/3] h-[40%] items-center justify-center overflow-hidden rounded-[10.5%/14%] bg-canvas text-fg-faint shadow-float after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-hairline-strong">
          {stream ? (
            <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover" />
          ) : (
            <Icon name="cameraVideo" size={20} />
          )}
        </div>
      )}
      {screenToCome && (
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center gap-1.5 text-fg-subtle',
            // Above the bubble of „Beides“, in the middle otherwise.
            bubbleOnly ? 'justify-start pt-[12%]' : 'justify-center',
          )}
        >
          <Icon name="screenShare" size={22} />
          <span className="text-caption">Bildschirm wählst du beim Start</span>
        </div>
      )}
    </div>
  );
}

/** "Max. 5 Min. 1,2 GB von 5 GB belegt." – no storage line without a quota. */
function StorageHint({ deckId, limit }: { deckId: string; limit: boolean }) {
  const usage = useMediaUsage(deckId).data;
  const limitBytes = usage?.limitBytes ?? null;
  const nearlyFull = usage && limitBytes !== null && usage.usedBytes / limitBytes > 0.9;
  const storage =
    usage && limitBytes !== null
      ? `${formatFileSize(usage.usedBytes)} von ${formatFileSize(limitBytes)} belegt.`
      : null;
  if (!limit && !storage) return null;
  return (
    <p className={cn('text-caption', nearlyFull ? 'text-warning' : 'text-fg-faint')}>
      {[limit && 'Max. 5 Min.', storage].filter(Boolean).join(' ')}
    </p>
  );
}
