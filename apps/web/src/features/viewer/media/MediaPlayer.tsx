import type { Comment } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { cn, Icon } from '@/ui';
import { formatDuration, MEDIA_LABELS } from './recording';
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
  // Safari draws a native video (and its controls) on its own layer and ignores the element's
  // own radius – a clipping wrapper with its own stacking context rounds it everywhere.
  return (
    <div
      className={cn(
        'relative isolate z-10 overflow-hidden rounded-control bg-black [transform:translateZ(0)]',
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
        className="block max-h-72 w-full bg-black object-contain"
      />
    </div>
  );
}

/** A comment's recording (BER-116). Renders nothing for text comments. */
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
    </div>
  );
}
