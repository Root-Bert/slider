import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createStageRegistry, StageRegistryContext } from '../../state/stage-registry';
import { useConnectorLayout, type ConnectorRoute } from './useConnectorLayout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reads cards once per measurement and keeps mask nodes and routes while scrolling', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let mutation!: (records: { target: Node }[]) => void;
  let resize!: () => void;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: typeof mutation) {
        mutation = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: typeof resize) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const wrapper = document.createElement('div');
  const ids = Array.from({ length: 13 }, (_, index) => `t${index}`);
  wrapper.innerHTML = `<div data-timeline><div data-layer></div>
    <div data-timeline-header data-connector-occluder></div>
    <div data-slide-frame="s1"><div data-slide-box="s1">
      <span data-mark="pin"><i data-dot></i></span>
    </div></div><div data-gap-key="g1"></div>
    <section data-comment-area><div data-column="s1" data-mode="full"><ul>
    ${ids.map((id) => `<li data-brick="${id}" data-band="0"><article data-comment-card="${id}"></article></li>`).join('')}
    </ul></div></section><div data-connector-ignore></div></div>`;
  document.body.appendChild(wrapper);
  const element = <T extends Element = HTMLElement>(selector: string) =>
    wrapper.querySelector<T>(selector)!;
  const scroller = element('[data-timeline]');
  const layer = element('[data-layer]');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = `<defs><mask><g data-connector-cutouts /></mask></defs>${ids.map((id) => `<path data-connector-id="${id}"/>`).join('')}`;
  layer.appendChild(svg);
  const box = (selector: string, x: number, y: number, w: number, h: number, scroll = false) =>
    vi
      .spyOn(element(selector), 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(x, y - (scroll ? scroller.scrollTop : 0), w, h));
  box('[data-timeline]', 0, 0, 1000, 800);
  box('[data-layer]', 0, 0, 1000, 0);
  box('[data-timeline-header]', 0, 0, 1000, 360);
  box('[data-slide-frame]', 40, 10, 600, 337);
  box('[data-slide-box]', 40, 10, 600, 337);
  box('[data-gap-key]', 640, 10, 80, 337);
  box('[data-column]', 40, 420, 600, 450, true);
  box('[data-dot]', 154, 104, 14, 14);
  const cards = ids.map((id, index) => {
    const x = 40 + (index % 3) * 200;
    const y = 440 + Math.floor(index / 3) * 80;
    box(`[data-brick="${id}"]`, x, y, 180, 64, true);
    return box(`[data-comment-card="${id}"]`, x, y, 180, 64, true);
  });
  const registry = createStageRegistry();
  registry.setScroller(scroller);
  const routes: ConnectorRoute[] = [
    {
      slideId: 's1',
      prevGapKey: null,
      nextGapKey: 'g1',
      items: ids.map((threadId) => ({
        threadId,
        color: 'red',
        source: {
          kind: 'mark',
          exit: 'left',
          anchor: {
            left: 0.2,
            right: 0.2,
            start: { left: { x: 0.2, y: 0.3 }, right: { x: 0.2, y: 0.3 } },
            bottom: { x: 0.2, y: 0.3 },
            inset: { left: 7, right: 7, bottom: 7 },
          },
        },
      })),
    },
  ];
  const runFrame = async () =>
    act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  const { result, rerender, unmount } = renderHook(
    ({ currentRoutes }) => useConnectorLayout({ layer, svg, routes: currentRoutes, enabled: true }),
    {
      initialProps: { currentRoutes: routes },
      wrapper: ({ children }) => (
        <StageRegistryContext value={registry}>{children}</StageRegistryContext>
      ),
    },
  );
  try {
    await runFrame();
    expect(result.current).toHaveLength(13);
    expect(cards.every((read) => read.mock.calls.length === 1)).toBe(true);
    const group = svg.querySelector('[data-connector-cutouts]')!;
    const nodes = [...group.children];
    expect(nodes).toHaveLength(14);
    const path = svg.querySelector('path[data-connector-id]')!;
    const before = path.getAttribute('d');
    expect(before).toMatch(/^M/);
    expect(before).not.toMatch(/NaN|Infinity/);
    cards.forEach((read) => read.mockClear());
    await act(async () => {
      mutation([{ target: element('[data-slide-box]') }]);
      resize();
      mutation([{ target: element('[data-column]') }]);
    });
    // The three current scheduling callbacks keep their timing, each with one read per card.
    expect(cards.every((read) => read.mock.calls.length === 3)).toBe(true);
    expect([...group.children]).toEqual(nodes);
    expect(frames.size).toBe(0);

    // Vertical scrolling changes path/mask coordinates before this frame's paint.
    scroller.scrollTop = 20;
    scroller.dispatchEvent(new Event('scroll'));
    await runFrame();
    expect(path.getAttribute('d')).not.toBe(before);
    expect(group.firstElementChild).toBe(nodes[0]);
    expect(nodes[0]!.getAttribute('y')).toBe('420');
    expect([...group.children]).toEqual(nodes);
    cards.forEach((read) => read.mockClear());
    await act(async () => {
      mutation([{ target: group }]);
      mutation([{ target: element('[data-connector-ignore]') }]);
      scroller.scrollLeft = 50;
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(frames.size).toBe(0);
    expect(cards.every((read) => read.mock.calls.length === 0)).toBe(true);

    rerender({ currentRoutes: [] });
    await runFrame();
    expect(result.current).toHaveLength(0);
    expect(group.children).toHaveLength(0);
  } finally {
    unmount();
    wrapper.remove();
  }
});
