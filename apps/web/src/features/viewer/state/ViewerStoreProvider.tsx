import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { loadStoredBoxMode, storeBoxMode } from '../lib/box-mode';
import { loadStoredSplit, storeSplit } from '../lib/split';
import { createStageRegistry, StageRegistryContext } from './stage-registry';
import { ViewerDataContext, type ViewerData } from './viewer-data';
import {
  createInitialState,
  ViewerDispatchContext,
  viewerReducer,
  ViewerStateContext,
} from './viewer-state';

interface ViewerStoreProviderProps {
  data: ViewerData;
  initialSlideId: string | null;
  children: ReactNode;
}

/** Provides server data, UI state and the stage registry as three separate contexts. */
export function ViewerStoreProvider({ data, initialSlideId, children }: ViewerStoreProviderProps) {
  const [state, dispatch] = useReducer(
    viewerReducer,
    {
      activeSlideId:
        initialSlideId && data.slideIndex.has(initialSlideId)
          ? initialSlideId
          : (data.slides[0]?.id ?? null),
      color: data.viewer.author.color,
      split: loadStoredSplit(),
      boxMode: loadStoredBoxMode(),
    },
    createInitialState,
  );
  const [registry] = useState(createStageRegistry);

  // The split is a per-browser preference, not per deck.
  useEffect(() => storeSplit(state.split), [state.split]);
  useEffect(() => storeBoxMode(state.boxMode), [state.boxMode]);

  // A new revision keeps the active slide by its stable id. When that slide is gone, the slide
  // that now stands at its old place takes over (before paint, so nothing points into the void).
  const lastActiveIndex = useRef(0);
  const activeIndex = state.activeSlideId ? data.slideIndex.get(state.activeSlideId) : undefined;
  useEffect(() => {
    if (activeIndex !== undefined) lastActiveIndex.current = activeIndex;
  }, [activeIndex]);
  useLayoutEffect(() => {
    const { slides } = data;
    const fallback =
      slides[Math.min(lastActiveIndex.current, slides.length - 1)]?.id ?? slides[0]?.id ?? null;
    dispatch({
      type: 'slidesReplaced',
      slideIds: slides.map((slide) => slide.id),
      fallbackSlideId: fallback,
    });
  }, [data]);

  return (
    <ViewerDataContext value={data}>
      <StageRegistryContext value={registry}>
        <ViewerDispatchContext value={dispatch}>
          <ViewerStateContext value={state}>{children}</ViewerStateContext>
        </ViewerDispatchContext>
      </StageRegistryContext>
    </ViewerDataContext>
  );
}
