import { clamp, type TextAlign, type VerticalAlign } from '@slider/shared';
import type { KeyboardEvent } from 'react';
import { cn } from '@/ui';

/*
 * Where the text sits in its box, as in Figma: a 3 × 3 grid – the columns left, middle, right
 * (the paragraphs' alignment), the rows top, middle, bottom (the box's). One click sets both.
 */

export type Across = Exclude<TextAlign, 'justify'>;

const ACROSS: Across[] = ['left', 'center', 'right'];
const DOWN: VerticalAlign[] = ['top', 'middle', 'bottom'];

const ROW_LABEL: Record<VerticalAlign, string> = { top: 'Oben', middle: 'Mitte', bottom: 'Unten' };
const COLUMN_LABEL: Record<Across, string> = { left: 'links', center: 'Mitte', right: 'rechts' };

/** „Oben links“, „Mitte“, „Unten rechts“ … */
function cellLabel(across: Across, down: VerticalAlign): string {
  if (across === 'center' && down === 'middle') return 'Mitte';
  return `${ROW_LABEL[down]} ${COLUMN_LABEL[across]}`;
}

/** Three lines of text, set as the cell sets them (justified: all as wide but the last). */
function Lines({ align }: { align: TextAlign }) {
  const widths = align === 'justify' ? [12, 12, 7] : [12, 7, 10];
  return (
    <svg viewBox="0 0 12 9" width={12} height={9} aria-hidden className="block">
      {widths.map((w, i) => {
        const x = align === 'center' ? (12 - w) / 2 : align === 'right' ? 12 - w : 0;
        return <rect key={i} x={x} y={i * 3.5} width={w} height={2} rx={1} fill="currentColor" />;
      })}
    </svg>
  );
}

/** The arrow keys' steps through the grid (column, row). */
const STEP: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The grid: `across` the paragraphs' alignment (`null`: they differ – no column picked;
 * justified text is in the left column, its lines drawn justified), `down` the box's. A radio
 * group with one Tab stop – the arrows step through the cells and pick them as they go.
 */
export function TextAlignGrid({
  across,
  down,
  onPick,
}: {
  across: TextAlign | null;
  down: VerticalAlign;
  onPick: (across: Across, down: VerticalAlign) => void;
}) {
  const column: Across | null = across === 'justify' ? 'left' : across;
  // The picked cell takes Tab; with no column picked, the row's left one.
  const focusable = { across: column ?? 'left', down };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = STEP[event.key];
    if (!by || event.metaKey || event.ctrlKey || event.altKey) return;
    // Handled: page shortcuts (the viewer's ←/→ slide navigation) skip prevented keys.
    event.preventDefault();
    const x = clamp(ACROSS.indexOf(focusable.across) + by[0], 0, 2);
    const y = clamp(DOWN.indexOf(focusable.down) + by[1], 0, 2);
    const next = { across: ACROSS[x]!, down: DOWN[y]! };
    if (next.across !== column || next.down !== down) onPick(next.across, next.down);
    event.currentTarget
      .querySelector<HTMLElement>(`[data-cell="${next.across}-${next.down}"]`)
      ?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Ausrichtung"
      onKeyDown={onKeyDown}
      className="field-well grid size-18 shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-control-sm p-1"
    >
      {DOWN.map((rowValue) =>
        ACROSS.map((columnValue) => {
          const picked = columnValue === column && rowValue === down;
          const label = cellLabel(columnValue, rowValue);
          return (
            <button
              key={`${columnValue}-${rowValue}`}
              type="button"
              role="radio"
              aria-checked={picked}
              aria-label={label}
              title={label}
              data-cell={`${columnValue}-${rowValue}`}
              tabIndex={columnValue === focusable.across && rowValue === focusable.down ? 0 : -1}
              onClick={() => onPick(columnValue, rowValue)}
              className={cn(
                'group/cell flex items-center justify-center rounded-badge transition-colors',
                picked ? 'bg-selected text-fg' : 'text-fg-subtle hover:bg-hover',
              )}
            >
              {picked ? (
                <Lines align={across ?? columnValue} />
              ) : (
                <>
                  <span
                    aria-hidden
                    className="size-1 rounded-full bg-fg-faint group-hover/cell:hidden"
                  />
                  <span aria-hidden className="hidden group-hover/cell:block">
                    <Lines align={columnValue} />
                  </span>
                </>
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
