import { useEffect, useEffectEvent, useId, useState } from 'react';
import { accentColor } from '@/lib/accent';
import { pluralize } from '@/lib/format';
import { cn, Icon, IconButton, type IconName } from '@/ui';
import { pageGuides, usePageGuides } from './guides';
import type { LayerRow } from './layers';
import { useWriter, useWriterState } from './session';

const iconOf = (row: LayerRow): IconName =>
  row.block.type === 'table'
    ? 'tableChart'
    : row.block.pictures?.length
      ? 'image'
      : row.block.kind === 'heading' || row.block.kind === 'title'
        ? 'title'
        : 'notes';

/** The lock's button, as a slide's layer has it (label, icon, ⇧⌘L) – said for a page. */
const writerLockButton = (locked: boolean) =>
  locked
    ? {
        icon: 'lock' as const,
        label: 'Entsperren',
        title: 'Entsperren (⇧⌘L) – wieder zu tippen, zu verschieben und zu löschen',
      }
    : {
        icon: 'lockOpen' as const,
        label: 'Sperren',
        title: 'Sperren (⇧⌘L) – nicht mehr zu tippen, zu verschieben oder zu löschen',
      };

/**
 * „Ebenen“ (L), as for a slide: the blocks of the page shown, first first, in the page's column –
 * a click picks one (its caret at its start, a picture picked), ↑ / ↓ (⌥↑ / ⌥↓) or dragging puts
 * it elsewhere in the text, also onto another page; its lock (⇧⌘L) keeps it as it is. Esc or L
 * closes it.
 */
