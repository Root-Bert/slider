import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/ui';

/**
 * Side panel over the track (thread B4, deleted slides): a floating glass card at the right edge
 * from tablet up, a bottom sheet on phones. It slides in when it mounts and takes the focus
 * itself (`tabIndex={-1}`), so callers focus it from an effect. `data-side-panel` lets
 * `revealSlide` keep slides clear of it; callers add their own `data-*` hook.
 */
export function SidePanel({ className, ...props }: ComponentPropsWithRef<'aside'>) {
  return (
    <aside
      data-side-panel
      tabIndex={-1}
      {...props}
      className={cn(
        'glass-floating fixed z-(--z-panel) flex flex-col overflow-hidden outline-none',
        'transition-transform duration-300 ease-out',
        // Phone: bottom sheet.
        'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-panel starting:translate-y-full',
        // Tablet and up: a floating glass card at the right edge.
        'md:inset-y-3 md:right-3 md:left-auto md:max-h-none md:w-[400px] md:rounded-panel md:starting:translate-x-[calc(100%+12px)] md:starting:translate-y-0',
        className,
      )}
    />
  );
}

/** The panel's header: title row and meta lines above a hairline. */
export function SidePanelHeader({
  gap = 'md',
  children,
}: {
  /** Space between the header rows: `sm` 6px, `md` 10px. */
  gap?: 'sm' | 'md';
  children: ReactNode;
}) {
  return (
    <header
      className={cn(
        'flex flex-col border-b border-hairline px-5 pt-[18px] pb-3.5',
        gap === 'sm' ? 'gap-1.5' : 'gap-2.5',
      )}
    >
      {children}
    </header>
  );
}
