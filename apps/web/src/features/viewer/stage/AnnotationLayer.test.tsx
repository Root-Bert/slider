import { shapeRefForRect, type Point } from '@slider/shared';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationLayer } from './AnnotationLayer';
import { FrameOutline } from './FrameOutline';
import { author, comment, slide } from '../lib/test-fixtures';
import { boxAnchor, framedBoxesAnchor, toggleDraftBox } from './lib/box-anchor';
import { draftReducer } from '../state/draft-reducer';
import { buildThreads } from '../comments/lib/comment-selectors';

vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({
    viewer: { author: { id: 'a1', color: 'blue' } },
    deck: { id: 'd1' },
    canComment: true,
  }),
}));
vi.mock('../state/viewer-state', () => ({ useViewerDispatch: () => vi.fn() }));
vi.mock('../state/stage-registry', () => ({
  useStageRegistry: () => ({}),
  useMarkPreview: () => null,
}));
vi.mock('../comments/hooks/useAiThreads', () => ({ useAiThreads: () => ({ working: new Set() }) }));
vi.mock('./hooks/useSaveMark', () => ({ useSaveMark: () => vi.fn() }));
vi.mock('./hooks/useMarkMenu', () => ({ useMarkMenu: () => ({ contextMenu: null }) }));
vi.mock('./Pin', () => ({
  Pin: ({ at }: { at: Point }) => <button data-test-pin data-x={at.x} data-y={at.y} />,
}));
vi.mock('./DraftMark', () => ({
  DraftMark: ({ frame }: { frame: boolean }) => <span data-draft-frame={String(frame)} />,
}));
vi.mock('./TextBox', () => ({ TextMark: () => null }));
vi.mock('./EditableFrame', () => ({ EditableFrame: () => null }));

const shape = {
  id: 'shape',
  name: 'Object',
  text: '',
  bbox: { x: 0.2, y: 0.3, w: 0.3, h: 0.2 },
  rotation: 30,
  tilt: { x: 10, y: 20 },
};
const page = slide('s1', 0, { shapes: [shape] });
const root = comment({ anchor: boxAnchor(shape), author: author('other') });
const thread = buildThreads([root])[0]!;

describe('comment outlines on a layer plane', () => {
  it('keeps the focused object highlighted while still, and outlines a draft object without a duplicate frame', () => {
    const { container } = render(
      <AnnotationLayer
        slide={page}
        threads={[thread]}
        emphasisId={thread.id}
        draft={null}
        fadeDone={false}
        boxes
        still
      />,
    );
    const outline = container.querySelector<HTMLElement>('[data-shape-outline="emphasis"]');
    expect(outline).not.toBeNull();
    expect(outline?.style.transform).toContain('rotate(30deg)');
    expect(outline?.style.transform).toContain('rotateX(10deg) rotateY(20deg)');

    const draft = draftReducer(null, {
      type: 'anchorPlaced',
      slideId: 's1',
      anchor: boxAnchor(shape),
    });
    const drafted = render(
      <AnnotationLayer
        slide={page}
        threads={[]}
        emphasisId={null}
        draft={draft}
        fadeDone={false}
        boxes
        still
      />,
    );
    expect(drafted.container.querySelector('[data-shape-outline="target"]')).not.toBeNull();
    expect(drafted.container.querySelector('[data-draft-frame="false"]')).not.toBeNull();
    // A lit frame's halo lies only outside the box, never over the element (an ellipse touching
    // its box looked cut flat by it).
    const lit = render(
      <FrameOutline width={200} height={100} color="red" corners={[]} dome={false} halo />,
    ).container;
    const halo = lit.querySelector('[data-frame-halo]')!;
    const hole = lit.querySelector(
      `mask${halo.getAttribute('mask')!.slice(4, -1)} rect[fill="black"]`,
    );
    expect([hole?.getAttribute('width'), hole?.getAttribute('height')]).toEqual(['200', '100']);

    // ⇧/⌘-click on a second box: one comment on both – outlined both while written, framed both
    // once sent, and both light up when its thread is hovered. Clicked again it goes; the last stays.
    const other = {
      ...shape,
      id: 'other',
      name: 'Other',
      bbox: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 },
    };
    const both = slide('s1', 0, { shapes: [shape, other] });
    const twoBoxes = toggleDraftBox(draft, 's1', other)!;
    expect(twoBoxes).toMatchObject({
      shapeRef: { shapeId: 'shape' },
      more: [{ shapeRef: { shapeId: 'other' } }],
    });
    expect(toggleDraftBox(draft, 's2', other)).toBeNull();
    const twoDraft = draftReducer(draft, { type: 'anchorPlaced', slideId: 's1', anchor: twoBoxes });
    expect(toggleDraftBox(twoDraft, 's1', shape)).toEqual(boxAnchor(other));
    expect(toggleDraftBox(draft, 's1', shape)).toEqual(draft!.anchor);
    // A frame drawn round boxes: one comment on all it encloses, top left first; with ⇧/⌘ added
    // to the one being written (no box twice); round none it stays an area.
    expect(framedBoxesAnchor([shape, other], null, 's1', false)).toMatchObject({
      shapeRef: { shapeId: 'other' },
      more: [{ shapeRef: { shapeId: 'shape' } }],
    });
    expect(framedBoxesAnchor([other, shape], draft, 's1', true)).toMatchObject({
      shapeRef: { shapeId: 'shape' },
      more: [{ shapeRef: { shapeId: 'other' } }],
    });
    expect(framedBoxesAnchor([shape], draft, 's1', true)).toEqual(draft!.anchor);
    expect(framedBoxesAnchor([], draft, 's1', true)).toBeNull();
    const writing = render(
      <AnnotationLayer
        slide={both}
        threads={[]}
        emphasisId={null}
        draft={twoDraft}
        fadeDone={false}
        boxes
      />,
    );
    expect(writing.container.querySelectorAll('[data-shape-outline="target"]')).toHaveLength(2);
    const sent = buildThreads([comment({ anchor: twoBoxes, author: author('other') })])[0]!;
    const shown = render(
      <AnnotationLayer
        slide={both}
        threads={[sent]}
        emphasisId={sent.id}
        draft={null}
        fadeDone={false}
        boxes
      />,
    );
    const group = shown.container.querySelector(`div[data-hover-thread="${sent.id}"]`)!;
    expect(group.querySelectorAll('button[title]')).toHaveLength(2);
    expect(shown.container.querySelectorAll('[data-shape-outline="emphasis"]')).toHaveLength(2);
  });
});

