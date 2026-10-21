import { cn, Icon } from '@/ui';

/** What older versions show once their files were deleted ("Alles außer der neuesten Version löschen"). */
const LABEL = 'Ältere Version gelöscht';

/**
 * Neutral stand-in for a slide image of an older version whose files were deleted – instead of a
 * broken image. Fills its (positioned, sized) parent; `small` for thumbnails.
 */
export function DeletedVersionImage({
  small = false,
  className,
}: {
  small?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={LABEL}
      data-deleted-version
      className={cn(
        'flex size-full flex-col items-center justify-center gap-1.5 bg-placeholder px-2 text-center text-fg-subtle',
        className,
      )}
    >
      <Icon name="history" size={small ? 'sm' : 'xl'} className="shrink-0" />
      {!small && <span className="text-xs">{LABEL}</span>}
    </div>
  );
}
