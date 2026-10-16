import type { Workspace } from '@slider/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { pickWorkspace, readLastWorkspaceId, rememberWorkspace } from './last-workspace';

afterEach(() => vi.unstubAllGlobals());

describe('last workspace', () => {
  it('remembers the workspace per browser', () => {
    const { values } = stubStorage();
    expect(readLastWorkspaceId()).toBeNull();
    rememberWorkspace('w1');
    expect(values.get('slider.lastWorkspace')).toBe('w1');
    expect(readLastWorkspaceId()).toBe('w1');
  });

  it('forgets nothing and throws nothing without storage', () => {
    stubBrokenStorage();
    expect(() => rememberWorkspace('w1')).not.toThrow();
    expect(readLastWorkspaceId()).toBeNull();
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
