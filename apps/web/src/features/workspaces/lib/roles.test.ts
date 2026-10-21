import type { WorkspaceInvite } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  assignableRoles,
  atLeast,
  canCreateDecks,
  canDeleteWorkspace,
  canRemoveMember,
  canRenameWorkspace,
  formatExpiry,
  isLastAdmin,
  sortInvites,
  switcherLabel,
} from './roles';

describe('role ranks', () => {
  it('orders admin > member > reviewer > viewer', () => {
    expect(atLeast('admin', 'admin')).toBe(true);
    expect(atLeast('member', 'admin')).toBe(false);
    expect(atLeast('reviewer', 'member')).toBe(false);
    expect(atLeast('reviewer', 'viewer')).toBe(true);
  });

  it('gates workspace actions', () => {
    expect(canCreateDecks('member')).toBe(true);
    expect(canCreateDecks('reviewer')).toBe(false);
    expect(canRenameWorkspace('admin')).toBe(true);
    expect(canRenameWorkspace('member')).toBe(false);
    expect(canDeleteWorkspace('admin')).toBe(true);
    expect(canDeleteWorkspace('member')).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('lets admins give every role', () => {
    expect(assignableRoles('admin')).toEqual(['admin', 'member', 'reviewer', 'viewer']);
  });

  it('gives members and reviewers nothing', () => {
    expect(assignableRoles('member')).toEqual([]);
    expect(assignableRoles('reviewer')).toEqual([]);
  });
});

describe('member removal', () => {
  it('follows the API rules', () => {
    expect(canRemoveMember('admin')).toBe(true);
    expect(canRemoveMember('member')).toBe(false);
  });

  it('knows the last admin', () => {
    expect(isLastAdmin('admin', 1)).toBe(true);
    expect(isLastAdmin('admin', 2)).toBe(false);
    expect(isLastAdmin('member', 1)).toBe(false);
  });
});

describe('sortInvites', () => {
  const invite = (id: string, state: WorkspaceInvite['state'], createdAt: string) =>
    ({ id, state, createdAt }) as WorkspaceInvite;

  it('lists open invites first, newest first', () => {
    const sorted = sortInvites([
      invite('old-open', 'valid', '2026-01-01T00:00:00Z'),
      invite('new-used', 'used', '2026-03-01T00:00:00Z'),
      invite('new-open', 'valid', '2026-02-01T00:00:00Z'),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(['new-open', 'old-open', 'new-used']);
  });
});

describe('formatExpiry', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('counts whole days left', () => {
    expect(formatExpiry('2026-10-15T12:00:00Z', now)).toBe('noch 7 Tage gültig');
    expect(formatExpiry('2026-10-09T13:00:00Z', now)).toBe('noch 1 Tag gültig');
    expect(formatExpiry('2026-10-08T18:00:00Z', now)).toBe('noch heute gültig');
    expect(formatExpiry('2026-10-08T11:00:00Z', now)).toBe('abgelaufen');
  });
});

describe('switcherLabel', () => {
  it('names the organisation and counts invites in singular and plural', () => {
    expect(switcherLabel('Nord', 0)).toBe('Organisation: Nord');
    expect(switcherLabel('Nord', 1)).toBe('Organisation: Nord, 1 Einladung');
    expect(switcherLabel('Nord', 3)).toBe('Organisation: Nord, 3 Einladungen');
    expect(switcherLabel(null, 2)).toBe('Organisationen');
  });
});
