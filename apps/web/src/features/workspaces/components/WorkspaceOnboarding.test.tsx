import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceOnboarding } from './WorkspaceOnboarding';

const account = vi.hoisted(() => ({
  pendingInvites: [] as unknown[],
  domainWorkspace: null as unknown,
}));

vi.mock('@/features/auth', () => ({
  useAccount: () => ({
    user: { id: 'u1', name: 'Anna Berg' },
    pendingInvites: account.pendingInvites,
    domainWorkspace: account.domainWorkspace,
    canCreateWorkspace: true,
  }),
}));
vi.mock('@/shell/AppHeader', () => ({ AppHeader: () => null }));

const invite = {
  id: 'i1',
  workspaceId: 'B',
  workspaceName: 'Beta',
  inviterName: null,
  role: 'member',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  deck: null,
};

function renderOnboarding(pendingInvites: unknown[], domainWorkspace: unknown = null) {
  account.pendingInvites = pendingInvites;
  account.domainWorkspace = domainWorkspace;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <WorkspaceOnboarding />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Headings and buttons in DOM order – the order focus and screen readers follow. */
const order = () =>
  [...document.querySelectorAll('h1, h2, h3, button')]
    .map((element) => element.textContent?.trim())
    .filter((text) => text && /Organisation|Beitreten|Einladungslink/.test(text));

const company = { id: 'C', name: 'Firma', logoUrl: null, domain: 'firma.de', memberCount: 4 };

describe('WorkspaceOnboarding', () => {
  it('nothing to join: founding is the page, the invitation link second', () => {
    renderOnboarding([]);
    expect(order()).toEqual([
      'Organisation erstellen',
      'Organisation erstellen',
      'Mit Einladungslink beitreten',
      'Beitreten',
    ]);
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('invited: a quiet "erstellen" first, then the invitation as a card', () => {
    renderOnboarding([invite]);
    expect(order()).toEqual([
      'Eigene Organisation erstellen',
      'Beitreten',
      'Mit Einladungslink beitreten',
      'Beitreten',
      // The founding dialog, closed.
      'Neue Organisation',
    ]);
    const cards = screen.getByRole('list', { name: 'Organisationen zum Beitreten' });
    expect(cards.textContent).toContain('Beta');
    // Founding opens a dialog – no form on the page.
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('the company of the domain is already there: its card before invitations (BER-148)', () => {
    renderOnboarding([invite], company);
    const cards = screen.getByRole('list', { name: 'Organisationen zum Beitreten' });
    expect([...cards.children].map((card) => card.textContent)).toEqual([
      expect.stringContaining('Firma'),
      expect.stringContaining('Beta'),
    ]);
    expect(screen.getByText('@firma.de | 4 Mitglieder an Bord')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Einsteigen' })).toBeTruthy();
  });
});
