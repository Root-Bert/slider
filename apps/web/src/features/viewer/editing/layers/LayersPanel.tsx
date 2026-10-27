import type { EditableElement, Rect } from '@slider/shared';
import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { pluralize } from '@/lib/format';
import { Button, cn, Icon, IconButton, Spinner } from '@/ui';
import { SidePanel, SidePanelHeader } from '../../components/SidePanel';
import { useRestoreFocus } from '../../hooks/useRestoreFocus';
import { useViewerData } from '../../state/viewer-data';
import { useEditing } from '../editing-context';
import { elementLabel } from '../lib/element-label';
import { restacked } from './layer-order';
import { FRONT, isFront, MAX_SPREAD, TILTED, useLayers } from './layers-context';
import { useLayerPictures, type LayerPicture } from './useLayerPictures';

/**
 * „Ebenen“ (L) in the side panel, where the thread or the deleted slides would be: the active
 * slide's layers top first, as in a drawing program – the slide itself is turned 3D on the
 * track (`LayerStage`). A row picks its element, with ⇧ (or ⌘) one more; dragging it, its arrows
 * or ⌥↑ / ⌥↓ restack it – and the others picked with it, together – in the file (`moveElement`). How far the planes stand apart and the view sit in the header.
 */
export function LayersPanel() {
  const layers = useLayers();
  if (!layers.panelOpen || !layers.slideId) return null;
  return <LayersPanelView slideId={layers.slideId} />;
}

