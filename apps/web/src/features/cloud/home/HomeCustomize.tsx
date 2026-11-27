import { useDraggable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import {
  Button,
  cn,
  Icon,
  IconButton,
  IconTile,
  SegmentedControl,
  SidePanel,
  SidePanelHeader,
  Toggle,
} from '@/ui';
import type { BoardKit, WidgetInfo } from './kit';
import {
  MAX_ROWS,
  newDragId,
  type HomeLayout,
  type NewDragData,
  type Widget,
  type WidgetLook,
  type WidgetWidth,
} from './layout';

const WIDTHS: { value: `${WidgetWidth}`; label: string; title: string }[] = [
  { value: '3', label: '¼', title: 'Ein Viertel' },
  { value: '4', label: '⅓', title: 'Ein Drittel' },
  { value: '6', label: '½', title: 'Die Hälfte' },
  { value: '8', label: '⅔', title: 'Zwei Drittel' },
  { value: '9', label: '¾', title: 'Drei Viertel' },
  { value: '12', label: 'Ganz', title: 'Die ganze Breite' },
];

const LOOKS: { value: WidgetLook; label: string }[] = [
  { value: 'none', label: 'Ohne' },
  { value: 'glass', label: 'Glas' },
  { value: 'fill', label: 'Fläche' },
  { value: 'line', label: 'Linie' },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

/** A small heading, as the parts of a column beside a thing (`AsidePart`). */
function PartHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-caption font-semibold tracking-wider text-fg-subtle uppercase">
      {children}
    </h3>
  );
}

/** The picked widget's size, look and heading – and taking it off. */
function Settings({
  info,
  widget,
  columns,
  onChange,
  onRemove,
  onDeselect,
}: {
  info: WidgetInfo;
  widget: Widget;
  columns: number;
  onChange: (patch: Partial<Omit<Widget, 'id' | 'type'>>) => void;
  onRemove: () => void;
  onDeselect: () => void;
}) {
  const rows = widget.h === 'auto' ? null : widget.h;
  return (
    <section aria-label={`${info.label} anpassen`} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile size={36} tint="surface-1" tone="fg">
          <Icon name={info.icon} size={18} />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-sm font-semibold text-fg">{info.label}</h3>
          <p className="truncate text-xs text-fg-muted">{info.about}</p>
        </div>
        {/* The widget stays; back to the list of all (as Esc, or a click beside). */}
        <IconButton
          icon="close"
          label="Auswahl aufheben (Esc)"
          size="compact"
          onClick={onDeselect}
        />
      </div>
      {/* One column (a phone): every widget is as wide as the page. */}
      {columns > 1 && (
        <Field label="Breite">
          <SegmentedControl
            label="Breite"
            size="sm"
            track="soft"
            fill
            segments={WIDTHS.map((width) => ({ ...width }))}
            value={`${widget.w}`}
            onChange={(value) => onChange({ w: Number(value) as WidgetWidth })}
          />
        </Field>
      )}
      <Field label="Höhe">
        <div className="flex items-center gap-2">
          <SegmentedControl
            label="Höhe"
            size="sm"
            track="soft"
            className="flex-1"
            fill
            segments={[
              { value: 'auto', label: 'Wie der Inhalt' },
              { value: 'fixed', label: 'Fest' },
            ]}
            value={rows === null ? 'auto' : 'fixed'}
            onChange={(value) => onChange({ h: value === 'auto' ? 'auto' : (rows ?? 4) })}
          />
          {rows !== null && (
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                icon="remove"
                label="Niedriger"
                size="compact"
                disabled={rows <= 1}
                onClick={() => onChange({ h: rows - 1 })}
              />
              <span className="w-6 text-center text-body text-fg tabular-nums">{rows}</span>
              <IconButton
                icon="add"
                label="Höher"
                size="compact"
                disabled={rows >= MAX_ROWS}
                onClick={() => onChange({ h: rows + 1 })}
              />
            </div>
          )}
        </div>
      </Field>
      <Field label="Hintergrund">
        <SegmentedControl
          label="Hintergrund"
          size="sm"
          track="soft"
          fill
          segments={LOOKS}
          value={widget.look}
          onChange={(look) => onChange({ look })}
        />
      </Field>
      <Toggle
        label="Überschrift zeigen"
        checked={widget.title}
        onChange={(title) => onChange({ title })}
      />
      <div>
        <Button variant="soft" size="sm" icon="remove" onClick={onRemove}>
          Entfernen
        </Button>
      </div>
    </section>
  );
}

