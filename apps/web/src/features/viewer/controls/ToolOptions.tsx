import { cn, GlassPanel, Icon, IconButton, type IconName } from '@/ui';
import { useViewerDispatch, useViewerState, type PenTool } from '../state/viewer-state';

/** The pen's variants: lines and shapes. Spots and areas are the pointer's (click, drag). */
const TOOL_OPTIONS: { tool: PenTool; icon: IconName; label: string; hint: string }[] = [
  { tool: 'pen', icon: 'gesture', label: 'Freihand', hint: 'Freihand' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil', hint: 'Pfeil' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker', hint: 'Marker' },
  { tool: 'rect', icon: 'cropSquare', label: 'Rechteck', hint: 'Rechteck' },
  { tool: 'ellipse', icon: 'radioButtonUnchecked', label: 'Kreis', hint: 'Kreis/Ellipse' },
];

/** Pen options pill next to the tool bar (B2): pen/shape variant, undo/redo. Drawings take the
 * viewer's own colour, so they always match the comment's connector line.. */
export function ToolOptions() {
  const { tool, draft } = useViewerState();
  const dispatch = useViewerDispatch();

  return (
    // Phones: narrower than the pill – it scrolls sideways instead of overflowing the screen.
    <GlassPanel className="scrollbar-none flex max-w-full animate-pop-in items-center gap-1 overflow-x-auto p-1 *:shrink-0">
      <div role="radiogroup" aria-label="Zeichenwerkzeug" className="flex items-center gap-1">
        {TOOL_OPTIONS.map((option) => {
          const selected = option.tool === tool;
          return (
            <button
              key={option.tool}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.hint}
              title={option.hint}
              onClick={() => dispatch({ type: 'toolSelected', tool: option.tool })}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-control px-2 text-[13px] transition-colors',
                selected
                  ? 'bg-white/15 font-medium text-fg'
                  : 'text-fg-muted hover:bg-white/10 hover:text-fg',
              )}
            >
              <Icon name={option.icon} size={18} />
              {selected && <span>{option.label}</span>}
            </button>
          );
        })}
      </div>

      <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
      <IconButton
        icon="undo"
        label="Rückgängig (⌘Z)"
        size="sm"
        iconSize={18}
        disabled={!draft?.strokes.length}
        onClick={() => dispatch({ type: 'undo' })}
      />
      <IconButton
        icon="redo"
        label="Wiederholen (⇧⌘Z)"
        size="sm"
        iconSize={18}
        disabled={!draft?.undone.length}
        onClick={() => dispatch({ type: 'redo' })}
      />
    </GlassPanel>
  );
}
