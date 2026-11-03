import { LAYOUT_GRID_MAX_TRACKS, type LayoutGridAxis } from '@slider/shared';
import { useEffect, useId, useRef, type ComponentProps, type FocusEvent } from 'react';
import { Icon, IconButton, NumberField } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { DEFAULT_GRID } from './layout-grid';
import { useTemplate } from './useTemplate';

type Axis = 'columns' | 'rows';

/** A number of the grid in a row with its name (`NumberField`). */
function GridField({
  label,
  ...field
}: Omit<ComponentProps<typeof NumberField>, 'align' | 'size'>) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-fg-muted">
      <span>{label}</span>
      <NumberField label={label} align="center" size="md" className="w-24" {...field} />
    </div>
  );
}

/**
 * „Layout-Ansicht“ of a template being designed, in the side panel: how many columns and
 * rows its layout grid has, their gutter and the margin around them. While one direction's
 * fields are in use (pointer over them, or focused), only it shows on the slides. ⇧H opens it
 * (the view on with it); Esc, ⇧H or ✕ closes it, the grid stays – H turns both off.
 */
export function LayoutGridPanel() {
  const { layoutGridPanelOpen } = useViewerState();
  const { template } = useTemplate();
  if (!template || !layoutGridPanelOpen) return null;
  return <LayoutGridPanelView />;
}

function LayoutGridPanelView() {
  const dispatch = useViewerDispatch();
  const { template, update } = useTemplate();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  // The direction whose field has the focus: it stays shown when the pointer leaves.
  const focused = useRef<Axis | null>(null);

  useRestoreFocus();
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const grid = template?.grid ?? DEFAULT_GRID;
  const set = (axis: Axis, patch: Partial<LayoutGridAxis>) =>
    update({ grid: { ...grid, [axis]: { ...grid[axis], ...patch } } });
  const group = (axis: Axis, label: string) => ({
    'aria-label': label,
    className: 'flex flex-col gap-2.5',
    onPointerEnter: () => dispatch({ type: 'layoutGridAxisSet', axis }),
    onPointerLeave: () => dispatch({ type: 'layoutGridAxisSet', axis: focused.current }),
    onFocus: () => {
      focused.current = axis;
      dispatch({ type: 'layoutGridAxisSet', axis });
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      focused.current = null;
      dispatch({ type: 'layoutGridAxisSet', axis: null });
    },
  });
  const fields = (axis: Axis, title: string) => (
    <section {...group(axis, title)}>
      <h3 className="text-xs font-medium text-fg-subtle">{title}</h3>
      <GridField
        label="Anzahl"
        value={grid[axis].count}
        onChange={(count) => set(axis, { count: Math.round(count) })}
        min={0}
        max={LAYOUT_GRID_MAX_TRACKS}
        step={1}
      />
      <GridField
        label="Abstand"
        unit="cm"
        value={grid[axis].gutter}
        onChange={(gutter) => set(axis, { gutter })}
        min={0}
        max={100}
        step={0.1}
        decimals={2}
      />
      <GridField
        label="Rand"
        unit="cm"
        value={grid[axis].margin}
        onChange={(margin) => set(axis, { margin })}
        min={0}
        max={100}
        step={0.1}
        decimals={2}
      />
    </section>
  );

  return (
    <SidePanel ref={panelRef} data-layout-grid-panel aria-labelledby={titleId}>
      <SidePanelHeader gap="sm">
        <div className="flex items-center gap-2">
          <Icon name="layoutGrid" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Layout-Ansicht
          </h2>
          <IconButton
            icon="close"
            label="Schließen (Esc)"
            size="sm"
            onClick={() => dispatch({ type: 'layoutGridPanelSet', open: false })}
          />
        </div>
        <p className="text-xs leading-4 text-fg-subtle">
          Spalten und Zeilen der Vorlage – das Raster liegt über allen Folien.
        </p>
      </SidePanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pt-4 pb-6">
        {fields('columns', 'Spalten')}
        {fields('rows', 'Zeilen')}
      </div>
    </SidePanel>
  );
}
