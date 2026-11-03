import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFrameSize } from './useFrameSize';

const geometry = vi.hoisted(() => ({ scale: 1, running: false }));
vi.mock('../../editing/layers/seen-on-plane', () => ({
  seenCorners: () => [
    { x: 0, y: 0 },
    { x: 100 * geometry.scale, y: 0 },
    { x: 100 * geometry.scale, y: 100 * geometry.scale },
    { x: 0, y: 100 * geometry.scale },
  ],
}));
let callbacks: Map<number, FrameRequestCallback>;
function Fixture() {
  const ref = useRef<HTMLDivElement>(null);
  const size = useFrameSize(ref, true);
  return (
    <div
      data-plane
      ref={(node) => {
        if (node)
          node.getAnimations = () =>
            geometry.running ? [{ playState: 'running', pending: false } as Animation] : [];
      }}
    >
      <div ref={ref} data-scale={size?.scale} />
    </div>
  );
}
function frame() {
  act(() => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(0));
  });
}
beforeEach(() => {
  geometry.scale = 1;
  geometry.running = false;
  callbacks = new Map();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = next++;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('frame measurement on a layer plane', () => {
  it('follows transforms and CSS easing, polling only while they run', async () => {
    const { container } = render(<Fixture />);
    frame();
    // Idle: no polling on every frame.
    expect(callbacks.size).toBe(0);
    geometry.scale = 2;
    geometry.running = true;
    await act(async () => {
      container.querySelector<HTMLElement>('[data-plane]')!.style.transform = 'scale(2)';
    });
    expect(callbacks.size).toBe(1);
    frame();
    expect(container.querySelector('[data-scale]')?.getAttribute('data-scale')).toBe('2');
    expect(callbacks.size).toBe(1);
    geometry.running = false;
    frame();
    expect(callbacks.size).toBe(0);
  });
});
