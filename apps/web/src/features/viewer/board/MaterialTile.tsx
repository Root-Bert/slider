import type { ReactNode } from 'react';
import { Icon } from '@/ui';

/**
 * The „Material“ tile before the small slides of a presentation and above the small pages of a
 * document: it opens the material page (M). Its box is the place's; `children` lie in it (who is
 * in the material right now).
 */
export function MaterialTile({ onOpen, children }: { onOpen: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      data-board-thumb
      aria-label="Material anzeigen"
      title="Material (M)"
      onClick={onOpen}
      className="flex size-full items-center justify-center rounded-thumb bg-surface-2 text-fg-muted ring-hairline transition-colors hover:bg-selected hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white"
    >
      {/* The icon alone; its name is in the label and the tooltip. */}
      <Icon name="attachFile" size={18} />
      {children}
    </button>
  );
}
