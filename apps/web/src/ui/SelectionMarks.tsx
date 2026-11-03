import type { Ref } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

/**
 * Tick in the corner of a selected item's picture – decks, fonts, templates alike. `compact` for
 * the small pictures of the list rows.
 */
export function SelectedMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        'absolute z-(--z-raised) flex items-center justify-center rounded-full bg-(--selection) text-(--on-selection) shadow-mark',
        compact ? 'top-1 left-1 size-4' : 'top-2 left-2 size-6',
      )}
    >
      <Icon name="check" size={compact ? 12 : 16} label="Ausgewählt" />
    </span>
  );
}

/**
 * The box dragged over empty space to select what it touches (`useMarqueeSelect` writes its
 * position). In the viewer's selection colour – `selectionStyle` on an ancestor. Over panels on
 * a page; `raised` only above the cards inside a panel (the comments under the slides).
 */
export function SelectionBox({
  ref,
  raised = false,
}: {
  ref: Ref<HTMLDivElement>;
  raised?: boolean;
}) {
  return (
    <div
      ref={ref}
      data-selection-box
      aria-hidden
      className={cn(
        'pointer-events-none absolute rounded-mark border border-(--selection) bg-(--selection)/15',
        raised ? 'z-(--z-raised)' : 'z-(--z-panel)',
      )}
    />
  );
}
