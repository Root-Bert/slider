import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { loadStoredBoxMode, storeBoxMode } from '@/lib/preferences/box-mode';
import { loadStoredSplit, storeSplit } from '@/lib/preferences/split';
import { loadWorkPreferences } from '@/lib/preferences/work-preferences';
import { createStageRegistry, StageRegistryContext } from './stage-registry';
import {
  nearestShownSlideId,
  ViewerDataContext,
  withoutHiddenSlides,
  type ViewerData,
} from './viewer-data';
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

/**
 * Provides server data, UI state and the stage registry as three separate contexts. `data` is
 * the whole deck; the viewer gets it without the slides hidden in PowerPoint unless they show.
 */
export function ViewerStoreProvider({
  data: all,
  initialSlideId,
  children,
}: ViewerStoreProviderProps) {
  const [state, dispatch] = useReducer(viewerReducer, null, () => {
    const preferences = loadWorkPreferences();
    const initial = initialSlideId && all.slideIndex.has(initialSlideId) ? initialSlideId : null;
    // A link to a hidden slide shows the hidden slides – else it would point into the void.
    const linkedHidden = initial !== null && all.slides[all.slideIndex.get(initial)!]!.hidden;
    return createInitialState({
      activeSlideId:
        initial ?? all.slides.find((slide) => !slide.hidden)?.id ?? all.slides[0]?.id ?? null,
      color: all.viewer.author.color,
      split: loadStoredSplit(),
      boxMode: loadStoredBoxMode(),
      ...preferences,
      showHiddenSlides: preferences.showHiddenSlides || linkedHidden,
    });
  });
  const data = useMemo(
    () => (state.showHiddenSlides ? all : withoutHiddenSlides(all)),
    [all, state.showHiddenSlides],
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
  const activeSlideId = useRef(state.activeSlideId);
  useEffect(() => {
    activeSlideId.current = state.activeSlideId;
  }, [state.activeSlideId]);
  useLayoutEffect(() => {
    const { slides } = data;
    // Hidden just now: the neighbour still shown. Gone with a new revision: whatever slide now
    // stands at its old place.
    const fallback =
      (activeSlideId.current &&
        nearestShownSlideId(all.slides, data.slideIndex, activeSlideId.current)) ??
      slides[Math.min(lastActiveIndex.current, slides.length - 1)]?.id ??
      slides[0]?.id ??
      null;
    dispatch({
      type: 'slidesReplaced',
      slideIds: slides.map((slide) => slide.id),
      fallbackSlideId: fallback,
    });
  }, [all, data]);

  // A thread deleted meanwhile (by someone else, or in another tab): its panel closes instead of
  // leaving an empty strip on the right.
  useLayoutEffect(() => {
    dispatch({ type: 'threadsReplaced', threadIds: new Set(all.threadById.keys()) });
  }, [all.threadById]);

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
