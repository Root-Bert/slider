import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { GlassPanel, type GlassPanelTone } from './GlassPanel';

export interface ToolbarProps extends Omit<ComponentPropsWithRef<'div'>, 'role'> {
  /** Accessible name, e.g. "Werkzeuge (Tab wechselt)" or "Ansicht". */
  label?: string;
  /**
   * `toolbar` (default) for a set of tools, `group` for a small related set (view switch),
   * `false` for a plain pill without a role (e.g. session or revision controls).
   */
  role?: 'toolbar' | 'group' | false;
  tone?: GlassPanelTone;
}

/**
 * Glass control pill holding a row of controls (`p-1`, `gap-1`). Children are `h-8` controls
 * with `rounded-control` (16 − 4), separated by `ToolbarDivider`. Other props (e.g. an
 * `onMouseDown` that keeps the focus off the tools) pass through.
 */
export function Toolbar({ label, role = 'toolbar', tone, className, ...props }: ToolbarProps) {
  return (
    <GlassPanel
      role={role === false ? undefined : role}
      aria-label={label}
      tone={tone}
      className={cn('flex items-center gap-1 p-1', className)}
      {...props}
    />
  );
}

export interface ToolbarDividerProps {
  /** Height: `sm` 16px (inline in a composer row), `md` 20px (default, toolbar pills). */
  size?: 'sm' | 'md';
  /** `strong` (default): `hairline-strong`; `subtle`: `hairline` (busy panels). */
  tone?: 'strong' | 'subtle';
  /** Side margin on top of the toolbar gap: `none`, `sm` 2px (default), `md` 4px. */
  spacing?: 'none' | 'sm' | 'md';
  className?: string;
}

/** The 1px vertical line between control groups. Decorative (`aria-hidden`), as before. */
export function ToolbarDivider({
  size = 'md',
  tone = 'strong',
  spacing = 'sm',
  className,
}: ToolbarDividerProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'w-px shrink-0',
        size === 'sm' ? 'h-4' : 'h-5',
        tone === 'strong' ? 'bg-hairline-strong' : 'bg-hairline',
        spacing === 'sm' && 'mx-0.5',
        spacing === 'md' && 'mx-1',
        className,
      )}
    />
  );
}
