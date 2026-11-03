import type { Comment, CommentMedia } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useRetryTranscript } from '@/lib/api';
import { cn, Icon, IconButton } from '@/ui';
import { formatDuration } from '@/lib/format';
import { MEDIA_LABELS } from './lib/recording';
import { useViewerToast } from '../state/viewer-toast';
import { Waveform } from './Waveform';

/**
 * Voice note with play/pause, waveform scrubber and time. Uses the stored duration – a stream's
 * own duration can be unknown until it has loaded completely.
 */
export function AudioPlayer({
  src,
  durationMs,
  peaks,
  className,
}: {
  src: string;
  durationMs: number;
  peaks: readonly number[];
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  // Smooth progress while playing; `timeupdate` alone fires only ~4× per second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setPositionMs(audioRef.current.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = (fraction * durationMs) / 1000;
    setPositionMs(fraction * durationMs);
  };

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <div
      className={cn(
        'relative z-(--z-raised) flex items-center gap-2 rounded-control bg-well-dark py-1 pr-2.5 pl-1',
        className,
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPositionMs(0);
        }}
      />
      <IconButton
        variant="primary"
        size="compact"
        shape="round"
        icon={playing ? 'pause' : 'playArrow'}
        label={playing ? 'Pause' : 'Abspielen'}
        title={false}
        onClick={toggle}
      />
      <Waveform peaks={peaks} progress={progress} onSeek={seek} label="Position in der Aufnahme" />
      <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
        {playing || positionMs > 0 ? formatDuration(positionMs) : formatDuration(durationMs)}
      </span>
    </div>
  );
}

export function VideoPlayer({ src, className }: { src: string; className?: string }) {
  // Safari draws a native video (and its controls) on its own layer and ignores the element's
  // own radius – a clipping wrapper with its own stacking context rounds it everywhere.
  return (
    <div
      className={cn(
        'relative isolate z-(--z-raised) overflow-hidden rounded-control bg-canvas [transform:translateZ(0)]',
        className,
      )}
    >
      <video
        // Safari shows no first frame for `preload="metadata"`; a start time just past 0 makes it
        // load and draw one, so a stopped recording has its picture instead of a black box.
        src={`${src}#t=0.001`}
        controls
        playsInline
        preload="metadata"
        className="block max-h-72 w-full bg-canvas object-contain"
      />
    </div>
  );
}

/**
 * The transcript under a recording: its summary once the comment went to the AI, else three
 * lines – the whole transcript on demand.
 */
function Transcript({ text, summary }: { text: string; summary: string | null }) {
  const [open, setOpen] = useState(false);
  const more = summary ? true : text.length > 160;
  return (
    <div className="relative z-10 flex flex-col items-start gap-0.5">
      <p
        className={cn(
          'text-[12px] leading-[17px] break-words whitespace-pre-wrap text-fg-muted',
          !open && !summary && 'line-clamp-3',
        )}
      >
        <Icon
          name={summary && !open ? 'autoAwesome' : 'notes'}
          size={13}
          className="mr-1 inline -translate-y-px text-fg-subtle"
        />
        {open || !summary ? text : summary}
      </p>
      {more && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-[11px] text-fg-subtle hover:text-fg"
        >
          {open ? (summary ? 'Zusammenfassung' : 'Weniger') : 'Ganzes Transkript'}
        </button>
      )}
    </div>
  );
}

/** While the server transcribes, or when it could not: a line, and another try. */
function TranscriptStatus({ comment, media }: { comment: Comment; media: CommentMedia }) {
  const retry = useRetryTranscript(comment.deckId);
  const toast = useViewerToast();
  if (media.transcriptStatus === 'pending' || retry.isPending) {
    return <p className="text-[11px] text-fg-subtle italic">Transkript wird erstellt …</p>;
  }
  if (media.transcriptStatus !== 'failed') return null;
  return (
    <button
      type="button"
      onClick={() => retry.mutate(media.id, { onError: (error) => toast(error.message, 'danger') })}
      className="relative z-10 w-fit text-[11px] text-fg-subtle underline underline-offset-2 hover:text-fg"
    >
      Kein Transkript – erneut versuchen
    </button>
  );
}

/** A comment's recording with its transcript (BER-116). Renders nothing for text comments. */
export function CommentMediaView({ comment }: { comment: Comment }) {
  const { media } = comment;
  if (!media) return null;
  return (
    <div className="flex flex-col gap-1.5" aria-label={MEDIA_LABELS[media.kind].noun}>
      {media.kind === 'audio' ? (
        <AudioPlayer src={media.url} durationMs={media.durationMs} peaks={media.peaks} />
      ) : (
        <VideoPlayer src={media.url} />
      )}
      {media.transcript ? (
        <Transcript text={media.transcript} summary={media.transcriptSummary} />
      ) : (
        <TranscriptStatus comment={comment} media={media} />
      )}
    </div>
  );
}
