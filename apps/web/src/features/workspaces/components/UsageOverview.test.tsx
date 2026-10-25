import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceMember, WorkspaceRole, WorkspaceUsageDetails } from '@slider/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingFixture } from '@/test/workspace';
import { UsageOverview } from './UsageOverview';

const GB = 1024 ** 3;

const api = vi.hoisted(() => ({
  checkout: vi.fn(),
  portal: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  accept: vi.fn(),
  reset: vi.fn(),
  members: [] as WorkspaceMember[],
}));

const mutation = (mutate: (...args: unknown[]) => void) => ({
  mutate,
  reset: api.reset,
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  data: undefined,
});

vi.mock('@/lib/api', () => ({
  useStartCheckout: () => mutation(api.checkout),
  useOpenBillingPortal: () => mutation(api.portal),
  useRequestBillingTransfer: () => mutation(api.request),
  useCancelBillingTransfer: () => mutation(api.cancel),
  useAcceptBillingTransfer: () => mutation(api.accept),
  useMembers: () => ({ isSuccess: true, data: api.members }),
}));

const details = (patch: Partial<WorkspaceUsageDetails> = {}): WorkspaceUsageDetails => ({
  workspaceId: 'w1',
  plan: 'free',
  usage: {
    members: 3,
    seatsUsed: 3,
    maxMembers: 5,
    decks: 2,
    maxDecks: 3,
    storageBytes: 1.2 * GB,
    maxStorageBytes: 2 * GB,
  },
  storage: {
    originals: 0.5 * GB,
    slideImages: 0.4 * GB,
    images: 0,
    videos: 0.2 * GB,
    audio: 0.1 * GB,
    other: 0,
  },
  billing: billingFixture({
    enabled: true,
    owner: { id: 'u1', name: 'Anna Berg' },
    isOwner: true,
  }),
  locked: false,
  ...patch,
});

const member = (userId: string, name: string, role: WorkspaceMember['role']): WorkspaceMember => ({
  userId,
  name,
  email: `${userId}@firma.de`,
  color: 'blue',
  role,
  isCreator: false,
  joinedAt: '2026-01-01T00:00:00.000Z',
});

const show = (
  data: WorkspaceUsageDetails,
  { userId = 'u1', role = 'admin' }: { userId?: string; role?: WorkspaceRole } = {},
) =>
  render(
    <UsageOverview
      workspace={{ id: 'w1', role }}
      details={data}
      userId={userId}
      onNotify={vi.fn()}
    />,
  );

const assign = vi.fn();

