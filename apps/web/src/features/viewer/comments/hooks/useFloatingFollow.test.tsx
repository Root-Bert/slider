import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingFollow } from './useFloatingFollow';

function Floating({ at }: { at: { left: number; top: number } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useFloatingFollow(ref, at);
  return <div ref={ref} data-testid="popover" />;
}

describe('useFloatingFollow', () => {
  let now = 0;
  let frames: FrameRequestCallback[] = [];
  const nextFrame = (ms: number) => {
    now += ms;
    const due = frames;
    frames = [];
    act(() => due.forEach((callback) => callback(now)));
  };

  beforeEach(() => {
    now = 0;
    frames = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('snaps into its first place', () => {
    const { getByTestId } = render(<Floating at={{ left: 10, top: 20 }} />);
    expect(getByTestId('popover').style.translate).toBe('');
    expect(frames).toHaveLength(0);
  });

  it('stays where it was when the mark moves, then floats after it until it rests', () => {
    const view = render(<Floating at={{ left: 10, top: 20 }} />);
    view.rerender(<Floating at={{ left: 110, top: 20 }} />);
    const popover = view.getByTestId('popover');
    expect(popover.style.translate).toBe('-100px 0px');

    nextFrame(50);
    const x = Number.parseFloat(popover.style.translate);
    expect(x).toBeGreaterThan(-100);
    expect(x).toBeLessThan(-30);

    for (let i = 0; i < 40 && frames.length > 0; i++) nextFrame(16);
    expect(popover.style.translate).toBe('');
    expect(frames).toHaveLength(0);
  });
});
