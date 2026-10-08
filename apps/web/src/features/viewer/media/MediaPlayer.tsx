import type { Comment, CommentMedia } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { cn, Icon } from '@/ui';
import { formatDuration, MEDIA_LABELS } from './recording';
import { useViewerData } from '../state/viewer-data';
import { transcribeInBackground, useTranscriptionProgress } from './transcription';
import { Waveform } from './Waveform';

/** A transcript that has not arrived after this long is not coming (tab closed, device gave up). */
const TRANSCRIPT_WAIT_MS = 15 * 60_000;

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
        'relative z-10 flex items-center gap-2 rounded-control bg-black/25 py-1 pr-2.5 pl-1',
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
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Abspielen'}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/90 text-black hover:bg-white"
      >
        <Icon name={playing ? 'pause' : 'playArrow'} size={18} />
      </button>
      <Waveform peaks={peaks} progress={progress} onSeek={seek} label="Position in der Aufnahme" />
      <span className="shrink-0 text-[11px] text-fg-subtle tabular-nums">
        {playing || positionMs > 0 ? formatDuration(positionMs) : formatDuration(durationMs)}
      </span>
    </div>
  );
}

export function VideoPlayer({ src, className }: { src: string; className?: string }) {
  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      className={cn(
        'relative z-10 max-h-72 w-full rounded-control bg-black object-contain',
        className,
      )}
    />
  );
}

function TranscriptStatus({ comment, media }: { comment: Comment; media: CommentMedia }) {
  const local = useTranscriptionProgress(media.id);
  const { viewer } = useViewerData();
  const queryClient = useQueryClient();
  // When this card appeared – good enough to tell a fresh recording from an abandoned one.
  const [shownAt] = useState(Date.now);
  if (local) {
    const text =
      local.phase === 'loading'
        ? `Spracherkennung wird geladen (einmalig) … ${Math.round(local.progress * 100)} %`
        : 'Transkript wird auf deinem Gerät erstellt …';
    return <p className="text-[11px] text-fg-subtle italic">{text}</p>;
  }
  // The recording tab was closed before the transcript was done, or the device gave up: whoever
  // recorded it can run it again here – the recording is fetched back, nothing leaves the device.
  if (comment.author.id === viewer.author.id && media.transcriptStatus !== 'done') {
    return (
      <button
        type="button"
        onClick={() =>
          transcribeInBackground({
            queryClient,
            deckId: comment.deckId,
            mediaId: media.id,
            audio: async () => (await fetch(media.url, { credentials: 'same-origin' })).blob(),
          })
        }
        className="relative z-10 w-fit text-[11px] text-fg-subtle underline underline-offset-2 hover:text-fg"
      >
        {media.transcriptStatus === 'failed'
          ? 'Kein Transkript – erneut versuchen'
          : 'Transkript erstellen'}
      </button>
    );
  }
  const waiting =
    media.transcriptStatus === 'pending' &&
    shownAt - Date.parse(comment.createdAt) < TRANSCRIPT_WAIT_MS;
  return waiting ? <p className="text-[11px] text-fg-subtle italic">Transkript folgt …</p> : null;
}

/** The transcript under a recording: three lines, the rest on demand. */
function Transcript({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className="relative z-10 flex flex-col items-start gap-0.5">
      <p
        className={cn(
          'text-[12px] leading-[17px] break-words whitespace-pre-wrap text-fg-muted',
          !open && 'line-clamp-3',
        )}
      >
        <Icon name="notes" size={13} className="mr-1 inline -translate-y-px text-fg-subtle" />
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-[11px] text-fg-subtle hover:text-fg"
        >
          {open ? 'Weniger' : 'Ganzes Transkript'}
        </button>
      )}
    </div>
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
        <Transcript text={media.transcript} />
      ) : (
        <TranscriptStatus comment={comment} media={media} />
      )}
    </div>
  );
}
