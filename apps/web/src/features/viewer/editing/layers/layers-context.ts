import type { Restacking } from './layer-order';
import { createContext, use } from 'react';

/** How the slides are turned (degrees): `FRONT` as they are – so when the layers open – or tilted. */
export interface LayerView {
  pitch: number;
  yaw: number;
}
export const TILTED: LayerView = { pitch: 18, yaw: -38 };
export const FRONT: LayerView = { pitch: 0, yaw: 0 };
export const isFront = (view: LayerView) => view.pitch === 0 && view.yaw === 0;
/** How far the planes stand apart: 1 a stack as deep as the slide is wide (`LayerStage`) – up to 1.4 times that; half way when the layers open. */
export const MAX_SPREAD = 1.4;
export const DEFAULT_SPREAD = MAX_SPREAD / 2;

/**
 * „Ebenen“ (L), shared by the slides turned 3D on the track (`LayerStage`, every one in view)
 * and the active slide's list in the side panel (`LayersPanel`): how they are turned and spread,
 * the layer under the pointer, what is picked, and restacking – shown at once, until the
 * server's answer has the slide so.
 */
export interface Layers {
  /** The mode: the slides on the track show taken apart. */
  open: boolean;
  /** The active slide's layers in the side panel; closes on its own, the mode stays. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** The active slide: the panel's. */
  slideId: string | null;
  /** A slide's element ids, bottom first. */
  orderOf: (slideId: string) => string[];
  view: LayerView;
  setView: (view: LayerView) => void;
  /** ⇧ is held: dragging turns the slides. */
  turnKey: boolean;
  /** How far the planes stand apart, 0 (flat) – 1. */
  spread: number;
  setSpread: (spread: number) => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  /** The elements picked, on one slide – the last picked last (the editor's selection). */
  picked: { slideId: string; ids: readonly string[] } | null;
  /**
   * Picks an element of a slide – that slide becomes the active one, its list opens. `add` (⇧):
   * adds it to those picked on that slide, or takes it out again.
   */
  pick: (slideId: string, id: string | null, add?: boolean) => void;
  /** Picks just these elements of a slide (a frame dragged over them); its list opens. */
  pickAll: (slideId: string, ids: readonly string[]) => void;
  /** Restacks elements of the active slide together, in one step (`moveElement`s). */
  move: (ids: readonly string[], how: Restacking) => void;
  /** A restacking waits for the server. */
  busy: boolean;
}

export const LayersContext = createContext<Layers | null>(null);

const CLOSED: Layers = {
  open: false,
  panelOpen: false,
  setPanelOpen: () => {},
  slideId: null,
  orderOf: () => [],
  view: FRONT,
  setView: () => {},
  turnKey: false,
  spread: DEFAULT_SPREAD,
  setSpread: () => {},
  hovered: null,
  setHovered: () => {},
  picked: null,
  pick: () => {},
  pickAll: () => {},
  move: () => {},
  busy: false,
};

export const useLayers = (): Layers => use(LayersContext) ?? CLOSED;
