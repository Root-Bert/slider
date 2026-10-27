import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { isTypingTarget } from '@/lib/dom';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import { useEditing } from '../editing-context';
import { moveOperations, restacked, shownOrder, type Restacking } from './layer-order';
import { DEFAULT_SPREAD, FRONT, LayersContext, type Layers } from './layers-context';

/** Space twice within this long: the front view. */
const DOUBLE_SPACE_MS = 400;
/** When Space was last pressed (for Space twice). */
let lastSpace = -Infinity;

/** Holds „Ebenen“ (`Layers`) for the track's 3D slides and the side panel. */
export function LayersProvider({ children }: { children: ReactNode }) {
  const editing = useEditing();
  const { slides } = useViewerData();
  const { activeSlideId, layersPanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const open = editing.layers;
  const slideId = open ? (activeSlideId ?? slides[0]?.id ?? null) : null;
  const [pending, setPending] = useState<{ slideId: string; order: string[] } | null>(null);
  const [view, setView] = useState(FRONT);
  const [spread, setSpread] = useState(DEFAULT_SPREAD);
  // Every time the layers open: from the front, half spread.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setView(FRONT);
      setSpread(DEFAULT_SPREAD);
    }
  }
  const [hovered, setHovered] = useState<string | null>(null);
  const [turnKey, setTurnKey] = useState(false);
  // Picked with ⇧ besides the editor's selection (the last of them).
  const [group, setGroup] = useState<{ slideId: string; ids: string[] } | null>(null);

  // ⇧ held lets dragging turn the slides; Space twice shows them from the front. Not while
  // typing, nor on a button Space would press.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Shift') setTurnKey(event.type === 'keydown');
    if (event.type !== 'keydown' || event.key !== ' ' || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    if (event.target instanceof Element && event.target.closest('button, input, select, a, dialog'))
      return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastSpace < DOUBLE_SPACE_MS) {
      setView(FRONT);
      lastSpace = -Infinity;
    } else lastSpace = now;
  });
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => onKey(event);
    const reset = () => setTurnKey(false);
    window.addEventListener('keydown', listener);
    window.addEventListener('keyup', listener);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('keyup', listener);
      window.removeEventListener('blur', reset);
      setTurnKey(false);
    };
  }, [open]);

  const orderOf = (id: string) =>
    shownOrder(
      editing.elementsOf(id).map((element) => element.id),
      pending?.slideId === id ? pending.order : null,
    );

  const move = (ids: readonly string[], how: Restacking) => {
    if (!slideId) return;
    const order = orderOf(slideId);
    const next = restacked(order, ids, how);
    if (!next) return;
    setPending({ slideId, order: next });
    void editing
      .apply(moveOperations(order, next, ids))
      .finally(() => setPending((current) => (current?.order === next ? null : current)));
  };

  const selection = editing.selection;
  const picked = selection && {
    slideId: selection.slideId,
    ids:
      group?.slideId === selection.slideId && group.ids.includes(selection.elementId)
        ? group.ids
        : [selection.elementId],
  };
  const pick = (on: string, id: string | null, add = false) => {
    // ⇧ beside every element: nothing picked away.
    if (!id && add) return;
    const before = picked?.slideId === on ? picked.ids : [];
    const ids = !id
      ? []
      : !add
        ? [id]
        : before.includes(id)
          ? before.filter((item) => item !== id)
          : [...before, id];
    choose(on, ids);
  };
  const choose = (on: string, ids: readonly string[]) => {
    const last = ids.at(-1);
    setGroup(last ? { slideId: on, ids: [...ids] } : null);
    editing.select(last ? { slideId: on, elementId: last } : null);
    // The slide picked on – an element or beside every one – becomes the active one; its list shows.
    if (on !== activeSlideId) dispatch({ type: 'activeSlideChanged', slideId: on });
    dispatch({ type: 'layersPanelSet', open: true });
  };

  const value: Layers = {
    open,
    panelOpen: open && layersPanelOpen,
    setPanelOpen: (panel) => dispatch({ type: 'layersPanelSet', open: panel }),
    slideId,
    orderOf,
    view,
    setView,
    turnKey,
    spread,
    setSpread,
    hovered,
    setHovered,
    picked,
    pick,
    pickAll: choose,
    move,
    busy: pending !== null,
  };
  return <LayersContext value={value}>{children}</LayersContext>;
}
