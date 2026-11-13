import { threadForRequest, type Anchor, type Rect, type Stroke } from '@slider/shared';
import type { Thread } from '../comments/lib/comment-selectors';
import { workingThreadAt } from '../voice/lib/ai-additions';
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
  it('starts with its defaults and toggles the simple view flags', () => {
    // No copy of the viewer's colour: a copy taken at mount went stale when it changed mid-session.
    expect('color' in initial).toBe(false);
    expect(initial.statusFilter).toBe('open');
    expect(initial.showHiddenSlides).toBe(false);
    expect(run({ type: 'showHiddenSlidesToggled' }).showHiddenSlides).toBe(true);

    expect(initial.showChanges).toBe(false);
    const shown = run({ type: 'showChangesSet', show: true });
    expect(shown.showChanges).toBe(true);
    expect(viewerReducer(shown, { type: 'showChangesSet', show: false }).showChanges).toBe(false);
    expect(createInitialState({ activeSlideId: null, showChanges: true }).showChanges).toBe(true);

    // The split is clamped to 0..1, null resets it, a stored one is restored.
    expect(initial.split).toBeNull();
    expect(createInitialState({ activeSlideId: 's1', split: 0.6 }).split).toBe(0.6);
    expect(run({ type: 'splitChanged', split: 10 }).split).toBe(1);
    expect(run({ type: 'splitChanged', split: -3 }).split).toBe(0);
    const moved = run({ type: 'splitChanged', split: 0.3 });
    expect(viewerReducer(moved, { type: 'splitChanged', split: null }).split).toBeNull();
    expect(viewerReducer(moved, { type: 'splitChanged', split: 0.3 })).toBe(moved);

    // The material page: beside the presentation, its board's panel apart from the deck's panels.
    expect(initial.materialOpen).toBe(false);
    expect(createInitialState({ activeSlideId: null, materialOpen: true }).materialOpen).toBe(true);
    const thread = run({ type: 'threadFocused', threadId: 't1', openPanel: true });
    const onMaterial = viewerReducer(thread, { type: 'materialSet', open: true });
    const picked = viewerReducer(onMaterial, { type: 'boardPanelSet', open: true });
    expect(picked.boardPanelOpen).toBe(true);
    expect(thread.threadPanelOpen).toBe(true);
    expect(picked.threadPanelOpen).toBe(true);
    const back = viewerReducer(picked, { type: 'materialSet', open: false });
    expect(back.materialOpen).toBe(false);
    expect(back.boardPanelOpen).toBe(false);
  });

  it('keeps every slide’s own zoom and drops them all when the frame shape toggles', () => {
    const zoom = (slideId: string) => ({ slideId, scale: 2, x: 0.1, y: 0.1 });
    const both = run(
      { type: 'slideZoomChanged', slideId: 's1', zoom: zoom('s1') },
      { type: 'slideZoomChanged', slideId: 's2', zoom: zoom('s2') },
    );
    expect([...both.slideZooms.keys()]).toEqual(['s1', 's2']);
    // Reaching a zoom/pan limit again must not invalidate the viewer context.
    expect(viewerReducer(both, { type: 'slideZoomChanged', slideId: 's1', zoom: zoom('s1') })).toBe(
      both,
    );
    expect(viewerReducer(initial, { type: 'slideZoomChanged', slideId: 's1', zoom: null })).toBe(
      initial,
    );
    const panned = viewerReducer(both, {
      type: 'slideZoomChanged',
      slideId: 's1',
      zoom: { ...zoom('s1'), x: 0.2 },
    });
    expect(panned.slideZooms.get('s1')?.x).toBe(0.2);
    expect(panned.slideZooms.get('s2')).toBe(both.slideZooms.get('s2'));
    const one = viewerReducer(both, { type: 'slideZoomChanged', slideId: 's1', zoom: null });
    expect([...one.slideZooms.keys()]).toEqual(['s2']);

    const wide = viewerReducer(one, { type: 'wideFramesToggled' });
    expect(wide.wideFrames).toBe(true);
    expect(wide.slideZooms.size).toBe(0);
    expect(viewerReducer(wide, { type: 'wideFramesToggled' }).wideFrames).toBe(false);
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

  it('hidden comments come back once one is written or a thread is opened', () => {
    const hidden: ViewerAction = { type: 'statusFilterChanged', filter: 'hidden' };
    expect(run(hidden).statusFilter).toBe('hidden');
    expect(run(hidden, { type: 'draftSubmitted' }).statusFilter).toBe('open');
    const focused = run(hidden, { type: 'threadFocused', threadId: 't1', openPanel: true });
    expect(focused.statusFilter).toBe('all');
    // Any other filter stays as it is.
    const done = run({ type: 'statusFilterChanged', filter: 'done' }, { type: 'draftSubmitted' });
    expect(done.statusFilter).toBe('done');
    // K hides them and brings back the filter they were hidden from – also after a click on hide.
    const toggle: ViewerAction = { type: 'commentsToggled' };
    const ai: ViewerAction = { type: 'statusFilterChanged', filter: 'ai' };
    expect(run(ai, toggle).statusFilter).toBe('hidden');
    expect(run(ai, toggle, toggle).statusFilter).toBe('ai');
    expect(run(ai, hidden, toggle).statusFilter).toBe('ai');
    expect(run(toggle, toggle).statusFilter).toBe(initial.statusFilter);
    expect(
      createInitialState({ activeSlideId: null, statusFilter: 'hidden' }).shownStatusFilter,
    ).toBe('open');
  });

  it('toggles tools, comments on a drawing typed right after it and clears both on sending', () => {
    let tools = run({ type: 'toolSelected', tool: 'arrow' });
    expect(tools.tool).toBe('arrow');
    tools = viewerReducer(tools, { type: 'toolSelected', tool: 'highlighter' });
    expect(tools.tool).toBe('highlighter');
    tools = viewerReducer(tools, { type: 'toolSelected', tool: 'highlighter' });
    expect(tools.tool).toBeNull();

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
    // Until the tool changes.
    expect(run(saved, { type: 'toolSelected', tool: 'arrow' }).lastDrawing).toBeNull();

    const sent = run(
      { type: 'toolSelected', tool: 'pen' },
      { type: 'anchorPlaced', slideId: 's1', anchor: { type: 'slide' } },
      { type: 'draftSubmitted' },
    );
    expect(sent.draft).toBeNull();
    expect(sent.tool).toBeNull();
  });

  it('collects strokes into one draft whose anchor follows them, with undo/redo and marks', () => {
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

    // A mark on the same slide keeps the strokes; an empty draft starts over on another.
    const anchor = { type: 'point' as const, point: { x: 0.5, y: 0.5 }, shapeRef: null };
    const marked = viewerReducer(state, { type: 'anchorPlaced', slideId: 's1', anchor });
    expect(marked.draft).toMatchObject({ anchor, anchorFromStrokes: false });
    expect(marked.draft?.strokes).toHaveLength(2);
    const empty = run({ type: 'anchorPlaced', slideId: 's1', anchor });
    expect(
      viewerReducer(empty, { type: 'anchorPlaced', slideId: 's2', anchor }).draft,
    ).toMatchObject({ slideId: 's2', strokes: [] });
  });

  it('never replaces an open draft with content elsewhere – the composer is nudged instead', () => {
    const anchor = { type: 'point' as const, point: { x: 0.5, y: 0.5 }, shapeRef: null };
    const box = { x: 0.2, y: 0.3, width: null, minHeight: 0, fontSize: 0.04 };
    // Text typed in the composer (or a recording, a sketch, an upload running).
    const held = run(
      { type: 'anchorPlaced', slideId: 's1', anchor },
      { type: 'draftHeld', held: true },
    );

    const nudged = viewerReducer(held, { type: 'anchorPlaced', slideId: 's2', anchor });
    expect(nudged.draft).toMatchObject({ slideId: 's1', anchor, held: true, nudge: 1 });
    expect(
      viewerReducer(nudged, { type: 'anchorPlaced', slideId: 's3', anchor }).draft?.nudge,
    ).toBe(2);

    const others: ViewerAction[] = [
      { type: 'textBoxPlaced', slideId: 's2', box },
      { type: 'strokeAdded', slideId: 's2', stroke: stroke(0.1) },
      { type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' },
      { type: 'drawingCommentStarted', slideId: 's1', commentId: 'c9', anchor, strokes: [] },
    ];
    for (const action of others)
      expect(viewerReducer(held, action).draft).toMatchObject({ slideId: 's1', anchor, nudge: 1 });

    // Focus and the thread panel stay when the click is ignored.
    const focused = viewerReducer(held, { type: 'threadFocused', threadId: 't1', openPanel: true });
    expect(viewerReducer(focused, { type: 'anchorPlaced', slideId: 's2', anchor })).toMatchObject({
      focusedThreadId: 't1',
      threadPanelOpen: true,
    });

    // Its mark still moves on the same slide.
    const moved = { ...anchor, point: { x: 0.1, y: 0.1 } };
    const same = viewerReducer(held, { type: 'anchorPlaced', slideId: 's1', anchor: moved });
    expect(same.draft).toMatchObject({ anchor: moved, held: true });
    expect(same.draft?.nudge).toBeUndefined();

    // A box for the AI (drawn while speaking to it): moved it stays one; with words in it it is
    // never kept – whatever comes (a click, another box, another slide, a stroke, a text box, a
    // gap) takes its place at once, no nudge (its field sends it as it closes), and nothing of it
    // is carried over. A comment with text never turns into a box for it.
    const rect = {
      type: 'rect' as const,
      rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
      shapeRef: null,
    };
    const aiHeld = run(
      { type: 'anchorPlaced', slideId: 's1', anchor: rect, aiBox: 1 },
      { type: 'draftHeld', held: true },
    );
    expect(aiHeld.draft?.aiBox).toBe(1);
    const aiMoved = { ...rect, rect: { ...rect.rect, x: 0.2 } };
    expect(
      viewerReducer(aiHeld, { type: 'anchorPlaced', slideId: 's1', anchor: aiMoved, aiBox: 1 })
        .draft,
    ).toMatchObject({ anchor: aiMoved, aiBox: 1, held: true });
    const clicked = viewerReducer(aiHeld, { type: 'anchorPlaced', slideId: 's1', anchor }).draft;
    expect(clicked).toMatchObject({ anchor });
    expect(clicked?.aiBox).toBeUndefined();
    expect(clicked?.held).toBeUndefined();
    const next = viewerReducer(aiHeld, {
      type: 'anchorPlaced',
      slideId: 's1',
      anchor: aiMoved,
      aiBox: 2,
    }).draft;
    expect(next).toMatchObject({ anchor: aiMoved, aiBox: 2 });
    expect(next?.held).toBeUndefined();
    for (const action of [
      { type: 'anchorPlaced', slideId: 's2', anchor },
      ...others,
      { type: 'strokeAdded', slideId: 's1', stroke: stroke(0.1) },
      { type: 'textBoxPlaced', slideId: 's1', box },
    ] satisfies ViewerAction[]) {
      const taken = viewerReducer(aiHeld, action).draft;
      expect(taken?.aiBox).toBeUndefined();
      expect(taken?.nudge).toBeUndefined();
      expect(taken?.held).toBeUndefined();
    }
    expect(
      viewerReducer(held, { type: 'anchorPlaced', slideId: 's1', anchor: rect, aiBox: 2 }).draft,
    ).toMatchObject({ anchor, nudge: 1 });
    // A box adding to one's own request at work (`aiThreadId`) keeps it as it moves; a new box
    // has none of it.
    const adding = run({
      type: 'anchorPlaced',
      slideId: 's1',
      anchor: rect,
      aiBox: 3,
      aiThreadId: 't1',
    });
    expect(
      viewerReducer(adding, { type: 'anchorPlaced', slideId: 's1', anchor: aiMoved, aiBox: 3 })
        .draft,
    ).toMatchObject({ anchor: aiMoved, aiThreadId: 't1' });
    expect(
      viewerReducer(adding, { type: 'anchorPlaced', slideId: 's1', anchor: rect, aiBox: 4 }).draft
        ?.aiThreadId,
    ).toBeUndefined();
    // Where it adds: one's own thread the AI works on, at the same element or area – the newest.
    const thread = (id: string, at: Anchor, authorId = 'me', createdAt = '1') =>
      ({
        id,
        root: { id, slideId: 's1', anchor: at, author: { id: authorId }, createdAt },
        replies: [],
      }) as unknown as Thread;
    const bound = { ...rect, shapeRef: { shapeId: 'e1', offset: { x: 0.5, y: 0.5 } } };
    const threads = [
      thread('t1', bound),
      thread('t2', rect, 'me', '2'),
      thread('t3', aiMoved, 'other', '3'),
    ];
    const busy = new Set(['t1', 't2', 't3']);
    const at = (rect: Rect, shapeId: string | null = null) => ({ slideId: 's1', rect, shapeId });
    expect(workingThreadAt(threads, busy, 'me', at(aiMoved.rect))?.id).toBe('t2');
    expect(
      workingThreadAt(threads, busy, 'me', at({ x: 0.8, y: 0.8, w: 0.1, h: 0.1 }, 'e1'))?.id,
    ).toBe('t1');
    expect(workingThreadAt(threads, new Set(['t3']), 'me', at(aiMoved.rect))).toBeNull();
    expect(workingThreadAt(threads, busy, 'me', at({ x: 0.8, y: 0.8, w: 0.1, h: 0.1 }))).toBeNull();
    expect(workingThreadAt(threads, busy, 'me', { ...at(rect.rect), slideId: 's2' })).toBeNull();
    // A box for the AI over what an open thread is about (anyone's, at work or not) goes on in it:
    // about the same area (strong overlap), the same element when both are bound – the closest,
    // then the newest. Resolved threads, other elements, a loose overlap: a thread of its own.
    const root = (id: string, at: Anchor, status: 'open' | 'done' = 'open', createdAt = '1') => ({
      id,
      slideId: 's1',
      parentId: null,
      status,
      anchor: at,
      createdAt,
    });
    const free = {
      type: 'rect' as const,
      rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
      shapeRef: null,
    };
    const near = { ...free, rect: { x: 0.12, y: 0.11, w: 0.38, h: 0.2 } };
    const onE1 = { ...near, shapeRef: { shapeId: 'e1', offset: { x: 0.5, y: 0.5 } } };
    const onE2 = { ...free, shapeRef: { shapeId: 'e2', offset: { x: 0.5, y: 0.5 } } };
    expect(threadForRequest([root('a', free), root('b', free, 'open', '2')], 's1', near)?.id).toBe(
      'b',
    );
    expect(threadForRequest([root('a', free, 'done')], 's1', near)).toBeNull();
    expect(threadForRequest([root('a', onE2)], 's1', onE1)).toBeNull();
    expect(threadForRequest([root('a', onE2)], 's1', near)?.id).toBe('a');
    expect(
      threadForRequest([root('a', free)], 's1', {
        ...free,
        rect: { x: 0.3, y: 0.1, w: 0.4, h: 0.2 },
      }),
    ).toBeNull();
    expect(threadForRequest([root('a', free)], 's2', near)).toBeNull();
    expect(threadForRequest([root('a', { type: 'slide' })], 's1', near)).toBeNull();

    // Strokes drawn for it and text written on the slide count as content.
    const drawn = run({ type: 'strokeAdded', slideId: 's1', stroke: stroke(0.1) });
    expect(
      viewerReducer(drawn, { type: 'anchorPlaced', slideId: 's2', anchor }).draft,
    ).toMatchObject({ slideId: 's1', nudge: 1 });
    const written = run(
      { type: 'textBoxPlaced', slideId: 's1', box },
      { type: 'textBoxChanged', patch: { text: 'Hallo' } },
    );
    // Not even a mark on the same slide drops the text written there.
    expect(
      viewerReducer(written, { type: 'anchorPlaced', slideId: 's1', anchor }).draft?.textBox?.text,
    ).toBe('Hallo');

    // Replaceable again once the composer lets go.
    const released = viewerReducer(held, { type: 'draftHeld', held: false });
    expect(
      viewerReducer(released, { type: 'anchorPlaced', slideId: 's2', anchor }).draft?.slideId,
    ).toBe('s2');
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

  it('drops focus for gap drafts, inline collapses and threads deleted meanwhile', () => {
    const gap = run(
      { type: 'threadFocused', threadId: 't1', openPanel: true },
      { type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' },
    );
    expect(gap.draft?.slideId).toBeNull();
    expect(gap).toMatchObject({ threadPanelOpen: false, focusedThreadId: null });

    // An inline focus goes on collapse, a thread shown in the panel does not.
    const inline = run({ type: 'threadFocused', threadId: 't1', openPanel: false });
    expect(
      viewerReducer(inline, { type: 'threadUnfocused', threadId: 't1' }).focusedThreadId,
    ).toBeNull();
    expect(viewerReducer(inline, { type: 'threadUnfocused', threadId: 't2' })).toBe(inline);
    const open = run({ type: 'threadFocused', threadId: 't1', openPanel: true });
    expect(viewerReducer(open, { type: 'threadUnfocused', threadId: 't1' })).toBe(open);

    expect(viewerReducer(open, { type: 'threadsReplaced', threadIds: new Set(['t1', 't2']) })).toBe(
      open,
    );
    expect(
      viewerReducer(open, { type: 'threadsReplaced', threadIds: new Set(['t2']) }),
    ).toMatchObject({ threadPanelOpen: false, focusedThreadId: null, editingCommentId: null });
  });

  it('follows new slide lists: falls back from a gone slide and keeps drafts, flagged', () => {
    // Still there: the very same state.
    expect(run({ type: 'slidesReplaced', slideIds: ['s0', 's1'], fallbackSlideId: 's0' })).toBe(
      initial,
    );

    const state = run(
      { type: 'anchorPlaced', slideId: 's1', anchor: { type: 'slide' } },
      { type: 'slidesReplaced', slideIds: ['s2', 's3'], fallbackSlideId: 's3' },
    );
    expect(state.activeSlideId).toBe('s3');
    // What is written, recorded or drawn in the composer is not thrown away.
    expect(state.draft).toMatchObject({ slideId: 's1', slideGone: true });
    // The slide is back (hidden slides shown again): the draft can be sent again.
    const back = viewerReducer(state, {
      type: 'slidesReplaced',
      slideIds: ['s1', 's2', 's3'],
      fallbackSlideId: 's1',
    });
    expect(back.draft).toMatchObject({ slideId: 's1', slideGone: false });

    const started = run({ type: 'gapDraftStarted', afterSlideId: 's1', beforeSlideId: 's2' });
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

  it('shares the right side between the thread, deleted slides, layers, layout and background panels', () => {
    expect(viewerReducer(initial, { type: 'deletedPanelSet', open: false })).toBe(initial);
    let state = run(
      { type: 'threadFocused', threadId: 't1', openPanel: true },
      { type: 'deletedPanelSet', open: true },
    );
    expect(state).toMatchObject({ deletedPanelOpen: true, threadPanelOpen: false });
    state = viewerReducer(state, { type: 'threadFocused', threadId: 't2', openPanel: true });
    expect(state).toMatchObject({ deletedPanelOpen: false, threadPanelOpen: true });

    // The layers mode on opens no panel and stays on without it.
    state = viewerReducer(state, { type: 'layersSet', open: true });
    expect(state).toMatchObject({
      layersOpen: true,
      layersPanelOpen: false,
      threadPanelOpen: true,
    });
    state = viewerReducer(state, { type: 'layersPanelSet', open: true });
    expect(state).toMatchObject({
      layersOpen: true,
      layersPanelOpen: true,
      threadPanelOpen: false,
      focusedThreadId: null,
    });
    state = viewerReducer(state, { type: 'deletedPanelSet', open: true });
    expect(state).toMatchObject({
      layersOpen: true,
      layersPanelOpen: false,
      deletedPanelOpen: true,
    });
    state = viewerReducer(state, { type: 'layersPanelSet', open: true });
    expect(state).toMatchObject({ layersPanelOpen: true, deletedPanelOpen: false });
    state = viewerReducer(state, { type: 'threadFocused', threadId: 't2', openPanel: true });
    expect(state).toMatchObject({
      layersOpen: true,
      layersPanelOpen: false,
      threadPanelOpen: true,
    });
    state = viewerReducer(state, { type: 'layersSet', open: false });
    expect(state).toMatchObject({ layersOpen: false, layersPanelOpen: false });
    // Without the mode, no panel.
    expect(viewerReducer(initial, { type: 'layersPanelSet', open: true })).toBe(initial);
    expect(viewerReducer(initial, { type: 'layersSet', open: false })).toBe(initial);

    // The layout view on opens no panel; the panel opens the view; the view off takes the panel.
    let grid = run(
      { type: 'threadFocused', threadId: 't1', openPanel: true },
      { type: 'layoutGridToggled' },
    );
    expect(grid).toMatchObject({
      showLayoutGrid: true,
      layoutGridPanelOpen: false,
      threadPanelOpen: true,
    });
    grid = viewerReducer(grid, { type: 'layoutGridPanelSet', open: true });
    expect(grid).toMatchObject({ layoutGridPanelOpen: true, threadPanelOpen: false });
    grid = viewerReducer(grid, { type: 'deletedPanelSet', open: true });
    expect(grid).toMatchObject({
      showLayoutGrid: true,
      layoutGridPanelOpen: false,
      deletedPanelOpen: true,
    });
    grid = viewerReducer(grid, { type: 'layoutGridPanelSet', open: true });
    grid = viewerReducer(grid, { type: 'layoutGridToggled' });
    expect(grid).toMatchObject({ showLayoutGrid: false, layoutGridPanelOpen: false });
    expect(viewerReducer(initial, { type: 'layoutGridPanelSet', open: true })).toMatchObject({
      showLayoutGrid: true,
      layoutGridPanelOpen: true,
    });

    let bg = run(
      { type: 'threadFocused', threadId: 't1', openPanel: true },
      { type: 'backgroundPanelSet', pageId: 'p1' },
    );
    expect(bg).toMatchObject({
      backgroundPanelPageId: 'p1',
      threadPanelOpen: false,
      focusedThreadId: null,
    });
    bg = viewerReducer(bg, { type: 'deletedPanelSet', open: true });
    expect(bg).toMatchObject({ backgroundPanelPageId: null, deletedPanelOpen: true });
    bg = viewerReducer(bg, { type: 'backgroundPanelSet', pageId: 'p2' });
    expect(bg).toMatchObject({ backgroundPanelPageId: 'p2', deletedPanelOpen: false });
    bg = viewerReducer(bg, { type: 'threadFocused', threadId: 't2', openPanel: true });
    expect(bg).toMatchObject({ backgroundPanelPageId: null, threadPanelOpen: true });
    expect(viewerReducer(initial, { type: 'backgroundPanelSet', pageId: null })).toBe(initial);
  });
});
