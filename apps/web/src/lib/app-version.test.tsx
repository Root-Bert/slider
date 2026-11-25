import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdReload, newerVersion, reloadIfQuiet, sawVersion } from './app-version';

describe('app-version', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('takes a new release over quietly – only away from the window, idle, with nothing to lose', () => {
    // A checkout names no release: nothing to take over.
    sawVersion(null);
    expect(newerVersion()).toBeNull();
    sawVersion('1.6.15');
    expect(newerVersion()).toBeNull();
    const reload = vi.fn();
    expect(reloadIfQuiet(reload)).toBe(false);
    sawVersion('1.6.16');
    expect(newerVersion()).toBe('1.6.16');

    // In front, or just used: it waits.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.useFakeTimers({ now: Date.now() + 3 * 60_000 });
    expect(reloadIfQuiet(reload)).toBe(false);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    // A call, text half typed, an edit on its way: it waits too.
    const release = holdReload();
    expect(reloadIfQuiet(reload)).toBe(false);
    release();
    document.body.innerHTML = '<textarea>Hallo</textarea>';
    expect(reloadIfQuiet(reload)).toBe(false);
    document.body.innerHTML = '';
    const guard = (event: Event) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    expect(reloadIfQuiet(reload)).toBe(false);
    window.removeEventListener('beforeunload', guard);
    expect(reload).not.toHaveBeenCalled();

    // Away, idle, nothing to lose: reloaded.
    expect(reloadIfQuiet(reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
