import type { ReactNode } from 'react';
import { cn } from './cn';

export type IconTileSize = 32 | 36 | 40 | 56;

/** Concentric radii per tile size (design-system §5). */
const SIZES: Record<IconTileSize, string> = {
  32: 'size-8 rounded-chip',
  36: 'size-9 rounded-control',
  40: 'size-10 rounded-control',
  56: 'size-14 rounded-panel',
};

const TONES = {
  /** Icon in `fg-muted` – list rows, progress cards. */
  muted: 'text-fg-muted',
  /** Icon in `fg` – hero cards (login, join, no access). */
  fg: 'text-fg',
  /** Keeps the inherited colour, e.g. brand marks that bring their own. */
  inherit: '',
  /** Failed state: red tint and icon (replaces `tint`). */
  danger: 'bg-danger/15 text-danger',
} as const;

const TINTS = {
  /** 5 % white – the standard tile. */
  'surface-1': 'bg-surface-1',
  /** 10 % white – tiles on a glass card (upload / import progress). */
  hover: 'bg-hover',
} as const;

export interface IconTileProps {
  size?: IconTileSize;
  tone?: keyof typeof TONES;
  tint?: keyof typeof TINTS;
  /** Not connected / unavailable: the tile fades to 60 %. */
  dimmed?: boolean;
  /** Layout only (margins); the look comes from the props. */
  className?: string;
  children: ReactNode;
}

/** Square tinted tile around an icon or mark (settings rows, hero cards, progress cards). */
export function IconTile({
  size = 36,
  tone = 'muted',
  tint = 'surface-1',
  dimmed = false,
  className,
  children,
}: IconTileProps) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        SIZES[size],
        TONES[tone],
        tone !== 'danger' && TINTS[tint],
        dimmed && 'opacity-60',
        className,
      )}
    >
      {children}
    </span>
  );
}
