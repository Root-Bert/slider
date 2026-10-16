import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTypingTarget, rafThrottle } from './dom';

afterEach(() => vi.unstubAllGlobals());

describe('isTypingTarget', () => {
  class FakeElement {
    constructor(
      readonly tagName: string,
      readonly isContentEditable = false,
    ) {}
  }

  it('is true for fields and editable content only', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    expect(isTypingTarget(new FakeElement('INPUT') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement('TEXTAREA') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement('SELECT') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement('DIV', true) as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement('BUTTON') as unknown as EventTarget)).toBe(false);
  });

  it('is false for null and non-elements', () => {
    vi.stubGlobal('HTMLElement', FakeElement);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe('rafThrottle', () => {
  const stubFrames = () => {
    const frames = new Map<number, () => void>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      next += 1;
      frames.set(next, callback);
      return next;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flush = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    };
    return { frames, flush };
  };

  it('runs at most once per frame', () => {
    const { frames, flush } = stubFrames();
    const callback = vi.fn();
    const throttled = rafThrottle(callback);
    throttled.schedule();
    throttled.schedule();
    expect(frames.size).toBe(1);
    flush();
    expect(callback).toHaveBeenCalledTimes(1);
    throttled.schedule();
    flush();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('cancels a scheduled call', () => {
    const { flush } = stubFrames();
    const callback = vi.fn();
    const throttled = rafThrottle(callback);
    throttled.schedule();
    throttled.cancel();
    flush();
    expect(callback).not.toHaveBeenCalled();
    throttled.schedule();
    flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
