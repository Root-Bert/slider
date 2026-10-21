import type { Author, Shape } from '@slider/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useReducer, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../comments/Composer';
import { useViewerShortcuts } from './useViewerShortcuts';
import { slide } from '../lib/test-fixtures';
import { createStageRegistry, StageRegistryContext } from '../state/stage-registry';
import { ViewerDataContext, type ViewerData } from '../state/viewer-data';
import {
  createInitialState,
  ViewerDispatchContext,
  viewerReducer,
  ViewerStateContext,
  type ViewerState,
} from '../state/viewer-state';
import { ViewerToastContext } from '../state/viewer-toast';

vi.mock('@/lib/api', () => ({
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
}));
vi.mock('../media/hooks/useMediaComment', () => ({
  useCreateMediaComment: () => ({
    mutate: vi.fn(),
    cancel: vi.fn(),
    isPending: false,
    progress: 0,
    error: null,
  }),
  useMediaUsage: () => ({ data: undefined }),
}));
vi.mock('./useGoToSlide', () => ({ useGoToSlide: () => vi.fn() }));
vi.mock('../comments/hooks/useComposerPosition', () => ({
  useComposerPosition: () => ({ left: 0, top: 0 }),
}));

const me = { id: 'u1', name: 'Rita Roth', color: 'violet', type: 'owner' } as Author;
const slides = [slide('s1', 0), slide('s2', 1)];
const data = {
  deck: { id: 'd1' },
  viewer: { author: me },
  slides,
  slideIndex: new Map(slides.map((item, index) => [item.id, index])),
  canComment: true,
  mentionable: [],
  participantNames: [],
} as unknown as ViewerData;
const title: Shape = {
  id: '7',
  name: 'Titel 1',
  bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
  text: '',
};

let state: ViewerState;

function Shortcuts() {
  useViewerShortcuts({ onToggleFullscreen: vi.fn() });
  return null;
}

function setup({ boxMode = true, canComment = true } = {}) {
  const registry = createStageRegistry();
  function Harness() {
    const [current, dispatch] = useReducer(
      viewerReducer,
      createInitialState({ activeSlideId: 's2', boxMode }),
    );
    const [viewerData] = useState(() => ({ ...data, canComment }));
    useEffect(() => {
      state = current;
    });
    return (
      <ViewerDataContext value={viewerData}>
        <ViewerStateContext value={current}>
          <ViewerDispatchContext value={dispatch}>
            <StageRegistryContext value={registry}>
              <ViewerToastContext value={vi.fn()}>
                <Shortcuts />
                <input aria-label="Suche" />
                <Composer />
              </ViewerToastContext>
            </StageRegistryContext>
          </ViewerDispatchContext>
        </ViewerStateContext>
      </ViewerDataContext>
    );
  }
  render(<Harness />);
  return { registry };
}

const commentField = () => screen.getByLabelText('Kommentar');
const pressC = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'c' });

describe('C', () => {
  it('comments on the active slide when the pointer is on no box', async () => {
    setup();
    expect(pressC()).toBe(false);
    expect(state.draft).toMatchObject({ slideId: 's2', anchor: { type: 'slide' } });
    expect(screen.getByRole('dialog', { name: 'Neuer Kommentar | Folie 2' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(commentField()));
    // Esc cancels as for any draft.
    fireEvent.keyDown(commentField(), { key: 'Escape' });
    expect(state.draft).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing for people who only look', () => {
    setup({ canComment: false });
    pressC();
    expect(state.draft).toBeNull();
  });

  it('comments on the box under the pointer in box mode – the anchor a click places', async () => {
    const { registry } = setup();
    act(() => registry.setHoveredBox('s1', title));
    pressC();
    expect(state.activeSlideId).toBe('s1');
    expect(state.draft).toMatchObject({
      slideId: 's1',
      anchor: { type: 'rect', rect: title.bbox, shapeRef: { shapeId: '7' } },
    });
    await waitFor(() => expect(document.activeElement).toBe(commentField()));
  });

  it('takes the whole slide outside box mode, even over a box', () => {
    const { registry } = setup({ boxMode: false });
    registry.setHoveredBox('s1', title);
    pressC();
    expect(state.draft).toMatchObject({ slideId: 's2', anchor: { type: 'slide' } });
  });

  it('is left alone while typing, and with a modifier', () => {
    setup();
    const search = screen.getByRole('textbox', { name: 'Suche' });
    expect(pressC(search)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    expect(state.draft).toBeNull();
  });

  it('types into an open composer instead of moving its mark', () => {
    setup();
    pressC();
    const before = state.draft;
    pressC();
    expect(state.draft?.anchor).toEqual(before?.anchor);
  });
});

describe('stage registry: hovered box', () => {
  it('lets a slide clear only its own box', () => {
    const registry = createStageRegistry();
    registry.setHoveredBox('s1', title);
    registry.setHoveredBox('s2', null);
    expect(registry.getHoveredBox()).toEqual({ slideId: 's1', shape: title });
    registry.setHoveredBox('s1', null);
    expect(registry.getHoveredBox()).toBeNull();
  });
});