function LayersPanelView({ slideId }: { slideId: string }) {
  const layers = useLayers();
  const editing = useEditing();
  const drawn = useLayerPictures(slideId, 'interactive');
  const elements = new Map(editing.elementsOf(slideId).map((element) => [element.id, element]));
  const order = layers.orderOf(slideId);
  const pickedIds = layers.picked?.slideId === slideId ? layers.picked.ids : NONE;
  /** Picked last: the one the list shows. */
  const picked = pickedIds.at(-1) ?? null;
  const pick = (id: string | null, add = false) => layers.pick(slideId, id, add);
  const { slideIndex, viewer } = useViewerData();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [dragged, setDragged] = useState<{ ids: readonly string[]; over: number } | null>(null);
  const number = (slideIndex.get(slideId) ?? 0) + 1;
  const aspect = editing.pageSize.width / editing.pageSize.height;

  useRestoreFocus();
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);
  // The picked element's row in the middle of the list – picked on the slide too, or the list
  // just opened for it.
  useEffect(() => {
    if (!picked) return;
    panelRef.current
      ?.querySelector(`[data-layer-row="${CSS.escape(picked)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [picked]);

  // ⌥↑ / ⌥↓ restack the picked elements (with ⇧ to the top or the bottom), ⌘Z / ⇧⌘Z undo and
  // redo; Esc and ⌘↵ let it go and close the panel – the slides stay taken apart.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    if (event.target instanceof Element && event.target.closest('dialog, [contenteditable]'))
      return;
    const mod = event.metaKey || event.ctrlKey;
    let handled = true;
    if (event.key === 'Escape' || (mod && event.key === 'Enter')) {
      pick(null);
      layers.setPanelOpen(false);
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey && picked) {
      const up = event.key === 'ArrowUp';
      layers.move(pickedIds, event.shiftKey ? (up ? 'top' : 'bottom') : up ? 'up' : 'down');
    } else if (mod && event.key.toLowerCase() === 'z') {
      if (event.shiftKey) {
        if (editing.state?.canRedo) editing.redo();
      } else if (editing.state?.canUndo) editing.undo();
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);

  const rows = [...order].reverse();
  const front = isFront(layers.view);

  return (
    <SidePanel
      ref={panelRef}
      data-layers-panel
      aria-labelledby={titleId}
      style={{ ['--layer-color' as string]: accentColor(viewer.author.color) }}
    >
      <SidePanelHeader gap="sm">
        <div className="flex items-center gap-2">
          <Icon name="layers" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Ebenen · Folie {number}
          </h2>
          {drawn.drawing && drawn.background && (
            <Spinner size="sm" label="Ebenen werden gezeichnet" />
          )}
          <IconButton
            icon="close"
            label="Schließen (Esc)"
            title="Liste schließen (Esc) – die Folien bleiben aufgefächert, L beendet"
            size="sm"
            onClick={() => layers.setPanelOpen(false)}
          />
        </div>
        <p className="text-xs leading-4 text-fg-subtle">
          {pluralize(order.length, 'Ebene', 'Ebenen')}, oben zuerst. Auf der Folie wählt ein Klick
          die Ebene (⇧ mehrere), Ziehen alle im Rahmen; ein Doppelklick kehrt zum Kommentieren
          zurück. ⇧ + Ziehen dreht die Folien, zweimal Leertaste zeigt die Frontansicht.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-muted">
            Abstand
            <input
              type="range"
              min={0}
              max={MAX_SPREAD}
              step={0.01}
              value={layers.spread}
              onChange={(event) => layers.setSpread(Number(event.target.value))}
              className="min-w-0 flex-1 accent-(--layer-color)"
            />
          </label>
          <Button variant="soft" size="xs" onClick={() => layers.setView(front ? TILTED : FRONT)}>
            {front ? 'Schräg' : 'Frontansicht'}
          </Button>
        </div>
      </SidePanelHeader>

      <ol
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pt-3 pb-6"
        aria-busy={layers.busy}
        onDragOver={(event) => {
          if (!dragged) return;
          event.preventDefault();
          // Where it would go: above or below the row under the pointer, by its half.
          const row = (event.target as Element).closest<HTMLElement>('[data-layer-row]');
          if (!row) return;
          const at = order.indexOf(row.dataset.layerRow ?? '');
          const rect = row.getBoundingClientRect();
          const over = event.clientY < rect.top + rect.height / 2 ? at + 1 : at;
          if (over !== dragged.over) setDragged({ ...dragged, over });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!dragged) return;
          layers.move(dragged.ids, { slot: dragged.over });
          setDragged(null);
        }}
      >
        {rows.map((id) => {
          const element = elements.get(id);
          if (!element) return null;
          const at = order.indexOf(id);
          const isPicked = pickedIds.includes(id);
          // A picked row moves with all picked; another alone.
          const together = isPicked ? pickedIds : [id];
          const moving = dragged !== null && !dragged.ids.includes(id);
          return (
            <LayerRow
              key={id}
              element={element}
              picture={drawn.pictures.get(id)}
              aspect={aspect}
              picked={isPicked}
              hovered={id === layers.hovered}
              dragged={dragged?.ids.includes(id) ?? false}
              dropAbove={moving && dragged.over === at + 1}
              dropBelow={moving && at === 0 && dragged.over === 0}
              canUp={restacked(order, together, 'up') !== null}
              canDown={restacked(order, together, 'down') !== null}
              onDragStart={() => setDragged({ ids: together, over: at })}
              onDragEnd={() => setDragged(null)}
              onHover={(over) => layers.setHovered(over ? id : null)}
              onPick={(add) =>
                add ? pick(id, true) : pick(isPicked && pickedIds.length === 1 ? null : id)
              }
              onUp={() => layers.move(together, 'up')}
              onDown={() => layers.move(together, 'down')}
            />
          );
        })}
        <li className="mt-1 flex items-center gap-3 rounded-control-sm px-2 py-2 text-body text-fg-subtle">
          <span className="w-4 shrink-0" />
          <span className="size-10 shrink-0 rounded-thumb bg-surface-3 ring-1 ring-hairline" />
          Hintergrund und Master
        </li>
      </ol>
      {drawn.failed && !drawn.background && (
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3 text-xs text-fg-muted">
          Die Ebenen ließen sich nicht zeichnen.
          <Button variant="soft" size="xs" onClick={drawn.retry}>
            Nochmal versuchen
          </Button>
        </div>
      )}
    </SidePanel>
  );
}

function LayerRow({
  element,
  picture,
  aspect,
  picked,
  hovered,
  dragged,
  dropAbove,
  dropBelow,
  canUp,
  canDown,
  onDragStart,
  onDragEnd,
  onHover,
  onPick,
  onUp,
  onDown,
}: {
  element: EditableElement;
  picture: LayerPicture | undefined;
  aspect: number;
  picked: boolean;
  hovered: boolean;
  dragged: boolean;
  dropAbove: boolean;
  dropBelow: boolean;
  canUp: boolean;
  canDown: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onHover: (over: boolean) => void;
  /** `add`: ⇧ or ⌘ held – one more, or one less. */
  onPick: (add: boolean) => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <li
      data-layer-row={element.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', element.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      // The whole row picks (its name is the button for the keyboard); not its arrows.
      onClick={(event) => {
        if ((event.target as Element).closest('[data-row-arrows]')) return;
        onPick(event.shiftKey || event.metaKey || event.ctrlKey);
      }}
      className={cn(
        'group relative flex cursor-default items-center gap-3 rounded-control-sm px-2 py-2',
        picked ? 'bg-selected' : hovered ? 'bg-hover' : '',
        dragged && 'opacity-50',
      )}
    >
      {dropAbove && (
        <span className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-(--layer-color)" />
      )}
      {dropBelow && (
        <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-(--layer-color)" />
      )}
      <Icon name="dragIndicator" size={16} className="shrink-0 cursor-grab text-fg-subtle" />
      <span className="relative size-10 shrink-0 overflow-hidden rounded-thumb bg-surface-2 ring-1 ring-hairline">
        {picture?.url && picture.box && (
          <img
            src={picture.url}
            alt=""
            draggable={false}
            className="absolute max-w-none"
            style={thumbnailBox(picture.box, aspect)}
          />
        )}
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-body text-fg outline-none focus-visible:underline"
        aria-pressed={picked}
      >
        {elementLabel(element)}
      </button>
      <span
        data-row-arrows
        className={cn(
          'flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
          picked && 'opacity-100',
        )}
      >
        <IconButton
          icon="expandLess"
          label="Eine Ebene nach vorn"
          title="Eine Ebene nach vorn (⌥↑)"
          size="sm"
          disabled={!canUp}
          onClick={onUp}
        />
        <IconButton
          icon="expandMore"
          label="Eine Ebene nach hinten"
          title="Eine Ebene nach hinten (⌥↓)"
          size="sm"
          disabled={!canDown}
          onClick={onDown}
        />
      </span>
    </li>
  );
}

const NONE: readonly string[] = [];

/** A layer's picture fit into its square thumbnail, in its own proportions. */
function thumbnailBox(box: Pick<Rect, 'w' | 'h'>, aspect: number): CSSProperties {
  const scale = 1 / Math.max(box.w * aspect, box.h, 0.0001);
  const w = box.w * aspect * scale;
  const h = box.h * scale;
  return {
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    left: `${((1 - w) / 2) * 100}%`,
    top: `${((1 - h) / 2) * 100}%`,
  };
}
