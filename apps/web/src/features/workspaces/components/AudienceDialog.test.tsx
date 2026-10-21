import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workspace } from '@slider/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingFixture } from '@/test/workspace';
import { AudienceDialog } from './AudienceDialog';

const api = vi.hoisted(() => ({ rename: vi.fn(), setDomain: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useRenameWorkspace: () => ({ mutateAsync: api.rename, isPending: false, error: null }),
  useSetWorkspaceDomain: () => ({ mutateAsync: api.setDomain, isPending: false, error: null }),
}));

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
});

beforeEach(() => {
  api.rename.mockReset().mockResolvedValue({});
  api.setDomain.mockReset().mockResolvedValue({});
});

const workspace: Workspace = {
  id: 'w1',
  name: 'Firma',
  slug: 'firma',
  logoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'admin',
  memberCount: 1,
  plan: 'free',
  usage: {
    members: 1,
    seatsUsed: 1,
    maxMembers: 5,
    decks: 0,
    maxDecks: 3,
    storageBytes: 0,
    maxStorageBytes: null,
  },
  billing: billingFixture(),
  locked: false,
  joinDomain: null,
  audiencePending: true,
  blocked: false,
};

const choice = (name: RegExp) => screen.getByRole('button', { name, hidden: true });

describe('AudienceDialog (BER-148)', () => {
  it('"für mein Team" opens the organisation to the domain', async () => {
    render(<AudienceDialog workspace={workspace} email="anna@firma.de" />);
    await userEvent.click(choice(/Für mein Team bei firma\.de/));
    expect(api.rename).not.toHaveBeenCalled();
    expect(api.setDomain).toHaveBeenCalledWith(true);
  });

  it('"nur für mich" keeps it private, under the name typed in', async () => {
    render(<AudienceDialog workspace={workspace} email="anna@firma.de" />);
    const name = screen.getByRole('textbox', { name: 'Name', hidden: true });
    await userEvent.clear(name);
    await userEvent.type(name, 'Annas Ecke');
    await userEvent.click(choice(/Nur für mich/));
    expect(api.rename).toHaveBeenCalledWith('Annas Ecke');
    expect(api.setDomain).toHaveBeenCalledWith(false);
  });
});
