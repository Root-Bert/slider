import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';
import type { MenuAction } from './Menu';
import { Toolbar, type ToolbarProps } from './Toolbar';

interface SelectionBarProps extends Omit<ToolbarProps, 'label' | 'role' | 'children'> {
  count: number;
  actions: readonly MenuAction[];
  onClear: () => void;
  /** What is selected, e.g. "Ausgewählte Präsentationen". */
  label: string;
  /** Drawn first, under the controls (e.g. the split handle's line it grows out of). */
  backdrop?: ReactNode;
  /** Hides the action labels (icons stay) where room is short – default: on phones. */
  labelClassName?: string;
  /** Hides "ausgewählt" after the count where room is shorter still. */
  countLabelClassName?: string;
}

/**
 * What is selected and what can be done with it – the decks in "Präsentationen" (in the toolbar's
 * place), the comments under the slides (out of the split handle). Several items, one bar: close
 * (Esc), the count, the actions as buttons whose labels give way to their icons on phones.
 */
export function SelectionBar({
  count,
  actions,
  onClear,
  label,
  backdrop,
  labelClassName = 'max-sm:hidden',
  countLabelClassName,
  className,
  ...props
}: SelectionBarProps) {
  return (
    <Toolbar
      data-selection-bar
      label={label}
      tone="elevated"
      className={cn('min-h-10', className)}
      {...props}
    >
      {backdrop}
      <IconButton icon="close" label="Auswahl aufheben (Esc)" size="sm" onClick={onClear} />
      <span
        className="px-2 text-body font-medium whitespace-nowrap text-fg tabular-nums"
        aria-live="polite"
      >
        {count}
        <span className={countLabelClassName}> ausgewählt</span>
      </span>
      <div className="ml-auto flex items-center gap-1">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.tone === 'danger' ? 'danger' : 'ghost'}
            size="sm"
            // Selection actions use icon names; a node icon (brand mark) only appears in menus.
            icon={typeof action.icon === 'string' ? (action.icon as IconName) : undefined}
            disabled={action.disabled}
            title={action.title ?? action.label}
            aria-label={action.label}
            onClick={action.onSelect}
          >
            <span className={labelClassName}>{action.label}</span>
          </Button>
        ))}
      </div>
    </Toolbar>
  );
}
