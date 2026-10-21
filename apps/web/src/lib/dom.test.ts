import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterCommit, commitPending, isTypingTarget, rafThrottle } from './dom';

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

describe('afterCommit', () => {
  it('runs every job’s reads before any writes, once, after the current task', async () => {
    const log: string[] = [];
    afterCommit(() => {
      log.push('read a');
      return () => log.push('write a');
    });
    afterCommit(() => {
      log.push('read b');
      return () => log.push('write b');
    });
    afterCommit(() => void log.push('read only'));
    expect(commitPending()).toBe(true);
    expect(log).toEqual([]);
    await Promise.resolve();
    expect(log).toEqual(['read a', 'read b', 'read only', 'write a', 'write b']);
    expect(commitPending()).toBe(false);
  });
});
