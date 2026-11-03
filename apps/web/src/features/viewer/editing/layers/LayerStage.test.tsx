import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableElement, Shape } from '@slider/shared';
import { LayerStage } from './LayerStage';
import type * as LayersModule from './layers-context';
import { useStartComment } from '../../hooks/useStartComment';

const mocks = vi.hoisted(() => ({
  elements: [] as EditableElement[],
  active: false,
  hovered: null as { slideId: string; elementId: string } | null,
  setHovered: vi.fn(),
  hoveredBox: null as { slideId: string; shape: Shape } | null,
  dispatch: vi.fn(),
  onComment: vi.fn(),
  select: vi.fn(),
  startText: vi.fn(),
  selection: null as { slideId: string; elementId: string } | null,
  textEditing: null as string | null,
  pick: vi.fn(),
  liveViews: [] as { textOnly?: boolean }[],
}));

vi.mock('../editing-context', () => ({
  useEditing: () => ({
    active: mocks.active,
    elementsOf: () => mocks.elements,
    pageSize: { width: 16, height: 9 },
    select: mocks.select,
    selection: mocks.selection,
    textEditing: mocks.textEditing,
    open: vi.fn(),
    startText: mocks.startText,
    setActive: vi.fn(),
  }),
}));
vi.mock('./layers-context', async (original) => ({
  ...(await original<typeof LayersModule>()),
  useLayers: () => ({
    orderOf: () => mocks.elements.map((element) => element.id),
    viewOf: () => ({ pitch: 0, yaw: 0 }),
    spread: 0,
    setSpread: vi.fn(),
    hovered: mocks.hovered,
    setHovered: mocks.setHovered,
    pick: mocks.pick,
  }),
}));
vi.mock('./useLayerPictures', () => ({
  useLayerPictures: () => ({
    pictures: new Map(),
    background: '/background.png',
  }),
}));
vi.mock('../../state/stage-registry', () => ({ useStageRegistry: () => registry }));
vi.mock('../../state/viewer-data', () => ({
  useViewerData: () => ({
    slides: [{ id: 's1' }],
    canComment: true,
  }),
}));
vi.mock('../../state/viewer-state', () => ({
  useViewerDispatch: () => mocks.dispatch,
  useViewerState: () => ({ activeSlideId: 's1', boxMode: true }),
  isBoxModeActive: () => true,
}));
vi.mock('../../comments/lib/composer-focus', () => ({ focusCommentField: vi.fn() }));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => vi.fn() }));
vi.mock('../../connectors/hooks/useConnectorLayout', () => ({ followConnectors: vi.fn() }));
vi.mock('../tilt/useTilt', () => ({ useTiltElement: () => vi.fn() }));
vi.mock('../live/InlineTextEditor', () => ({ InlineTextEditor: () => null }));
vi.mock('../live/render', () => ({
  LiveElementView: (props: { textOnly?: boolean }) => {
    mocks.liveViews.push(props);
    return null;
  },
}));
vi.mock('../../stage/EditableFrame', () => ({ EditableFrame: () => null }));
vi.mock('../../stage/hooks/useFrameSize', () => ({ useFrameSize: () => null }));

const registry = {
  setHoveredBox: (slideId: string, shape: Shape | null) => {
    if (shape) mocks.hoveredBox = { slideId, shape };
    else if (mocks.hoveredBox?.slideId === slideId) mocks.hoveredBox = null;
  },
  getHoveredBox: () => mocks.hoveredBox,
};

const shape: Shape = {
  id: 'element',
  name: 'Rotated box',
  text: '',
  bbox: { x: 0.3, y: 0.4, w: 0.4, h: 0.1 },
  rotation: 90,
};
const element: EditableElement = {
  ...shape,
  kind: 'shape',
  role: null,
  rotation: 90,
  paragraphs: null,
  movable: true,
  resizable: true,
  live: null,
  tilt: null,
  flip: null,
  credit: null,
  look: null,
};

function Scene({ boxes = true, slideId = 's1' }: { boxes?: boolean; slideId?: string }) {
  const comment = useStartComment();
  return (
    <>
      <button onClick={() => comment({ onHoveredBox: true })}>C</button>
      <LayerStage
        slideId={slideId}
        active
        src="/slide.png"
        w={1000}
        h={562.5}
        color="blue"
        boxes={boxes}
        onComment={mocks.onComment}
        onCommentArea={vi.fn()}
        onEdit={vi.fn()}
        marks={{ threads: [], shapes: [shape], draft: null, render: () => null }}
      />
    </>
  );
}

