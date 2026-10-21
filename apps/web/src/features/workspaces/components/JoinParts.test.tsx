import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { JoinButton } from './JoinParts';

const api = vi.hoisted(() => ({ join: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useJoinWorkspace: () => ({ mutate: api.join, isPending: false, error: null }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
  useAuthProviders: () => ({ isPending: true }),
}));
vi.mock('@/features/auth', () => ({ LoginOptions: () => null }));

describe('JoinButton', () => {
  it('auto: joins right away, once – no question after following an invitation (BER-148)', () => {
    const { rerender } = render(
      <MemoryRouter>
        <JoinButton token="t" auto />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <JoinButton token="t" auto />
      </MemoryRouter>,
    );
    expect(api.join).toHaveBeenCalledOnce();
  });

  it('without auto it waits for the button', () => {
    api.join.mockReset();
    render(
      <MemoryRouter>
        <JoinButton token="t" />
      </MemoryRouter>,
    );
    expect(api.join).not.toHaveBeenCalled();
  });
});