export function LayersPanel({
  page,
  rows,
  picked,
}: {
  page: number;
  rows: readonly LayerRow[];
  /** The block the caret is in (a cell's: its table). */
  picked: string | null;
}) {
  const { engine, document: file, me } = useWriter();
  const state = useWriterState();
  const { hovered } = usePageGuides();
  const titleId = useId();
  const [dragged, setDragged] = useState<{ id: string; over: number } | null>(null);
  const editing = file.permissions.canEdit && state.mode === 'edit';
  const total = state.blocks.length;
  const move = (id: string, step: -1 | 1) => {
    const at = state.blocks.findIndex((block) => block.id === id);
    if (at >= 0) engine.moveBlockTo(id, step < 0 ? at - 1 : at + 2);
  };

  // ⌥↑ / ⌥↓ move the block at the caret, Esc closes – the list's own keys, before the text's.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      event.preventDefault();
      pageGuides.setLayers(false);
      return;
    }
    if (!editing || !picked || !event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    move(picked, event.key === 'ArrowUp' ? -1 : 1);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);

  const dropAt = (slot: number) => {
    if (!dragged) return;
    // Before the row at `slot`, or after the page's last one.
    const target = rows[slot];
    const last = rows.at(-1);
    const to = target ? target.index : last ? last.index + 1 : total;
    engine.moveBlockTo(dragged.id, to);
    setDragged(null);
  };

  return (
    <section
      data-chrome
      data-writer-layers
      aria-labelledby={titleId}
      className="flex min-h-0 flex-1 flex-col"
      style={{ ['--layer-color' as string]: accentColor(me.color) }}
    >
      <header className="flex flex-col gap-1.5 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Icon name="layers" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Ebenen | Seite {page + 1}
          </h2>
          <IconButton
            icon="close"
            label="Schließen (Esc)"
            title="Ebenen schließen (Esc, L)"
            size="sm"
            onClick={() => pageGuides.setLayers(false)}
          />
        </div>
        <p className="text-xs leading-4 text-fg-subtle">
          {pluralize(rows.length, 'Ebene', 'Ebenen')} auf dieser Seite, die erste zuerst. Ein Klick
          wählt sie, Ziehen oder ⌥↑ / ⌥↓ setzt sie woanders hin – auch auf eine andere Seite. Das
          Schloss (⇧⌘L) sperrt sie.
        </p>
      </header>
      <ol
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pt-1 pb-6"
        onDragOver={(event) => {
          if (!dragged) return;
          event.preventDefault();
          const row = (event.target as Element).closest<HTMLElement>('[data-layer-row]');
          if (!row) return;
          const at = rows.findIndex((each) => each.id === row.dataset.layerRow);
          const rect = row.getBoundingClientRect();
          const over = event.clientY < rect.top + rect.height / 2 ? at : at + 1;
          if (over !== dragged.over) setDragged({ ...dragged, over });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragged) dropAt(dragged.over);
        }}
      >
        {rows.map((row, at) => {
          const isPicked = row.id === picked;
          const locked = !!row.block.protect;
          const moving = dragged !== null && dragged.id !== row.id;
          return (
            <li
              key={row.id}
              data-layer-row={row.id}
              draggable={editing && !locked}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', row.id);
                setDragged({ id: row.id, over: at });
              }}
              onDragEnd={() => setDragged(null)}
              onPointerEnter={() => pageGuides.setHovered(row.id)}
              onPointerLeave={() => pageGuides.setHovered(null)}
              onClick={(event) => {
                if ((event.target as Element).closest('[data-row-arrows]')) return;
                engine.selectBlock(row.id);
              }}
              className={cn(
                'group relative flex cursor-default items-center gap-3 rounded-control-sm px-2 py-2',
                isPicked ? 'bg-selected' : hovered === row.id ? 'bg-hover' : '',
                dragged?.id === row.id && 'opacity-50',
              )}
            >
              {moving && dragged.over === at && (
                <span className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-(--layer-color)" />
              )}
              {moving && at === rows.length - 1 && dragged.over === rows.length && (
                <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-(--layer-color)" />
              )}
              {editing && !locked ? (
                <Icon
                  name="dragIndicator"
                  size={16}
                  className="shrink-0 cursor-grab text-fg-subtle"
                />
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-surface-2 text-fg-muted ring-1 ring-hairline">
                {row.src ? (
                  <img src={row.src} alt="" draggable={false} className="size-full object-cover" />
                ) : (
                  <Icon name={iconOf(row)} size={18} />
                )}
              </span>
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left outline-none focus-visible:underline"
                aria-pressed={isPicked}
              >
                <span className="truncate text-body text-fg">{row.label.name}</span>
                <span className="truncate text-xs text-fg-subtle">{row.label.kind}</span>
              </button>
              {editing && (
                <span
                  data-row-arrows
                  className={cn(
                    'flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                    isPicked && 'opacity-100',
                  )}
                >
                  <IconButton
                    icon="expandLess"
                    label="Nach oben"
                    title="Nach oben (⌥↑)"
                    size="sm"
                    disabled={locked || row.index === 0}
                    onClick={() => move(row.id, -1)}
                  />
                  <IconButton
                    icon="expandMore"
                    label="Nach unten"
                    title="Nach unten (⌥↓)"
                    size="sm"
                    disabled={locked || row.index === total - 1}
                    onClick={() => move(row.id, 1)}
                  />
                </span>
              )}
              {/* Locked: the lock shows always, a click unlocks it; else as the arrows, to lock it. */}
              {(editing || locked) && (
                <span
                  data-row-arrows
                  className={cn(
                    'flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                    (isPicked || locked) && 'opacity-100',
                  )}
                >
                  <IconButton
                    {...writerLockButton(locked)}
                    size="sm"
                    active={locked}
                    disabled={!editing}
                    onClick={() => engine.setProtect(row.id, !locked)}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The page's blocks outlined while „Ebenen“ is on, in the editor's own colour – the one under the
 * pointer in the list, and the one at the caret, stronger. Never a pointer target.
 */
export function LayerOutlines({
  rows,
  picked,
}: {
  rows: readonly LayerRow[];
  picked: string | null;
}) {
  const { me } = useWriter();
  const { hovered } = usePageGuides();
  const color = accentColor(me.color);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-1 print:hidden">
      {rows.map(
        (row) =>
          row.box && (
            <div
              key={row.id}
              className="absolute rounded-[2px]"
              style={{
                left: row.box.left - 3,
                top: row.box.top - 2,
                width: row.box.width + 6,
                height: row.box.height + 4,
                outline: `${row.id === hovered || row.id === picked ? 2 : 1}px ${
                  row.id === hovered || row.id === picked ? 'solid' : 'dashed'
                } ${color}`,
                backgroundColor:
                  row.id === hovered ? `color-mix(in srgb, ${color} 8%, transparent)` : undefined,
              }}
            />
          ),
      )}
    </div>
  );
}