async function move(stage: Element, x: number, y: number, pointerType = 'mouse') {
  await act(async () => {
    fireEvent.pointerMove(stage, { clientX: x * 1000, clientY: y * 1000, pointerType });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

beforeEach(() => {
  mocks.elements = [element];
  mocks.active = false;
  mocks.hovered = null;
  mocks.hoveredBox = null;
  mocks.setHovered.mockReset();
  mocks.dispatch.mockReset();
  mocks.onComment.mockReset();
  mocks.select.mockReset();
  mocks.pick.mockReset();
  mocks.liveViews = [];
  // Project the plane's corner markers onto a known screen rectangle. Rotation/tilt of the
  // element itself is deliberately left to production hit testing, as in the real DOM.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const corner = this.getAttribute('data-plane-corner');
    const plane = this.parentElement;
    const [x, y, w, h] = (plane?.dataset.box ?? '0 0 1 1').split(' ').map(Number);
    const index = Number(corner);
    return new DOMRect(
      (x! + (index === 1 || index === 2 ? w! : 0)) * 1000,
      (y! + (index === 2 || index === 3 ? h! : 0)) * 1000,
      0,
      0,
    );
  });
});
afterEach(() => vi.restoreAllMocks());

describe('layer hover and comment target', () => {
  it('uses the visible rotated box for hover, click and C – editing, for a double click', async () => {
    const { container, getByText, unmount } = render(<Scene />);
    const stage = container.querySelector('[data-layer-stage]')!;
    await move(stage, 0.5, 0.25);
    expect(mocks.setHovered).toHaveBeenLastCalledWith('s1', 'element');
    expect(mocks.hoveredBox?.shape.id).toBe('element');
    fireEvent.click(getByText('C'));
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'anchorPlaced',
        anchor: expect.objectContaining({
          type: 'rect',
          shapeRef: expect.objectContaining({ shapeId: 'element' }),
        }),
      }),
    );
    fireEvent.pointerDown(stage, { clientX: 500, clientY: 250, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 250, button: 0, pointerType: 'touch' });
    expect(mocks.onComment).toHaveBeenCalledWith(expect.anything(), 'element', false);
    // ⇧ and a click (no turn): the comment being written takes this box too.
    fireEvent.pointerDown(stage, { clientX: 500, clientY: 250, button: 0, shiftKey: true });
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 250, button: 0, shiftKey: true });
    expect(mocks.onComment).toHaveBeenLastCalledWith(expect.anything(), 'element', true);
    await move(stage, 0.31, 0.45);
    expect(mocks.hoveredBox).toBeNull();
    unmount();

    // Editing: a double click picks the layer – also when its first click began typing in it.
    mocks.active = true;
    const edited = render(<Scene />);
    const editing = edited.container.querySelector('[data-layer-stage]')!;
    // The text a click begins typing in, on the stage (the editor itself is mocked here).
    const text = editing.appendChild(document.createElement('p'));
    text.setAttribute('contenteditable', 'true');
    const at = { clientX: 500, clientY: 250, button: 0 };
    fireEvent.doubleClick(text, at);
    // Typed in before: a double click marks a word, nothing picked.
    expect(mocks.pick).not.toHaveBeenCalled();
    fireEvent.pointerDown(editing, at);
    fireEvent.pointerUp(editing, at);
    expect(mocks.select).toHaveBeenLastCalledWith({ slideId: 's1', elementId: 'element' });
    // The second click lands in that text: still a double click on the element – picked, its list opens.
    fireEvent.doubleClick(text, at);
    expect(mocks.select).toHaveBeenLastCalledWith(null);
    expect(mocks.pick).toHaveBeenCalledWith('s1', 'element', false);

    // A text's first click only picks it – Tab then steps its panel's kinds –; clicked again
    // once picked, it is typed in where it was clicked.
    mocks.elements = [
      { ...element, live: { fill: null, stroke: null } } as unknown as EditableElement,
    ];
    mocks.select.mockClear();
    edited.rerender(<Scene />);
    fireEvent.pointerDown(editing, at);
    fireEvent.pointerUp(editing, at);
    expect(mocks.select).toHaveBeenLastCalledWith({ slideId: 's1', elementId: 'element' });
    expect(mocks.startText).not.toHaveBeenCalled();
    mocks.selection = { slideId: 's1', elementId: 'element' };
    edited.rerender(<Scene />);
    fireEvent.pointerDown(editing, at);
    fireEvent.pointerUp(editing, at);
    expect(mocks.startText).toHaveBeenCalledWith(mocks.selection, { x: 500, y: 250 });
    mocks.selection = null;
    // Typing in another text: the first click types on here at once.
    mocks.startText.mockClear();
    mocks.textEditing = 'other';
    edited.rerender(<Scene />);
    fireEvent.pointerDown(editing, at);
    fireEvent.pointerUp(editing, at);
    expect(mocks.startText).toHaveBeenCalledWith(
      { slideId: 's1', elementId: 'element' },
      { x: 500, y: 250 },
    );
    mocks.textEditing = null;
  });

  it('clears the C target when leaving, disabling boxes, editing or unmounting, and never hovers by touch', async () => {
    const { container, rerender, unmount } = render(<Scene />);
    const stage = container.querySelector('[data-layer-stage]')!;
    await move(stage, 0.5, 0.25);
    fireEvent.pointerLeave(stage);
    expect(mocks.hoveredBox).toBeNull();
    await move(stage, 0.5, 0.25);
    rerender(<Scene boxes={false} />);
    expect(mocks.hoveredBox).toBeNull();
    rerender(<Scene />);
    expect(mocks.hoveredBox?.shape.id).toBe('element');
    mocks.active = true;
    rerender(<Scene />);
    expect(mocks.hoveredBox).toBeNull();
    mocks.active = false;
    rerender(<Scene />);
    unmount();
    expect(mocks.hoveredBox).toBeNull();

    mocks.setHovered.mockReset();
    const touch = render(<Scene />);
    await move(touch.container.querySelector('[data-layer-stage]')!, 0.5, 0.25, 'touch');
    expect(mocks.hoveredBox).toBeNull();
    expect(mocks.setHovered).not.toHaveBeenCalled();
  });

  it('hits only the visible part of a tilted box and outlines the hovered element of its own slide', async () => {
    mocks.elements = [{ ...element, rotation: 0, tilt: { x: 0, y: 70 } }];
    const tilted = render(<Scene />);
    const stage = tilted.container.querySelector('[data-layer-stage]')!;
    await move(stage, 0.31, 0.45);
    expect(mocks.hoveredBox).toBeNull();
    await move(stage, 0.5, 0.45);
    expect(mocks.hoveredBox?.shape.id).toBe('element');
    tilted.unmount();

    mocks.elements = [element];
    mocks.hovered = { slideId: 'other-slide', elementId: element.id };
    const { container, rerender } = render(<Scene />);
    expect(container.querySelector('[data-shape-outline]')).toBeNull();
    mocks.hovered = { slideId: 's1', elementId: element.id };
    rerender(<Scene />);
    const outline = container.querySelector<HTMLElement>('[data-shape-outline="target"]');
    expect(outline?.style.transform).toBe('rotate(90deg)');
    rerender(<></>);

    // Typed in on its plane, a shape the browser cannot draw whole: its box filled and outlined
    // under its text.
    const live = { ...element, rotation: 0, live: { fill: '#dde8ff', stroke: null } };
    mocks.elements = [live as unknown as EditableElement];
    mocks.textEditing = element.id;
    const typed = render(<Scene />);
    expect(mocks.liveViews.at(-1)?.textOnly).toBe(false);
    typed.unmount();
    // One it draws whole (`paint`): drawn so on its plane at rest too (an edit shows at once), as
    // on the flat slide – its outline, the text over it.
    mocks.textEditing = null;
    mocks.liveViews = [];
    mocks.elements = [
      { ...live, paint: { outline: 'ellipse', radius: 0 } } as unknown as EditableElement,
    ];
    const painted = render(<Scene />);
    expect(painted.container.querySelector('[data-live-host] svg')).not.toBeNull();
    expect(mocks.liveViews.length).toBeGreaterThan(0);
    expect(mocks.liveViews.every((view) => view.textOnly)).toBe(true);
  });
});
