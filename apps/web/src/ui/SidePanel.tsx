import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Side panel over the track (thread B4, deleted slides): a floating glass card at the right edge
 * from tablet up, a bottom sheet on phones. It slides in when it mounts and takes the focus
 * itself (`tabIndex={-1}`), so callers focus it from an effect. `data-side-panel` lets
 * `revealSlide` keep slides clear of it; callers add their own `data-*` hook.
 */
export function SidePanel({
  className,
  side = 'right',
  ...props
}: ComponentPropsWithRef<'aside'> & {
  /**
   * `left`: the same card at the left edge, at every width (a menu that slides in). `bottom`: the
   * phone's sheet at every width, half as high (centred, at most 720 px) – where the page needs its
   * whole width and the upper half stays the page's.
   */
  side?: 'left' | 'right' | 'bottom';
}) {
  return (
    <aside
      data-side-panel
      tabIndex={-1}
      {...props}
      className={cn(
        'glass-floating fixed z-(--z-panel) flex flex-col overflow-hidden outline-none',
        'transition-transform duration-300 ease-out',
        side === 'left'
          ? 'inset-y-3 left-3 w-[min(320px,calc(100vw-24px))] rounded-panel starting:-translate-x-[calc(100%+12px)]'
          : side === 'bottom'
            ? 'inset-x-0 bottom-0 mx-auto max-h-[50dvh] w-full max-w-[720px] rounded-t-panel starting:translate-y-full'
            : cn(
                // Phone: bottom sheet.
                'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-panel starting:translate-y-full',
                // Tablet and up: a floating glass card at the right edge.
                'md:inset-y-3 md:right-3 md:left-auto md:max-h-none md:w-[400px] md:rounded-panel md:starting:translate-x-[calc(100%+12px)] md:starting:translate-y-0',
              ),
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
