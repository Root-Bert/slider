import type { Stroke } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  viewerReducer,
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

  it('clamps the split to 0..1 and resets it with null', () => {
    expect(run({ type: 'splitChanged', split: 10 }).split).toBe(1);
    expect(run({ type: 'splitChanged', split: -3 }).split).toBe(0);
    const moved = run({ type: 'splitChanged', split: 0.3 });
    expect(viewerReducer(moved, { type: 'splitChanged', split: null }).split).toBeNull();
    expect(viewerReducer(moved, { type: 'splitChanged', split: 0.3 })).toBe(moved);
  });

  it('starts at the default split unless a stored split is passed in', () => {
    expect(initial.split).toBeNull();
    const restored = createInitialState({ activeSlideId: 's1', color: 'red', split: 0.6 });
    expect(restored.split).toBe(0.6);
  });

  it('tracks the hovered slide and keeps the state when nothing changes', () => {
    const state = run({ type: 'slideHovered', slideId: 's2' });
    expect(state.hoveredSlideId).toBe('s2');
    expect(viewerReducer(state, { type: 'slideHovered', slideId: 's2' })).toBe(state);
    expect(viewerReducer(state, { type: 'slideHovered', slideId: null }).hoveredSlideId).toBeNull();
  });

  describe('revisions (BER-107, BER-109)', () => {
    it('keeps the active slide when it still exists', () => {
      const state = run({ type: 'slidesReplaced', slideIds: ['s0', 's1'], fallbackSlideId: 's0' });
      expect(state).toBe(initial);
    });

    it('falls back when the active slide was deleted and drops its draft', () => {
      const state = run(
        { type: 'anchorPlaced', slideId: 's1', anchor: { type: 'slide' } },
        { type: 'slideHovered', slideId: 's1' },
        { type: 'slidesReplaced', slideIds: ['s2', 's3'], fallbackSlideId: 's3' },
      );
      expect(state.activeSlideId).toBe('s3');
      expect(state.hoveredSlideId).toBeNull();
      expect(state.draft).toBeNull();
    });

    it('drops a gap draft whose neighbour is gone', () => {
      const state = run(
        { type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' },
        { type: 'slidesReplaced', slideIds: ['s1', 's3'], fallbackSlideId: 's1' },
      );
      expect(state.draft).toBeNull();
    });

    it('shares the right side between thread panel and deleted slides', () => {
      let state = run(
        { type: 'threadFocused', threadId: 't1', openPanel: true },
        { type: 'deletedPanelSet', open: true },
      );
      expect(state).toMatchObject({ deletedPanelOpen: true, threadPanelOpen: false });
      state = viewerReducer(state, { type: 'threadFocused', threadId: 't2', openPanel: true });
      expect(state).toMatchObject({ deletedPanelOpen: false, threadPanelOpen: true });
    });

    it('shows the change markers by default and toggles them', () => {
      expect(initial.showChanges).toBe(true);
      const hidden = run({ type: 'showChangesSet', show: false });
      expect(hidden.showChanges).toBe(false);
      expect(viewerReducer(hidden, { type: 'showChangesSet', show: true }).showChanges).toBe(true);
      expect(
        createInitialState({ activeSlideId: null, color: 'red', showChanges: false }),
      ).toMatchObject({ showChanges: false });
    });
  });
});
