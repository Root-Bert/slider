import { cn, Icon, type IconName } from '@/ui';

const TABS: { id: string; label: string; icon: IconName; enabled: boolean }[] = [
  { id: 'text', label: 'Text', icon: 'notes', enabled: true },
  { id: 'audio', label: 'Audio', icon: 'mic', enabled: false },
  { id: 'video', label: 'Video', icon: 'cameraVideo', enabled: false },
  { id: 'image', label: 'Bild', icon: 'image', enabled: false },
];

/**
 * Text / Audio / Video / Bild switch of the composers (B2, B4). Only text exists so far;
 * the others are visible but disabled until BER-116.
 */
export function MediaTabs({ className }: { className?: string }) {
  return (
    <div
      role="tablist"
      aria-label="Kommentarart"
      className={cn('flex items-center gap-1 rounded-[10px] bg-white/5 p-0.5', className)}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.enabled}
          aria-disabled={!tab.enabled || undefined}
          tabIndex={tab.enabled ? 0 : -1}
          title={tab.enabled ? undefined : 'Folgt bald'}
          className={cn(
            'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs',
            tab.enabled ? 'bg-white/10 font-medium text-fg' : 'cursor-not-allowed text-fg-faint',
          )}
        >
          <Icon name={tab.icon} size={14} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
