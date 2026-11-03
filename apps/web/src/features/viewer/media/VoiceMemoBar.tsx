import { MAX_MEDIA_DURATION_MS } from '@slider/shared';
import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from 'react';
import { Button, cn, ErrorText, IconButton, Spinner } from '@/ui';
import { formatDuration } from '@/lib/format';
import { isModKey } from '@/lib/keyboard';
import { AudioPlayer } from './MediaPlayer';
import { LiveLevels } from './RecorderPanel';
import { useRecorder, type Recording } from './hooks/useRecorder';

/**
 * A voice memo right in a reply field, like a messenger's: recording starts at once, stop leaves
 * the memo to listen to, the bin drops it. It takes the field's place – the memo is the reply – and
 * the field's send button sends it, no dialog. Keyboard on the bar: Space pauses and resumes
 * (afterwards plays), ↵ stops, then sends (⌘↵ to the AI as well).
 */
export function VoiceMemoBar({
  onChange,
  onRecordingChange,
  onDiscard,
  onSend,
  disabled = false,
}: {
  /** The finished memo, or `null` while there is none. */
  onChange: (recording: Recording | null) => void;
  /** Running or paused: not finished (`onChange`) until stopped. */
  onRecordingChange: (recording: boolean) => void;
  /** The bin: the memo goes, the bar closes. */
  onDiscard: () => void;
  /** ↵ on the finished memo; `askAi` with ⌘↵. */
  onSend?: (options: { askAi: boolean }) => void;
  disabled?: boolean;
}) {
  const { state, levels, elapsedMs, stop, pause, resume, reset } = useRecorder('audio', {
    autoStart: true,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const recording = state.status === 'recorded' ? state.recording : null;
  const paused = state.status === 'paused';
  const recordingNow = state.status === 'recording' || paused;

  // Takes the keyboard: Space and ↵ work right after the click on the mic.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  // Stopping removes the stop button under the focus: the bar keeps it, so Space plays next.
  useEffect(() => {
    if (recording && !rootRef.current?.contains(document.activeElement))
      rootRef.current?.focus({ preventScroll: true });
  }, [recording]);

  const report = useEffectEvent((value: Recording | null) => onChange(value));
  useEffect(() => report(recording), [recording]);
  const reportRecording = useEffectEvent((value: boolean) => onRecordingChange(value));
  useEffect(() => reportRecording(recordingNow), [recordingNow]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== rootRef.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && recording && onSend && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onSend({ askAi: isModKey(event) });
      return;
    }
    if (isModKey(event) || event.altKey) return;
    const player = rootRef.current.querySelector('audio');
    if (event.key === ' ') {
      event.preventDefault();
      if (state.status === 'recording') pause();
      else if (paused) resume();
      else if (recording && player) {
        if (player.paused) void player.play().catch(() => undefined);
        else player.pause();
      }
    } else if (event.key === 'Enter' && recordingNow) {
      event.preventDefault();
      stop();
    }
  };

  const remaining = MAX_MEDIA_DURATION_MS - elapsedMs;
  const discard = (
    <IconButton
      icon="delete"
      label="Sprachmemo löschen"
      title="Löschen"
      variant="subtle"
      size="compact"
      disabled={disabled}
      onClick={onDiscard}
    />
  );

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      aria-label="Sprachmemo – Leertaste: pausieren/fortsetzen, ↵: beenden"
      onKeyDown={onKeyDown}
      className="flex min-w-0 items-center gap-1.5 rounded-control outline-none"
    >
      {discard}
      {state.status === 'error' ? (
        <>
          <ErrorText role="alert" size="xs" className="min-w-0 flex-1">
            {state.message}
          </ErrorText>
          <Button variant="ghost" size="sm" onClick={reset}>
            Erneut
          </Button>
        </>
      ) : recording ? (
        <AudioPlayer
          src={recording.url}
          durationMs={recording.durationMs}
          peaks={recording.peaks}
          className="min-w-0 flex-1"
        />
      ) : recordingNow ? (
        <>
          <span
            aria-hidden
            className={cn('size-2 shrink-0 rounded-full bg-danger', !paused && 'animate-pulse')}
          />
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              remaining < 30_000 ? 'text-warning' : 'text-fg-muted',
            )}
            title="Höchstens 5 Minuten"
          >
            {formatDuration(elapsedMs)}
          </span>
          <LiveLevels levels={levels} paused={paused} />
          <IconButton
            size="compact"
            shape="round"
            variant="subtle"
            icon={paused ? 'playArrow' : 'pause'}
            label={paused ? 'Aufnahme fortsetzen' : 'Aufnahme pausieren'}
            title={paused ? 'Fortsetzen (Leertaste)' : 'Pausieren (Leertaste)'}
            onClick={paused ? resume : pause}
          />
          <IconButton
            size="compact"
            shape="round"
            variant="danger"
            icon="stop"
            label="Aufnahme beenden"
            title="Aufnahme beenden (↵)"
            onClick={stop}
          />
        </>
      ) : (
        <p
          role="status"
          className="flex min-w-0 flex-1 items-center gap-2 text-caption text-fg-subtle"
        >
          <Spinner size={14} />
          Zugriff auf Mikrofon …
        </p>
      )}
    </div>
  );
}
