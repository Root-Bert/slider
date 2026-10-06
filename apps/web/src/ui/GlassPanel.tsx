import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cn } from './cn';

type GlassPanelProps<T extends ElementType> = {
  as?: T;
  /** `elevated` is more opaque – for dialogs and popovers above busy content. */
  tone?: 'default' | 'elevated';
} & Omit<ComponentPropsWithoutRef<T>, 'as'>;

/** UI kit "Pill / Glass": the frosted container used for every floating control. */
export function GlassPanel<T extends ElementType = 'div'>({
  as,
  tone = 'default',
  className,
  ...props
}: GlassPanelProps<T>) {
  const Component: ElementType = as ?? 'div';
  return (
    <Component
      className={cn(tone === 'elevated' ? 'glass-elevated' : 'glass', 'rounded-panel', className)}
      {...props}
    />
  );
}
