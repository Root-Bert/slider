import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNextcloudFlow } from './useNextcloudFlow';

const openPopup = () => {
  const popup = { close: vi.fn(), closed: false, opener: {}, location: { href: '' } };
  vi.stubGlobal(
    'open',
    vi.fn(() => popup),
  );
  return popup;
};

const flow = () =>
  renderHook(() =>
    useNextcloudFlow(
      () => new Promise<never>(() => {}),
      async () => ({ status: 'pending' as const }),
      () => {},
    ),
  );

describe('useNextcloudFlow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('"Abbrechen" closes the login popup', () => {
    const popup = openPopup();
    const { result } = flow();
    act(() => void result.current.connect());
    expect(result.current.state.status).toBe('waiting');
    act(() => result.current.cancel());
    expect(popup.close).toHaveBeenCalled();
    expect(result.current.state.status).toBe('idle');
  });

  it('closes the login popup when the page using it goes away', () => {
    const popup = openPopup();
    const { result, unmount } = flow();
    act(() => void result.current.connect());
    unmount();
    expect(popup.close).toHaveBeenCalled();
  });
});
