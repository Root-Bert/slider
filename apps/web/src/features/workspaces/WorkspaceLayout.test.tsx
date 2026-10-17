import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Component as WorkspaceLayout } from './WorkspaceLayout';

vi.mock('@/features/auth', () => ({
  useAccount: () => ({
    workspaces: [
      { id: 'A', name: 'Alpha' },
      { id: 'B', name: 'Beta' },
    ],
  }),
}));

/** Stands in for the reviews page: state like a running bulk re-render, search or tab. */
function Page() {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" onClick={() => setBusy(true)}>
      {busy ? 'Wird gerendert' : 'Neu rendern'}
    </button>
  );
}

describe('WorkspaceLayout', () => {
  it('switching the organisation starts its pages fresh, without the previous one’s state', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/w/:workspaceId',
          element: <WorkspaceLayout />,
          children: [{ index: true, element: <Page /> }],
        },
      ],
      { initialEntries: ['/w/A'] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neu rendern' }));
    expect(screen.getByRole('button').textContent).toBe('Wird gerendert');

    await act(() => router.navigate('/w/B'));
    expect(screen.getByRole('button').textContent).toBe('Neu rendern');
  });
});
