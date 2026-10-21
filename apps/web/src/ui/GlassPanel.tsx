import type { ComponentPropsWithRef, ElementType } from 'react';
import { cn } from './cn';

export type GlassPanelTone = 'default' | 'elevated';

type GlassPanelProps<T extends ElementType> = {
  as?: T;
  /** `elevated` is more opaque – for dialogs and popovers above busy content. */
  tone?: GlassPanelTone;
} & Omit<ComponentPropsWithRef<T>, 'as'>;

/** UI kit "Pill / Glass": the frosted container used for every floating control (`glass-control`). */
export function GlassPanel<T extends ElementType = 'div'>({
  as,
  tone = 'default',
  className,
  ...props
}: GlassPanelProps<T>) {
  const Component: ElementType = as ?? 'div';
  return (
    <Component
      className={cn(
        tone === 'elevated' ? 'glass-elevated' : 'glass-control',
        'rounded-panel',
        className,
      )}
      {...props}
    />
  );
}