beforeEach(() => {
  for (const fn of [api.checkout, api.portal, api.request, api.cancel, api.accept]) fn.mockReset();
  api.members = [];
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => vi.unstubAllGlobals());

describe('UsageOverview', () => {
  it('free: the plan, people, reviews and storage split by kind, and "Upgraden" for the owner', async () => {
    api.checkout.mockImplementation((_: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ url: 'https://checkout.stripe.com/c/1' }),
    );
    show(details());

    expect(screen.getByText('Free-Plan')).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Personen' }).getAttribute('aria-valuetext')).toBe(
      '3/5',
    );
    expect(screen.getByRole('meter', { name: 'Reviews' }).getAttribute('aria-valuetext')).toBe(
      '2/3',
    );
    expect(screen.getByText('1,2 GB von 2 GB')).toBeTruthy();
    const legend = screen.getByRole('list', { name: 'Speicher nach Art' });
    expect(within(legend).getByText('Originaldateien')).toBeTruthy();
    expect(within(legend).getByText('Sprachaufnahmen')).toBeTruthy();
    // Nothing stored of a kind: not in the legend.
    expect(within(legend).queryByText('Bilder')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Upgraden' }));
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/1');
  });

  it('back from Stripe out of the back/forward cache: the button is no longer busy', () => {
    show(details());
    api.reset.mockClear();
    window.dispatchEvent(new Event('pageshow'));
    expect(api.reset).not.toHaveBeenCalled();
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(api.reset).toHaveBeenCalled();
  });

  it('paid: the renewal date, "Zahlung verwalten" for the owner', async () => {
    api.portal.mockImplementation((_: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ url: 'https://billing.stripe.com/p/1' }),
    );
    show(
      details({
        plan: 'paid',
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          isOwner: true,
          status: 'active',
          renewsAt: '2026-11-19T10:00:00.000Z',
        }),
      }),
    );

    expect(screen.getByText('Paid-Plan')).toBeTruthy();
    expect(screen.getByText('Verlängert sich am 19. November 2026.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upgraden' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Zahlung verwalten' }));
    expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/1');
  });

  it('paid: everyone else sees who pays, and no Stripe buttons', () => {
    show(
      details({
        plan: 'paid',
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          status: 'active',
          renewsAt: '2026-11-19T10:00:00.000Z',
        }),
      }),
      { userId: 'u2', role: 'member' },
    );

    expect(screen.getByText('Zahlung über Anna Berg')).toBeTruthy();
    expect(screen.getByText(/Anna Berg zahlt für diesen Workspace/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zahlung verwalten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zahlung übergeben' })).toBeNull();
  });

  it('free: others upgrade through the billing owner', () => {
    show(
      details({ billing: billingFixture({ enabled: true, owner: { id: 'u1', name: 'Anna' } }) }),
      {
        userId: 'u2',
      },
    );
    expect(screen.getByText('Upgrade über Anna')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upgraden' })).toBeNull();
  });

  it('free and never subscribed: the owner starts the 14-day trial through checkout', async () => {
    api.checkout.mockImplementation((_: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ url: 'https://checkout.stripe.com/c/1' }),
    );
    show(
      details({
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          isOwner: true,
          trialAvailable: true,
        }),
      }),
    );
    expect(screen.queryByRole('button', { name: 'Upgraden' })).toBeNull();
    expect(screen.getByText('Alles aus Paid, ohne Zahlungsmethode.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '14 Tage kostenlos testen' }));
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/1');
  });

  it('in the trial: when it ends, and the card goes in through the portal', async () => {
    api.portal.mockImplementation((_: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ url: 'https://billing.stripe.com/p/1' }),
    );
    show(
      details({
        plan: 'paid',
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          isOwner: true,
          status: 'trialing',
          trialEndsAt: '2026-11-03T10:00:00.000Z',
        }),
      }),
    );
    expect(
      screen.getByText(
        'Testphase bis 3. November 2026. Ohne Zahlungsmethode geht es danach mit Free weiter.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Zahlungsmethode hinterlegen' }));
    expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/1');
  });

  it('paid without a subscription after a handover: the owner adds a payment method', () => {
    show(
      details({
        plan: 'paid',
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          isOwner: true,
          downgradeAt: '2026-11-02T10:00:00.000Z',
          downgradeReason: 'owner_changed',
        }),
      }),
    );
    expect(
      screen.getByText('Wechselt am 2. November 2026 auf Free – Zahlungsmethode hinterlegen.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zahlungsmethode hinterlegen' })).toBeTruthy();
  });

  it('near a limit: a hint; over it: what is blocked and how to get out', () => {
    const near = details({
      usage: { ...details().usage, seatsUsed: 4, storageBytes: 1.8 * GB },
    });
    const { unmount } = show(near);
    expect(screen.getByText('Bald am Limit')).toBeTruthy();
    expect(screen.getByText(/Personen, Speicher: fast ausgeschöpft/)).toBeTruthy();
    unmount();

    show(details({ usage: { ...details().usage, seatsUsed: 7 }, locked: true }));
    expect(screen.getByText('Der Workspace liegt über dem Limit seines Plans')).toBeTruthy();
    expect(screen.getByText(/Personen entfernen oder\s+Einladungen zurückziehen/)).toBeTruthy();
    expect(screen.queryByText('Bald am Limit')).toBeNull();
    // Upgrading still works while locked.
    expect(screen.getByRole('button', { name: 'Upgraden' })).toBeTruthy();
  });

  it('self-hosted without limits: only the numbers, no plan or billing', () => {
    show(
      details({
        usage: {
          members: 12,
          seatsUsed: 12,
          maxMembers: null,
          decks: 30,
          maxDecks: null,
          storageBytes: 5 * GB,
          maxStorageBytes: null,
        },
        billing: billingFixture(),
      }),
    );
    expect(screen.queryByText('Free-Plan')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Plan' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Zahlung' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upgraden' })).toBeNull();
    expect(screen.getByText('5 GB | unbegrenzt')).toBeTruthy();
    expect(screen.getAllByText('Kein Limit')).toHaveLength(2);
  });

  it('the owner hands paying over to another admin, and withdraws an open request', async () => {
    api.members = [
      member('u1', 'Anna Berg', 'admin'),
      member('u2', 'Ben Kurz', 'admin'),
      member('u3', 'Cem Ott', 'member'),
    ];
    const { unmount } = show(details());
    const select = screen.getByRole('combobox', { name: 'Admin, der die Zahlung übernimmt' });
    // Only other admins.
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Ben Kurz']);
    await userEvent.click(screen.getByRole('button', { name: 'Zahlung übergeben' }));
    expect(api.request).toHaveBeenCalledWith('u2', expect.anything());
    unmount();

    show(
      details({
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          isOwner: true,
          transfer: { to: { id: 'u2', name: 'Ben Kurz' }, requestedAt: '2026-10-18T10:00:00.000Z' },
        }),
      }),
    );
    expect(screen.getByText('Du hast Ben Kurz gebeten, die Zahlung zu übernehmen.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Zurückziehen' }));
    expect(api.cancel).toHaveBeenCalled();
  });

  it('the asked admin takes over (to Stripe for a payment method) or declines', async () => {
    api.accept.mockImplementation((_: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ url: 'https://checkout.stripe.com/c/2', details: details() }),
    );
    show(
      details({
        plan: 'paid',
        billing: billingFixture({
          enabled: true,
          owner: { id: 'u1', name: 'Anna Berg' },
          status: 'active',
          transfer: { to: { id: 'u2', name: 'Ben Kurz' }, requestedAt: '2026-10-18T10:00:00.000Z' },
        }),
      }),
      { userId: 'u2' },
    );
    expect(screen.getByText('Anna Berg bittet dich, die Zahlung zu übernehmen')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/2');
    await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    expect(api.cancel).toHaveBeenCalled();
  });
});
