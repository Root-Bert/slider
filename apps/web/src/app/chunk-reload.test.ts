import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { installChunkReload, isModuleLoadError } from './chunk-reload';

afterEach(() => vi.unstubAllGlobals());

function setup(start = 100_000, broken = false) {
  if (broken) stubBrokenStorage('sessionStorage');
  else stubStorage({}, 'sessionStorage');
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
  it('reloads once when an old route chunk is gone, without looping or a stored guard', () => {
    const { reload, fire, advance } = setup();
    const event = fire();
    expect(reload).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
    // A second failure right after the reload shows the error page.
    advance(2_000);
    const again = fire();
    expect(reload).toHaveBeenCalledOnce();
    expect(again.preventDefault).not.toHaveBeenCalled();
    advance(60_000);
    fire();
    expect(reload).toHaveBeenCalledTimes(2);

    // A tab that cannot store the guard leaves it to the error page.
    const broken = setup(100_000, true);
    expect(broken.fire().preventDefault).not.toHaveBeenCalled();
    expect(broken.reload).not.toHaveBeenCalled();
  });
});

describe('isModuleLoadError', () => {
  it('tells a page module the browser could not load', () => {
    expect(isModuleLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(
      isModuleLoadError(new TypeError('Failed to fetch dynamically imported module: /x.js')),
    ).toBe(true);
    expect(isModuleLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isModuleLoadError(new Error('Importing a module script failed.'))).toBe(false);
  });
});