describe('comment pin on a transformed object', () => {
  it('shares its frame transformation, whole or in part; an unbound area pin stays at its corner', () => {
    for (const whole of [true, false]) {
      const rect = whole ? shape.bbox : { x: 0.3, y: 0.35, w: 0.1, h: 0.1 };
      const root = comment({
        anchor: {
          type: 'rect',
          rect,
          shapeRef: shapeRefForRect(shape, rect),
        },
      });
      const threads = buildThreads([root]);
      const { container, unmount } = render(
        <AnnotationLayer
          slide={page}
          threads={threads}
          emphasisId={root.id}
          draft={null}
          fadeDone={false}
          boxes
          still
        />,
      );
      const frame = container.querySelector<HTMLElement>('[data-mark="frame"]')!;
      const pinBox = container.querySelector<HTMLElement>('[data-bound-pin]')!;
      expect(pinBox).not.toBeNull();
      expect(pinBox.style.transform).toBe(frame.style.transform);
      expect(pinBox.style.transform).toContain('rotate(30deg)');
      expect(pinBox.style.transform).toContain('rotateX(10deg) rotateY(20deg)');
      expect(Number.parseFloat(pinBox.style.left)).toBeCloseTo(rect.x * 100);
      expect(Number.parseFloat(pinBox.style.top)).toBeCloseTo(rect.y * 100);
      const pin = pinBox.querySelector<HTMLElement>('[data-test-pin]')!;
      expect(pin.dataset.x).toBe('0');
      expect(pin.dataset.y).toBe('0');
      unmount();
    }

    const rect = { x: 0.3, y: 0.35, w: 0.1, h: 0.1 };
    const root = comment({ anchor: { type: 'rect', rect, shapeRef: null } });
    const { container } = render(
      <AnnotationLayer
        slide={page}
        threads={buildThreads([root])}
        emphasisId={null}
        draft={null}
        fadeDone={false}
        still
      />,
    );
    expect(container.querySelector('[data-bound-pin]')).toBeNull();
    const pin = container.querySelector<HTMLElement>('[data-test-pin]')!;
    expect(pin.dataset.x).toBe(String(rect.x));
    expect(pin.dataset.y).toBe(String(rect.y));
  });
});
