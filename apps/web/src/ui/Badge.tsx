import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'success' | 'warning' | 'info' | 'danger' | 'powerpoint' | 'neutral';

/** UI kit "Badge": 20px pill, 10 % tinted background, coloured medium 11px text. */
const toneClasses: Record<BadgeTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  danger: 'bg-danger/10 text-danger',
  powerpoint: 'bg-powerpoint/10 text-powerpoint',
  neutral: 'bg-white/10 text-fg-muted',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-badge px-2 text-[11px] leading-[14px] font-medium whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
