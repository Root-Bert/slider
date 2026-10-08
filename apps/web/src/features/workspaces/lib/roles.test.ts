import type { Workspace, WorkspaceInvite } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { pickWorkspace } from './last-workspace';
import {
  assignableRoles,
  atLeast,
  canCreateDecks,
  canDeleteWorkspace,
  canRemoveMember,
  canRenameWorkspace,
  formatExpiry,
  isLastOwner,
  sortInvites,
} from './roles';

describe('role ranks', () => {
  it('orders owner > admin > member > reviewer', () => {
    expect(atLeast('owner', 'admin')).toBe(true);
    expect(atLeast('admin', 'admin')).toBe(true);
    expect(atLeast('member', 'admin')).toBe(false);
    expect(atLeast('reviewer', 'member')).toBe(false);
  });

  it('gates workspace actions', () => {
    expect(canCreateDecks('member')).toBe(true);
    expect(canCreateDecks('reviewer')).toBe(false);
    expect(canRenameWorkspace('admin')).toBe(true);
    expect(canRenameWorkspace('member')).toBe(false);
    expect(canDeleteWorkspace('owner')).toBe(true);
    expect(canDeleteWorkspace('admin')).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('lets owners give every role', () => {
    expect(assignableRoles('owner', 'member')).toEqual(['owner', 'admin', 'member', 'reviewer']);
    expect(assignableRoles('owner', 'owner')).toEqual(['owner', 'admin', 'member', 'reviewer']);
  });

  it('keeps admins below owner and away from owners', () => {
    expect(assignableRoles('admin', 'reviewer')).toEqual(['admin', 'member', 'reviewer']);
    expect(assignableRoles('admin', 'owner')).toEqual([]);
  });

  it('gives members and reviewers nothing', () => {
    expect(assignableRoles('member', 'reviewer')).toEqual([]);
    expect(assignableRoles('reviewer', 'reviewer')).toEqual([]);
  });
});

describe('member removal', () => {
  it('follows the API rules', () => {
    expect(canRemoveMember('admin', 'member')).toBe(true);
    expect(canRemoveMember('admin', 'admin')).toBe(true);
    expect(canRemoveMember('admin', 'owner')).toBe(false);
    expect(canRemoveMember('owner', 'owner')).toBe(true);
    expect(canRemoveMember('member', 'reviewer')).toBe(false);
  });

  it('knows the last owner', () => {
    expect(isLastOwner('owner', 1)).toBe(true);
    expect(isLastOwner('owner', 2)).toBe(false);
    expect(isLastOwner('admin', 1)).toBe(false);
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

describe('pickWorkspace', () => {
  const ws = (id: string) => ({ id }) as Workspace;

  it('prefers the last used workspace', () => {
    expect(pickWorkspace([ws('a'), ws('b')], 'b')?.id).toBe('b');
  });

  it('falls back to the first, or null without workspaces', () => {
    expect(pickWorkspace([ws('a'), ws('b')], 'gone')?.id).toBe('a');
    expect(pickWorkspace([ws('a')], null)?.id).toBe('a');
    expect(pickWorkspace([], 'a')).toBeNull();
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
