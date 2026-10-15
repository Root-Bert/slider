import { Button, IconButton, type MenuAction } from '@/ui';

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
    <div
      data-selection-bar
      role="toolbar"
      aria-label="Ausgewählte Reviews"
      className="glass-elevated sticky top-3 z-30 flex min-h-10 flex-wrap items-center gap-1 rounded-panel p-1"
    >
      <IconButton icon="close" label="Auswahl aufheben (Esc)" size="sm" onClick={onClear} />
      <span className="px-2 text-[13px] font-medium text-fg tabular-nums" aria-live="polite">
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
    </div>
  );
}
