import { useCallback, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { spaceTaps } from '../../lib/space-taps';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import { useEditing } from '../editing-context';
import { useLayersAhead } from './useLayersAhead';
import { moveOperations, restacked, shownOrder, type Restacking } from './layer-order';
import {
  DEFAULT_SPREAD,
  FRONT,
  isFront,
  LayersContext,
  TILTED,
  type Layers,
  type LayerView,
} from './layers-context';

/** Space tapped twice: the front view, or tilted from it. */
const twice = spaceTaps();

/** Holds „Ebenen“ (`Layers`) for the track's 3D slides and the side panel. */
export function LayersProvider({ children }: { children: ReactNode }) {
  const editing = useEditing();
  const { slides } = useViewerData();
  // Taken apart ahead: the layers open without waiting.
  useLayersAhead();
  const { activeSlideId, layersPanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const open = editing.layers;
  const slideId = open ? (activeSlideId ?? slides[0]?.id ?? null) : null;
  const [pending, setPending] = useState<{ slideId: string; order: string[] } | null>(null);
  // Each slide turned on its own – turning one draws only it again (BER-185).
  const [views, setViews] = useState<ReadonlyMap<string, LayerView>>(new Map());
  // A slide not turned yet shows as the one turned last – tilted when the layers open.
  const [lastView, setLastView] = useState<LayerView>(TILTED);
  const viewOf = (id: string) => views.get(id) ?? lastView;
  const setViewOf = (id: string, next: LayerView) => {
    setViews((current) => new Map(current).set(id, next));
    setLastView(next);
  };
  const view = slideId ? viewOf(slideId) : FRONT;
  const setView = (next: LayerView) => {
    if (slideId) setViewOf(slideId, next);
  };
  const [spread, setSpread] = useState(DEFAULT_SPREAD);
  // Every time the layers open: tilted, spread as at first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setViews(new Map());
      setLastView(TILTED);
      setSpread(DEFAULT_SPREAD);
    }
  }
  const [hovered, setHover] = useState<Layers['hovered']>(null);
  const setHovered = useCallback((on: string, id: string | null) => {
    setHover((current) => {
      if (!id) return current?.slideId === on ? null : current;
      return current?.slideId === on && current.elementId === id
        ? current
        : { slideId: on, elementId: id };
    });
  }, []);
  const [turnKey, setTurnKey] = useState(false);
  // Picked with ⇧ besides the editor's selection (the last of them).
  const [group, setGroup] = useState<{ slideId: string; ids: string[] } | null>(null);

  // ⇧ held lets dragging turn a slide; Space twice turns the active one to the front, or tilts it
  // from there. Not while typing, nor on a button Space would press.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Shift') setTurnKey(event.type === 'keydown');
    // From the front to tilted and back, like the list's switch.
    if (twice(event)) setView(isFront(view) ? TILTED : FRONT);
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
    viewOf,
    setViewOf,
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
