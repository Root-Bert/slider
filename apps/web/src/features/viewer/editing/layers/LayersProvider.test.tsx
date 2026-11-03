import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayersProvider } from './LayersProvider';
import { useLayers } from './layers-context';

vi.mock('../editing-context', () => ({ useEditing: () => ({ layers: true, selection: null }) }));
vi.mock('./useLayersAhead', () => ({ useLayersAhead: () => {} }));
vi.mock('../../state/viewer-data', () => ({ useViewerData: () => ({ slides: [{ id: 'a' }] }) }));
vi.mock('../../state/viewer-state', () => ({
  useViewerState: () => ({ activeSlideId: 'a', layersPanelOpen: false }),
  useViewerDispatch: () => vi.fn(),
}));

describe('hover ownership across layer slides', () => {
  it('keeps another slide hovered when the old slide leaves or unmounts', () => {
    const { result } = renderHook(() => useLayers(), { wrapper: LayersProvider });
    act(() => result.current.setHovered('a', 'same-id'));
    act(() => result.current.setHovered('b', 'same-id'));
    act(() => result.current.setHovered('a', null));
    expect(result.current.hovered).toEqual({ slideId: 'b', elementId: 'same-id' });
    act(() => result.current.setHovered('b', null));
    expect(result.current.hovered).toBeNull();
  });
});
