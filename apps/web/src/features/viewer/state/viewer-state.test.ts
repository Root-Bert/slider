import type { Stroke } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  viewerReducer,
  type ViewerAction,
  type ViewerState,
} from './viewer-state';

const initial = createInitialState({ activeSlideId: 's1' });
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
  it('keeps no copy of the viewer’s colour – it is read live from the viewer data', () => {
    // A copy taken at mount went stale when the colour was changed mid-session: pen previews and
    // draft frames kept the old one.
    expect('color' in initial).toBe(false);
  });

  it('counts the reply fields holding a thread, so it stays listed until the last one lets go', () => {
    const hold = (composing: boolean): ViewerAction => ({
      type: 'composingChanged',
      threadId: 't1',
      composing,
    });
    expect(initial.composingThreads.size).toBe(0);
    // A typed reply and an open video dialog on the same thread.
    const both = run(hold(true), hold(true));
    expect(both.composingThreads.get('t1')).toBe(2);
    const one = viewerReducer(both, hold(false));
    expect(one.composingThreads.has('t1')).toBe(true);
    expect(viewerReducer(one, hold(false)).composingThreads.has('t1')).toBe(false);
  });

  it('defaults to open comments only (BER-101)', () => {
    expect(initial.statusFilter).toBe('open');
  });

  it('hides slides hidden in PowerPoint by default; H shows them', () => {
    expect(initial.showHiddenSlides).toBe(false);
    expect(run({ type: 'showHiddenSlidesToggled' }).showHiddenSlides).toBe(true);
  });

  it('a hidden active slide hands over to the fallback', () => {
    const state = run({
      type: 'slidesReplaced',
      slideIds: ['s2', 's3'],
      fallbackSlideId: 's2',
    });
    expect(state.activeSlideId).toBe('s2');
  });

  it('toggles tools', () => {
    let state = run({ type: 'toolSelected', tool: 'arrow' });
    expect(state.tool).toBe('arrow');
    state = viewerReducer(state, { type: 'toolSelected', tool: 'highlighter' });
    expect(state.tool).toBe('highlighter');
    state = viewerReducer(state, { type: 'toolSelected', tool: 'highlighter' });
    expect(state.tool).toBeNull();
  });

  it('typing right after a drawing comments on it, until the tool changes', () => {
    const saved: ViewerAction = {
      type: 'drawingSaved',
      slideId: 's1',
      commentId: 'c1',
      anchor: { type: 'rect', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, shapeRef: null },
      strokes: [stroke(0.1)],
    };
    let state = run({ type: 'toolSelected', tool: 'pen' }, saved);
    expect(state.lastDrawing?.commentId).toBe('c1');
    state = viewerReducer(state, {
      type: 'drawingCommentStarted',
      ...state.lastDrawing!,
      text: 'a',
    });
    expect(state.draft).toMatchObject({ commentId: 'c1', initialBody: 'a' });
    expect(state.lastDrawing).toBeNull();
    expect(run(saved, { type: 'toolSelected', tool: 'arrow' }).lastDrawing).toBeNull();
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

  it('keeps strokes when a mark is placed on the same slide; an empty draft starts over on another', () => {
    const anchor = { type: 'point' as const, point: { x: 0.5, y: 0.5 }, shapeRef: null };
    const state = run(
      { type: 'strokeAdded', slideId: 's1', stroke: stroke(0.1) },
      { type: 'anchorPlaced', slideId: 's1', anchor },
    );
    expect(state.draft).toMatchObject({ anchor, anchorFromStrokes: false });
    expect(state.draft?.strokes).toHaveLength(1);

    const empty = run({ type: 'anchorPlaced', slideId: 's1', anchor });
    expect(
      viewerReducer(empty, { type: 'anchorPlaced', slideId: 's2', anchor }).draft,
    ).toMatchObject({ slideId: 's2', strokes: [] });
  });

  describe('an open draft with content', () => {
    const anchor = { type: 'point' as const, point: { x: 0.5, y: 0.5 }, shapeRef: null };
    const box = { x: 0.2, y: 0.3, width: null, minHeight: 0, fontSize: 0.04 };
    // Text typed in the composer (or a recording, a sketch, an upload running).
    const held = run(
      { type: 'anchorPlaced', slideId: 's1', anchor },
      { type: 'draftHeld', held: true },
    );

    it('is not replaced by a click on another slide – the composer is nudged instead', () => {
      const state = viewerReducer(held, { type: 'anchorPlaced', slideId: 's2', anchor });
      expect(state.draft).toMatchObject({ slideId: 's1', anchor, held: true, nudge: 1 });
      expect(
        viewerReducer(state, { type: 'anchorPlaced', slideId: 's3', anchor }).draft?.nudge,
      ).toBe(2);
    });

    it('is not replaced by a text box, a shape, a gap or a drawing’s comment elsewhere', () => {
      const others: ViewerAction[] = [
        { type: 'textBoxPlaced', slideId: 's2', box },
        { type: 'strokeAdded', slideId: 's2', stroke: stroke(0.1) },
        { type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' },
        { type: 'drawingCommentStarted', slideId: 's1', commentId: 'c9', anchor, strokes: [] },
      ];
      for (const action of others)
        expect(viewerReducer(held, action).draft).toMatchObject({
          slideId: 's1',
          anchor,
          nudge: 1,
        });
    });

    it('keeps focus and the thread panel when the click is ignored', () => {
      const focused = viewerReducer(held, {
        type: 'threadFocused',
        threadId: 't1',
        openPanel: true,
      });
      const state = viewerReducer(focused, { type: 'anchorPlaced', slideId: 's2', anchor });
      expect(state).toMatchObject({ focusedThreadId: 't1', threadPanelOpen: true });
    });

    it('still moves its mark on the same slide', () => {
      const moved = { ...anchor, point: { x: 0.1, y: 0.1 } };
      const state = viewerReducer(held, { type: 'anchorPlaced', slideId: 's1', anchor: moved });
      expect(state.draft).toMatchObject({ anchor: moved, held: true });
      expect(state.draft?.nudge).toBeUndefined();
    });

    it('counts strokes drawn for it and text written on the slide as content', () => {
      const drawn = run({ type: 'strokeAdded', slideId: 's1', stroke: stroke(0.1) });
      expect(
        viewerReducer(drawn, { type: 'anchorPlaced', slideId: 's2', anchor }).draft,
      ).toMatchObject({ slideId: 's1', nudge: 1 });
      const written = run(
        { type: 'textBoxPlaced', slideId: 's1', box },
        { type: 'textBoxChanged', patch: { text: 'Hallo' } },
      );
      // Not even a mark on the same slide drops the text written there.
      const sameSlide = viewerReducer(written, { type: 'anchorPlaced', slideId: 's1', anchor });
      expect(sameSlide.draft?.textBox?.text).toBe('Hallo');
    });

    it('can be replaced again once the composer lets go', () => {
      const released = viewerReducer(held, { type: 'draftHeld', held: false });
      expect(
        viewerReducer(released, { type: 'anchorPlaced', slideId: 's2', anchor }).draft?.slideId,
      ).toBe('s2');
    });
  });

  it('places a text box as the anchor, keeps its text when re-placed and follows its size', () => {
    const box = { x: 0.2, y: 0.3, width: null, minHeight: 0, fontSize: 0.04 };
    let state = run(
      { type: 'strokeAdded', slideId: 's1', stroke: stroke(0.5) },
      { type: 'textBoxPlaced', slideId: 's1', box },
      { type: 'textBoxChanged', patch: { text: 'Hallo' } },
      { type: 'textBoxMeasured', rect: { x: 0.2, y: 0.3, w: 0.15, h: 0.06 } },
    );
    expect(state.draft?.strokes).toHaveLength(1);
    expect(state.draft?.anchorFromStrokes).toBe(false);
    expect(state.draft?.anchor).toEqual({
      type: 'rect',
      rect: { x: 0.2, y: 0.3, w: 0.15, h: 0.06 },
      shapeRef: null,
    });

    // Moving keeps the measured size.
    state = viewerReducer(state, { type: 'textBoxChanged', patch: { x: 0.4, y: 0.5 } });
    expect(state.draft?.anchor).toMatchObject({ rect: { x: 0.4, y: 0.5, w: 0.15, h: 0.06 } });

    // An unchanged measurement is a no-op.
    expect(
      viewerReducer(state, {
        type: 'textBoxMeasured',
        rect: { x: 0.4, y: 0.5, w: 0.15, h: 0.06 },
      }),
    ).toBe(state);

    state = viewerReducer(state, {
      type: 'textBoxPlaced',
      slideId: 's1',
      box: { ...box, x: 0.6 },
    });
    expect(state.draft?.textBox).toMatchObject({ x: 0.6, text: 'Hallo', measured: null });

    // The stroke keeps the draft from another slide; a mark on the same slide replaces the box
    // once it has no text in it.
    const blank = viewerReducer(state, { type: 'textBoxChanged', patch: { text: '' } });
    expect(viewerReducer(blank, { type: 'textBoxPlaced', slideId: 's2', box }).draft?.slideId).toBe(
      's1',
    );
    const anchor = { type: 'point' as const, point: { x: 0.5, y: 0.5 }, shapeRef: null };
    expect(
      viewerReducer(blank, { type: 'anchorPlaced', slideId: 's1', anchor }).draft?.textBox,
    ).toBeNull();
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
      { type: 'toolSelected', tool: 'pen' },
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
    const restored = createInitialState({ activeSlideId: 's1', split: 0.6 });
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

    it('falls back when the active slide was deleted and keeps its draft, flagged', () => {
      const state = run(
        { type: 'anchorPlaced', slideId: 's1', anchor: { type: 'slide' } },
        { type: 'slideHovered', slideId: 's1' },
        { type: 'slidesReplaced', slideIds: ['s2', 's3'], fallbackSlideId: 's3' },
      );
      expect(state.activeSlideId).toBe('s3');
      expect(state.hoveredSlideId).toBeNull();
      // What is written, recorded or drawn in the composer is not thrown away.
      expect(state.draft).toMatchObject({ slideId: 's1', slideGone: true });
      // The slide is back (hidden slides shown again): the draft can be sent again.
      const back = viewerReducer(state, {
        type: 'slidesReplaced',
        slideIds: ['s1', 's2', 's3'],
        fallbackSlideId: 's1',
      });
      expect(back.draft).toMatchObject({ slideId: 's1', slideGone: false });
    });

    it('moves a gap draft along when its neighbours were separated', () => {
      const started = run({ type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' });
      // Unchanged order: the very same draft.
      const same = viewerReducer(started, {
        type: 'slidesReplaced',
        slideIds: ['s0', 's1', 's2'],
        fallbackSlideId: 's1',
      });
      expect(same.draft).toBe(started.draft);
      // A slide inserted between them: the gap after s1 is in front of the new slide now.
      const inserted = viewerReducer(started, {
        type: 'slidesReplaced',
        slideIds: ['s1', 'new', 's2'],
        fallbackSlideId: 's1',
      });
      expect(inserted.draft?.anchor).toEqual({
        type: 'gap',
        afterSlideId: 's1',
        beforeSlideId: 'new',
      });
      expect(inserted.draft?.slideGone).toBe(false);
      // Both neighbours gone: kept, flagged.
      const gone = viewerReducer(started, {
        type: 'slidesReplaced',
        slideIds: ['s3'],
        fallbackSlideId: 's3',
      });
      expect(gone.draft).toMatchObject({ slideId: null, slideGone: true });
    });

    it('closes the panel of a thread deleted meanwhile, keeps it while the thread is there', () => {
      const open = run(
        { type: 'threadFocused', threadId: 't1', openPanel: true },
        { type: 'threadHovered', threadId: 't1' },
      );
      expect(
        viewerReducer(open, { type: 'threadsReplaced', threadIds: new Set(['t1', 't2']) }),
      ).toBe(open);
      const gone = viewerReducer(open, { type: 'threadsReplaced', threadIds: new Set(['t2']) });
      expect(gone).toMatchObject({
        threadPanelOpen: false,
        focusedThreadId: null,
        hoveredThreadId: null,
        editingCommentId: null,
      });
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

    it('closing the deleted slides when they are closed already changes nothing', () => {
      expect(viewerReducer(initial, { type: 'deletedPanelSet', open: false })).toBe(initial);
    });

    it('shows the change markers by default and toggles them', () => {
      expect(initial.showChanges).toBe(true);
      const hidden = run({ type: 'showChangesSet', show: false });
      expect(hidden.showChanges).toBe(false);
      expect(viewerReducer(hidden, { type: 'showChangesSet', show: true }).showChanges).toBe(true);
      expect(createInitialState({ activeSlideId: null, showChanges: false })).toMatchObject({
        showChanges: false,
      });
    });
  });
});
