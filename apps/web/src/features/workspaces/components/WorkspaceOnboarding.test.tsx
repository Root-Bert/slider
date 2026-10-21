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

/** The section headings in DOM order – the order focus and screen readers follow. */
function sectionOrder(pendingInvites: unknown[], domainWorkspace: unknown = null) {
  account.pendingInvites = pendingInvites;
  account.domainWorkspace = domainWorkspace;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <WorkspaceOnboarding />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen
    .getAllByRole('heading')
    .map((heading) => heading.textContent)
    .filter((text) => text && /Organisation |Firma/.test(text));
}

describe('WorkspaceOnboarding', () => {
  it('without an invite, "erstellen" comes first in the DOM, not only visually', () => {
    expect(sectionOrder([])).toEqual(['Organisation erstellen', 'Organisation beitreten']);
  });

  it('invited, "beitreten" comes first', () => {
    expect(sectionOrder([invite])).toEqual(['Organisation beitreten', 'Organisation erstellen']);
  });

  it('the company of the domain is already there: joining it comes first (BER-148)', () => {
    const company = { id: 'C', name: 'Firma', logoUrl: null, domain: 'firma.de', memberCount: 4 };
    expect(sectionOrder([], company)).toEqual([
      'Deiner Firma beitreten',
      'Eigene Organisation erstellen',
      'Organisation beitreten',
    ]);
    expect(screen.getByText('@firma.de | 4 Mitglieder')).toBeTruthy();
  });
});
