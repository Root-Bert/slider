import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubStorage } from '@/test/storage';
import { installChunkReload } from './chunk-reload';

afterEach(() => vi.unstubAllGlobals());

function setup(start = 100_000) {
  stubStorage({}, 'sessionStorage');
  let listener: ((event: Event) => void) | undefined;
  const target = {
    addEventListener: (type: string, fn: (event: Event) => void) => {
      if (type === 'vite:preloadError') listener = fn;
    },
  } as unknown as Window;
  const reload = vi.fn();
  let time = start;
  installChunkReload(target, reload, () => time);
  const fire = () => {
    const event = { preventDefault: vi.fn() } as unknown as Event;
    listener!(event);
    return event;
  };
  return { reload, fire, advance: (ms: number) => (time += ms) };
}

describe('installChunkReload', () => {
  it('reloads when an old route chunk is gone after an update', () => {
    const { reload, fire } = setup();
    const event = fire();
    expect(reload).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not loop: a second failure right after the reload shows the error page', () => {
    const { reload, fire, advance } = setup();
    fire();
    advance(2_000);
    const again = fire();
    expect(reload).toHaveBeenCalledOnce();
    expect(again.preventDefault).not.toHaveBeenCalled();
    advance(60_000);
    fire();
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
