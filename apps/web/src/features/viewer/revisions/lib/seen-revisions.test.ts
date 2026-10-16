import { describe, expect, it } from 'vitest';
import { shouldAnnounceRevision } from './seen-revisions';

describe('shouldAnnounceRevision', () => {
  it('stays quiet on a first visit and for revision 1', () => {
    expect(shouldAnnounceRevision(null, 3)).toBe(false);
    expect(shouldAnnounceRevision(0, 1)).toBe(false);
  });

  it('announces a revision newer than the one seen last time', () => {
    expect(shouldAnnounceRevision(1, 2)).toBe(true);
    expect(shouldAnnounceRevision(2, 2)).toBe(false);
    expect(shouldAnnounceRevision(3, 2)).toBe(false);
  });
});
