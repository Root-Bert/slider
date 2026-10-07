import type { Stroke } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  viewerReducer,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewerAction,
  type ViewerState,
} from './viewer-state';

const initial = createInitialState({ activeSlideId: 's1', color: 'red' });
const run = (...actions: ViewerAction[]) => actions.reduce<ViewerState>(viewerReducer, initial);

const stroke = (x: number): Stroke => ({
  tool: 'pen',
  color: 'red',
  points: [
    { x, y: 0.1 },
    { x: x + 0.1, y: 0.2 },
  ],
});

describe('viewerReducer', () => {
  it('defaults to open comments only (BER-101)', () => {
    expect(initial.statusFilter).toBe('open');
  });

  it('toggles tools and remembers the last pen variant', () => {
    let state = run({ type: 'toolSelected', tool: 'arrow' });
    expect(state.tool).toBe('arrow');
    state = viewerReducer(state, { type: 'toolSelected', tool: 'arrow' });
    expect(state.tool).toBeNull();
    expect(state.lastStrokeTool).toBe('arrow');
  });

  it('collects strokes into one draft whose anchor follows them, with undo/redo', () => {
    let state = run(
      { type: 'strokeAdded', slideId: 's1', stroke: stroke(0.1) },
      { type: 'strokeAdded', slideId: 's1', stroke: stroke(0.5) },
    );
    expect(state.draft?.strokes).toHaveLength(2);
    expect(state.draft?.anchor).toMatchObject({ type: 'rect', rect: { x: 0.1, w: 0.5 } });

    state = viewerReducer(state, { type: 'undo' });
    expect(state.draft?.strokes).toHaveLength(1);
    expect(state.draft?.anchor).toMatchObject({ type: 'rect', rect: { x: 0.1 } });

    state = viewerReducer(state, { type: 'redo' });
    expect(state.draft?.strokes).toHaveLength(2);
  });

  it('keeps strokes when a mark is placed on the same slide, starts over on another', () => {
    const anchor = { type: 'point' as const, point: { x: 0.5, y: 0.5 }, shapeRef: null };
    let state = run(
      { type: 'strokeAdded', slideId: 's1', stroke: stroke(0.1) },
      { type: 'anchorPlaced', slideId: 's1', anchor },
    );
    expect(state.draft).toMatchObject({ anchor, anchorFromStrokes: false });
    expect(state.draft?.strokes).toHaveLength(1);

    state = viewerReducer(state, { type: 'anchorPlaced', slideId: 's2', anchor });
    expect(state.draft?.strokes).toHaveLength(0);
    expect(state.draft?.slideId).toBe('s2');
  });

  it('starts gap drafts without a slide and clears focus', () => {
    const state = run(
      { type: 'threadFocused', threadId: 't1', openPanel: true },
      { type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' },
    );
    expect(state.draft?.slideId).toBeNull();
    expect(state.threadPanelOpen).toBe(false);
    expect(state.focusedThreadId).toBeNull();
  });

  it('drops an inline focus on collapse, but not a thread shown in the panel', () => {
    const inline = run({ type: 'threadFocused', threadId: 't1', openPanel: false });
    expect(viewerReducer(inline, { type: 'threadUnfocused', threadId: 't1' }).focusedThreadId).toBe(
      null,
    );
    expect(viewerReducer(inline, { type: 'threadUnfocused', threadId: 't2' })).toBe(inline);

    const panel = run({ type: 'threadFocused', threadId: 't1', openPanel: true });
    expect(viewerReducer(panel, { type: 'threadUnfocused', threadId: 't1' })).toBe(panel);
  });

  it('clears the draft and the tool after sending', () => {
    const state = run(
      { type: 'toolSelected', tool: 'mark' },
      { type: 'anchorPlaced', slideId: 's1', anchor: { type: 'slide' } },
      { type: 'draftSubmitted' },
    );
    expect(state.draft).toBeNull();
    expect(state.tool).toBeNull();
  });

  it('clamps zoom to 0..1', () => {
    expect(run({ type: 'zoomChanged', zoom: 10 }).zoom).toBe(ZOOM_MAX);
    expect(run({ type: 'zoomChanged', zoom: -3 }).zoom).toBe(ZOOM_MIN);
  });

  it('starts at Desktop-1 (max zoom) unless a stored zoom is passed in', () => {
    expect(initial.zoom).toBe(1);
    const restored = createInitialState({ activeSlideId: 's1', color: 'red', zoom: 0.6 });
    expect(restored.zoom).toBe(0.6);
  });

  it('tracks the hovered slide and keeps the state when nothing changes', () => {
    const state = run({ type: 'slideHovered', slideId: 's2' });
    expect(state.hoveredSlideId).toBe('s2');
    expect(viewerReducer(state, { type: 'slideHovered', slideId: 's2' })).toBe(state);
    expect(viewerReducer(state, { type: 'slideHovered', slideId: null }).hoveredSlideId).toBeNull();
  });
});
