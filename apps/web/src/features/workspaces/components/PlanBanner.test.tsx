import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Workspace } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { billingFixture } from '@/test/workspace';
import { PlanBanner } from './PlanBanner';

const workspace = (patch: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  name: 'Agentur Nord',
  slug: 'agentur-nord',
  logoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'admin',
  memberCount: 2,
  plan: 'free',
  usage: {
    members: 2,
    seatsUsed: 2,
    maxMembers: 5,
    decks: 0,
    maxDecks: 3,
    storageBytes: 0,
    maxStorageBytes: null,
  },
  billing: billingFixture({ enabled: true, owner: { id: 'u1', name: 'Anna Berg' } }),
  locked: false,
  joinDomain: null,
  audiencePending: false,
  ...patch,
});

const show = (ws: Workspace, userId = 'u2') =>
  render(
    <MemoryRouter>
      <PlanBanner workspace={ws} userId={userId} />
    </MemoryRouter>,
  );

const usageLink = () => screen.getByRole('link', { name: 'Zur Nutzung' }).getAttribute('href');

describe('PlanBanner', () => {
  it('shows nothing while all is well', () => {
    show(workspace());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('over the plan’s limits: a warning to "Nutzung"', () => {
    show(workspace({ locked: true, role: 'member' }));
    expect(screen.getByRole('status').textContent).toContain('über dem Limit ihres Plans');
    expect(usageLink()).toBe('/nutzung?organisation=w1');
  });

  it('a pending fall-back to free reaches admins only', () => {
    const billing = billingFixture({
      enabled: true,
      downgradeAt: '2026-11-02T10:00:00.000Z',
      downgradeReason: 'payment_failed',
    });
    const { unmount } = show(workspace({ plan: 'paid', billing }));
    expect(screen.getByRole('status').textContent).toContain(
      'Wechselt am 2. November 2026 auf Free',
    );
    unmount();

    show(workspace({ plan: 'paid', billing, role: 'member' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks the admin the billing owner picked to take over paying', () => {
    show(
      workspace({
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          transfer: { to: { id: 'u2', name: 'Ben' }, requestedAt: '2026-10-18T10:00:00.000Z' },
        }),
      }),
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Anna Berg bittet dich, die Zahlung zu übernehmen.',
    );
    expect(usageLink()).toBe('/nutzung?organisation=w1');
  });
});
