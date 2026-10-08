import type { KeyboardEvent, PointerEvent } from 'react';
import { cn } from '@/ui';

/** Fallback when a recording has no peaks: a calm, even line of bars. */
const FLAT = Array.from({ length: 32 }, () => 0.35);

interface WaveformProps {
  peaks: readonly number[];
  /** 0–1: bars left of it are drawn in the accent. */
  progress?: number;
  /** Makes the waveform a scrubber. */
  onSeek?: (fraction: number) => void;
  label?: string;
  className?: string;
}

/** Audio waveform as bars (Figma Desktop-7 voice note); doubles as the seek bar. */
export function Waveform({ peaks, progress = 0, onSeek, label, className }: WaveformProps) {
  const bars = peaks.length > 0 ? peaks : FLAT;
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    if (event.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.05));
    else if (event.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.05));
    else return;
    event.preventDefault();
  };

  return (
    <div
      role={onSeek ? 'slider' : undefined}
      aria-label={onSeek ? label : undefined}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onPointerDown={seek}
      onKeyDown={onKeyDown}
      className={cn(
        'flex h-7 min-w-0 flex-1 items-center gap-[2px]',
        onSeek &&
          'cursor-pointer rounded-badge outline-none focus-visible:ring-1 focus-visible:ring-white/40',
        className,
      )}
    >
      {bars.map((peak, index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            'min-w-[2px] flex-1 rounded-full transition-colors duration-100',
            (index + 0.5) / bars.length <= progress
              ? 'bg-(--card-accent,var(--color-fg))'
              : 'bg-white/25',
          )}
          style={{ height: `${Math.max(12, Math.round(peak * 100))}%` }}
        />
      ))}
    </div>
  );
}
