import { cn, Icon } from '@/ui';
import type { SlideBadge, SlideBadgeKind } from '../lib/revision-changes';

const toneClasses: Record<SlideBadgeKind, string> = {
  new: 'text-success shadow-[inset_0_0_0_1px_rgb(46_204_113/0.45)]',
  modified: 'text-warning shadow-[inset_0_0_0_1px_rgb(245_166_35/0.45)]',
  moved: 'text-info shadow-[inset_0_0_0_1px_rgb(77_159_255/0.45)]',
};

/**
 * Sits under the slide's pins and annotations (no z-index of its own), so it never hides or
 * swallows a comment near the corner.
 *
 * "Neu" / "Geändert" / "Verschoben 4→2" chip of the latest revision (Figma D2) – dark, so it
 * reads on white and on dark slides. `size="mini"` is the minimap's thumbnail variant.
 */
export function ChangeBadge({
  badge,
  version,
  size = 'track',
  className,
}: {
  badge: SlideBadge;
  /** Revision of the change – shown as "· V4" on the big chip (Figma D2), not on tiny ones. */
  version?: number;
  size?: 'track' | 'mini';
  className?: string;
}) {
  const mini = size === 'mini';
  return (
    <span
      data-change-badge={badge.kind}
      title={badge.description}
      className={cn(
        'pointer-events-auto inline-flex max-w-full items-center bg-black/75 font-medium whitespace-nowrap backdrop-blur',
        mini
          ? 'h-3.5 gap-0.5 rounded-thumb px-1 text-[9px] leading-3'
          : 'h-6 gap-1 rounded-badge px-2.5 text-xs',
        toneClasses[badge.kind],
        className,
      )}
    >
      {badge.uncertain && (
        <Icon name="warning" size={mini ? 9 : 14} className="shrink-0 text-warning" />
      )}
      {/* Tiny chips say "↔ 4→2" instead of "Verschoben 4→2". */}
      {mini && badge.kind === 'moved' && (
        <Icon name="compareArrows" size={9} className="shrink-0 text-info" />
      )}
      <span className="truncate">{mini ? badge.short || badge.label : badge.label}</span>
      {badge.moved && badge.kind !== 'moved' && (
        <Icon name="compareArrows" size={mini ? 9 : 14} className="shrink-0 text-info" />
      )}
      {!mini && version !== undefined && (
        <span aria-hidden className="shrink-0 text-fg-muted">
          · V{version}
        </span>
      )}
      <span className="sr-only">{badge.description}</span>
    </span>
  );
}
