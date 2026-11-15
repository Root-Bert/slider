import { LAYOUT_GRID_MAX_TRACKS, type LayoutGrid, type LayoutGridAxis } from '@slider/shared';
import { useEffect, useId, useRef, type ComponentProps, type FocusEvent } from 'react';
import { Button, Icon, IconButton, NumberField } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useEditing } from '../editing/editing-context';
import { showPickedGrid } from './picked-grids';
import { useLayoutGrid } from './useLayoutGridLines';
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
 * „Layout-Ansicht“ in the side panel: how many columns and rows the active slide's layout grid
 * has, their gutter and the margin around them. In a template that is its layout's – a slide
 * made from it starts with it –, in a presentation the slide's own, „Auf Vorlage zurücksetzen“
 * back to its layout's. While one direction's fields are in use (pointer over them, or focused),
 * only it shows on the slides. ⇧H or a right click on the button opens it (the view on with it);
 * Esc, ⇧H or ✕ closes it, the grid stays – H turns both off.
 */
export function LayoutGridPanel() {
  const { layoutGridPanelOpen, activeSlideId } = useViewerState();
  const { template, pageIdOf } = useTemplate();
  const editing = useEditing();
  const pageId = activeSlideId ? pageIdOf(activeSlideId) : null;
  // A presentation's slide changes in its file: only with the editor there.
  const settable = !!template || (editing.available && pageId !== null);
  const dispatch = useViewerDispatch();
  // Opened where it can't show (⇧H, right click – no editor, a reviewer): closed again, so no
  // other side panel gives way to nothing.
  const stray = layoutGridPanelOpen && !settable;
  useEffect(() => {
    if (stray) dispatch({ type: 'layoutGridPanelSet', open: false });
  }, [stray, dispatch]);
  if (!settable || !layoutGridPanelOpen || !activeSlideId) return null;
  return <LayoutGridPanelView slideId={activeSlideId} pageId={pageId} />;
}

function LayoutGridPanelView({ slideId, pageId }: { slideId: string; pageId: string | null }) {
  const dispatch = useViewerDispatch();
  const { template, update } = useTemplate();
  const editing = useEditing();
  const { grid, source } = useLayoutGrid(slideId);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  // The direction whose field has the focus: it stays shown when the pointer leaves.
  const focused = useRef<Axis | null>(null);

  useRestoreFocus();
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const setGrid = (next: LayoutGrid | null) => {
    if (pageId === null) return;
    if (template) {
      const layoutGrids = { ...template.layoutGrids };
      if (next) layoutGrids[pageId] = next;
      else delete layoutGrids[pageId];
      update({ layoutGrids });
      return;
    }
    // Typed on in a field: one step to undo.
    const done = editing.apply([{ type: 'setSlideGrid', pageId, grid: next }], {
      coalesce: `grid:${pageId}`,
    });
    showPickedGrid(pageId, next, done);
  };
  const set = (axis: Axis, patch: Partial<LayoutGridAxis>) =>
    setGrid({ ...grid, [axis]: { ...grid[axis], ...patch } });
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
          {template
            ? 'Spalten und Zeilen dieses Layouts. Neue Folien daraus übernehmen sie.'
            : source === 'own'
              ? 'Eigenes Raster dieser Folie.'
              : 'Raster aus der Vorlage. Geändert gilt es nur für diese Folie.'}
        </p>
      </SidePanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pt-4 pb-6">
        {fields('columns', 'Spalten')}
        {fields('rows', 'Zeilen')}
        {source === 'own' && (
          <Button
            variant="soft"
            size="xs"
            weight="normal"
            icon="undo"
            onClick={() => setGrid(null)}
            className="self-start"
          >
            Auf Vorlage zurücksetzen
          </Button>
        )}
      </div>
    </SidePanel>
  );
}
