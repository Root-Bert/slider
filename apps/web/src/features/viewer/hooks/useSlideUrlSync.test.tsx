import { act, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLIDE_URL_SETTLE_MS, useSlideUrlSync } from './useSlideUrlSync';

// Lets the test drive the active slide from outside.
const control = { setActive: (_id: string) => undefined as void };
const setActive = (id: string) => control.setActive(id);

function Probe({ initial }: { initial: string }) {
  const [active, set] = useState(initial);
  useEffect(() => {
    control.setActive = set;
  }, []);
  useSlideUrlSync(active);
  return null;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const router = createMemoryRouter([{ path: '/d/:deckId', element: <Probe initial="s1" /> }], {
    initialEntries: ['/d/d1?slide=s1'],
  });
  const navigate = vi.spyOn(router, 'navigate');
  render(<RouterProvider router={router} />);
  return { router, navigate };
}

describe('useSlideUrlSync', () => {
  it('writes ?slide= once the active slide settles, not on every change while sweeping', async () => {
    const { router, navigate } = setup();
    for (let index = 2; index <= 150; index++) {
      act(() => setActive(`s${index}`));
      act(() => vi.advanceTimersByTime(16));
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(router.state.location.search).toBe('?slide=s1');

    await act(async () => vi.advanceTimersByTime(SLIDE_URL_SETTLE_MS));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toBe('?slide=s150');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('leaves the URL alone when it already names the active slide', async () => {
    const { navigate } = setup();
    await act(async () => vi.advanceTimersByTime(SLIDE_URL_SETTLE_MS * 2));
    expect(navigate).not.toHaveBeenCalled();
  });
});
