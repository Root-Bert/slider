import { cn, Icon } from '@/ui';
import { MEDIA_KINDS, MEDIA_SOON } from '../lib/media-kinds';

/** Text / Audio / Video / Bild switch of the composers (Figma B2, B4 "Tabs"). */
export function MediaTabs({ className }: { className?: string }) {
  return (
    <div
      role="tablist"
      aria-label="Kommentarart"
      className={cn('flex w-fit items-center gap-1 rounded-[12px] bg-white/5 p-1', className)}
    >
      {MEDIA_KINDS.map((kind) => (
        <button
          key={kind.id}
          type="button"
          role="tab"
          aria-selected={kind.enabled}
          aria-disabled={!kind.enabled || undefined}
          tabIndex={kind.enabled ? 0 : -1}
          title={kind.enabled ? undefined : MEDIA_SOON}
          className={cn(
            'flex items-center gap-1.5 rounded-lg py-1.5 pr-3 pl-2.5 text-xs font-medium',
            kind.enabled ? 'bg-white/12 text-fg' : 'cursor-not-allowed text-fg-subtle',
          )}
        >
          <Icon name={kind.icon} size={16} />
          {kind.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Audio / Video / Bild icons beside a reply field. Text needs no button – typing is the text
 * reply; the others stay visible but disabled until BER-116.
 */
export function MediaSoonButtons({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <>
      {MEDIA_KINDS.filter((kind) => !kind.enabled).map((kind) => (
        <button
          key={kind.id}
          type="button"
          aria-label={`${kind.label} – ${MEDIA_SOON}`}
          aria-disabled
          tabIndex={-1}
          title={MEDIA_SOON}
          className={cn(
            'flex shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-fg-faint',
            size === 'sm' ? 'size-7' : 'size-8',
          )}
        >
          <Icon name={kind.icon} size={18} />
        </button>
      ))}
    </>
  );
}
