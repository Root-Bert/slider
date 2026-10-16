import { Button, IconButton, Toolbar, type MenuAction } from '@/ui';

interface SelectionBarProps {
  count: number;
  actions: readonly MenuAction[];
  onClear: () => void;
}

/**
 * Takes the toolbar's place while decks are selected: what is selected and what can be done with
 * it. Sticks to the top while scrolling, so the actions stay reachable during a long selection.
 */
export function SelectionBar({ count, actions, onClear }: SelectionBarProps) {
  return (
    <Toolbar
      data-selection-bar
      label="Ausgewählte Reviews"
      tone="elevated"
      className="sticky top-3 z-(--z-chrome) min-h-10 flex-wrap"
    >
      <IconButton icon="close" label="Auswahl aufheben (Esc)" size="sm" onClick={onClear} />
      <span className="px-2 text-body font-medium text-fg tabular-nums" aria-live="polite">
        {count} ausgewählt
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {actions.map((action) => (
          <Button
            key={action.icon}
            variant={action.tone === 'danger' ? 'danger' : 'ghost'}
            size="sm"
            icon={action.icon}
            disabled={action.disabled}
            title={action.title ?? action.label}
            aria-label={action.label}
            onClick={action.onSelect}
          >
            <span className="max-sm:hidden">{action.label}</span>
          </Button>
        ))}
      </div>
    </Toolbar>
  );
}
