import { cn, Icon } from '@/ui';
import type { SlideBadge, SlideBadgeKind } from './lib/revision-changes';

const toneClasses: Record<SlideBadgeKind, string> = {
  new: 'text-success inset-ring inset-ring-success/45',
  modified: 'text-warning inset-ring inset-ring-warning/45',
  moved: 'text-info inset-ring inset-ring-info/45',
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
  /** Revision of the change – shown as "| V4" on the big chip (Figma D2), not on tiny ones. */
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
        'glass-dark-strong pointer-events-auto inline-flex max-w-full items-center font-medium whitespace-nowrap',
        mini
          ? 'h-3.5 gap-0.5 rounded-thumb px-1 text-micro leading-3'
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
          | V{version}
        </span>
      )}
      <span className="sr-only">{badge.description}</span>
    </span>
  );
}
