import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { loadStoredZoom, storeZoom } from '../lib/zoom';
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
      zoom: loadStoredZoom(),
    },
    createInitialState,
  );
  const [registry] = useState(createStageRegistry);

  // Zoom is a per-browser preference, not per deck.
  useEffect(() => storeZoom(state.zoom), [state.zoom]);

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
