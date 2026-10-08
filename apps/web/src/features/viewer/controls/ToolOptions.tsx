import { ACCENT_COLORS, type AccentColor } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { cn, GlassPanel, Icon, IconButton, type IconName } from '@/ui';
import { useViewerDispatch, useViewerState, type Tool } from '../state/viewer-state';

const TOOL_OPTIONS: { tool: Tool; icon: IconName; label: string; hint: string }[] = [
  { tool: 'mark', icon: 'cropSquare', label: 'Rechteck', hint: 'Rechteck oder Punkt (Klick)' },
  { tool: 'pen', icon: 'gesture', label: 'Freihand', hint: 'Freihand' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil', hint: 'Pfeil' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker', hint: 'Marker' },
];

const COLOR_NAMES: Record<AccentColor, string> = {
  red: 'Rot',
  blue: 'Blau',
  violet: 'Violett',
  yellow: 'Gelb',
};

/** Tool options pill next to the tool bar (B2): shape/pen variant, colour, undo/redo. */
export function ToolOptions() {
  const { tool, color, draft } = useViewerState();
  const dispatch = useViewerDispatch();

  return (
    // Phones: narrower than the pill – it scrolls sideways instead of overflowing the screen.
    <GlassPanel className="scrollbar-none flex max-w-full animate-pop-in items-center gap-1 overflow-x-auto px-2 py-1.5 *:shrink-0">
      <div role="radiogroup" aria-label="Werkzeug" className="flex items-center gap-1">
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
                'flex h-8 items-center gap-1.5 rounded-chip px-2 text-[13px] transition-colors',
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

      {tool !== 'mark' && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
          <div role="radiogroup" aria-label="Farbe" className="flex items-center gap-1">
            {ACCENT_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === color}
                aria-label={COLOR_NAMES[option]}
                title={COLOR_NAMES[option]}
                onClick={() => dispatch({ type: 'colorSelected', color: option })}
                className="flex size-7 items-center justify-center rounded-full"
              >
                <span
                  className={cn(
                    'size-3.5 rounded-full transition-shadow',
                    option === color && 'shadow-[0_0_0_2px_rgb(20_20_20),0_0_0_3.5px_white]',
                  )}
                  style={{ backgroundColor: accentColor(option) }}
                />
              </button>
            ))}
          </div>
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
          <IconButton
            icon="undo"
            label="Rückgängig (⌘Z)"
            size="sm"
            shape="chip"
            iconSize={18}
            disabled={!draft?.strokes.length}
            onClick={() => dispatch({ type: 'undo' })}
          />
          <IconButton
            icon="redo"
            label="Wiederholen (⇧⌘Z)"
            size="sm"
            shape="chip"
            iconSize={18}
            disabled={!draft?.undone.length}
            onClick={() => dispatch({ type: 'redo' })}
          />
        </>
      )}
    </GlassPanel>
  );
}