/**
 * „Widgets“ beside the page while it is arranged (as the details of a file: a panel the page
 * gives way to): the picked one's settings on top, below every widget there is – dragged onto
 * the page, or put at its end with a click; one already there is shown with a click.
 */
export function HomeCustomize({
  kit,
  layout,
  picked,
  columns,
  sheet,
  available,
  onAdd,
  onShow,
  onChange,
  onRemove,
  onDeselect,
  onReset,
  onDone,
}: {
  kit: BoardKit;
  layout: HomeLayout;
  picked: Widget | null;
  columns: number;
  /** Below the page instead of beside it: beside, too little of the page would be left. */
  sheet: boolean;
  available: (type: string) => boolean;
  onAdd: (type: string) => void;
  onShow: (id: string) => void;
  onChange: (id: string, patch: Partial<Omit<Widget, 'id' | 'type'>>) => void;
  onRemove: (id: string) => void;
  onDeselect: () => void;
  onReset: () => void;
  onDone: () => void;
}) {
  return (
    <SidePanel
      aria-label="Widgets anpassen"
      // Beside: the page gives way (`data-cloud-panel`). Below (a phone, a tablet, a narrow
      // window): the page keeps its width, the sheet leaves it the upper half.
      side={sheet ? 'bottom' : 'right'}
      data-cloud-panel={sheet ? undefined : true}
      data-own-drag
    >
      <SidePanelHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-fg">Widgets</h2>
          <Button variant="primary" size="sm" onClick={onDone}>
            Fertig
          </Button>
        </div>
      </SidePanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 py-4">
        {picked ? (
          <Settings
            key={picked.id}
            info={kit.info[picked.type]!}
            widget={picked}
            columns={columns}
            onChange={(patch) => onChange(picked.id, patch)}
            onRemove={() => onRemove(picked.id)}
            onDeselect={onDeselect}
          />
        ) : (
          <p className="text-body text-fg-muted">
            Klick ein Widget an, um Größe und Hintergrund zu ändern. Zieh es, um es zu verschieben.
          </p>
        )}
        <section aria-label="Alle Widgets" className="flex flex-col gap-2">
          <PartHeading>Alle Widgets</PartHeading>
          <ul className="-mx-2 flex flex-col">
            {kit.spec.types.filter(available).map((type) => {
              const there = layout.find((widget) => widget.type === type);
              const placed = !kit.spec.defaults[type]!.many && !!there;
              return (
                <li key={type}>
                  <WidgetRow
                    type={type}
                    info={kit.info[type]!}
                    placed={placed}
                    onClick={() => (placed && there ? onShow(there.id) : onAdd(type))}
                  />
                </li>
              );
            })}
          </ul>
        </section>
        <div className="mt-auto">
          <Button variant="ghost" size="sm" icon="refresh" onClick={onReset}>
            Standard wiederherstellen
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

/**
 * One kind of widget in the list: a click puts it at the page's end (or shows the one there), a
 * drag – a finger rests on it first, so the list still scrolls – takes it where it is let go.
 */
function WidgetRow({
  type,
  info,
  placed,
  onClick,
}: {
  type: string;
  info: WidgetInfo;
  placed: boolean;
  onClick: () => void;
}) {
  const data: NewDragData = { type };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: newDragId(type),
    data,
    disabled: placed,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      // A button first (one already placed still shows it), that can be dragged too.
      role={undefined}
      aria-disabled={undefined}
      title={placed ? 'Auf der Seite – zeigen' : 'Hinzufügen oder auf die Seite ziehen'}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-control px-2 py-2 text-left outline-none select-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus [-webkit-touch-callout:none]',
        !placed && 'cursor-grab',
        isDragging && 'opacity-40',
      )}
    >
      <IconTile size={36} tint="surface-1" tone={placed ? 'muted' : 'fg'}>
        <Icon name={info.icon} size={18} />
      </IconTile>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg">{info.label}</span>
        <span className="truncate text-xs text-fg-muted">{info.about}</span>
      </span>
      <Icon name={placed ? 'check' : 'add'} size={18} className="shrink-0 text-fg-subtle" />
    </button>
  );
}
