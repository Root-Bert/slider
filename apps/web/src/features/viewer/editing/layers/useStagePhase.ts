import { useCallback, useEffect, useState } from 'react';

/** How long a turn or a spread eases (ms). */
export const LAYER_EASE_MS = 300;
/** How long a slide eases into or out of its layers (ms). */
export const LAYER_SWAP_MS = 450;
/** Its pictures not there by then, it opens anyway: they come in as they are drawn. */
const PREP_MAX_MS = 800;
/** Flat again, the slide shows over it this long before it goes: drawn by then, never a gap. */
const CLOSED_MS = 150;

/**
 * Where a slide is on its way into its layers (`LayerStage`): `prep` – the stage is there but
 * unseen, flat and as large as the slide, until its pictures are decoded (the slide shows as it is
 * meanwhile); `opening` – eased into its layers; `open`; `out` – eased flat again; `closed` – the
 * slide shows over it again, as it is, before the stage goes (`null`).
 */
export type StagePhase = 'prep' | 'opening' | 'open' | 'out' | 'closed' | null;

export function useStagePhase(on: boolean): { phase: StagePhase; ready: () => void } {
  const [phase, setPhase] = useState<StagePhase>(on ? 'prep' : null);
  const [was, setWas] = useState(on);
  if (on !== was) {
    setWas(on);
    // Back while still leaving: it eases back into its layers from where it is.
    if (on) setPhase(phase === 'out' || phase === 'closed' ? 'opening' : 'prep');
    // Never shown: simply gone.
    else if (phase === null || phase === 'prep') setPhase(null);
    else if (phase !== 'closed') setPhase('out');
  }
  const ready = useCallback(() => setPhase((at) => (at === 'prep' ? 'opening' : at)), []);
  useEffect(() => {
    if (phase === 'prep') {
      const timer = window.setTimeout(ready, PREP_MAX_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase === 'opening' || phase === 'out') {
      const timer = window.setTimeout(
        () => setPhase(phase === 'opening' ? 'open' : 'closed'),
        LAYER_SWAP_MS,
      );
      return () => window.clearTimeout(timer);
    }
    if (phase === 'closed') {
      const timer = window.setTimeout(() => setPhase(null), CLOSED_MS);
      return () => window.clearTimeout(timer);
    }
  }, [phase, ready]);
  return { phase, ready };
}
