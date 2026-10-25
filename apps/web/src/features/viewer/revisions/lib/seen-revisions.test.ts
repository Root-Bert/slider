import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { markRevisionSeen, seenRevision, shouldAnnounceRevision } from './seen-revisions';

afterEach(() => vi.unstubAllGlobals());

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

describe('seen revisions', () => {
  it('remembers the newest revision seen per deck and never goes back', () => {
    const { values } = stubStorage();
    expect(seenRevision('d1')).toBeNull();
    markRevisionSeen('d1', 3);
    markRevisionSeen('d1', 2);
    expect(seenRevision('d1')).toBe(3);
    expect(JSON.parse(values.get('slider.seenRevisions.v1')!)).toEqual({ d1: 3 });
  });

  it('ignores values that are not revision numbers', () => {
    stubStorage({ 'slider.seenRevisions.v1': '{"d1":"3"}' });
    expect(seenRevision('d1')).toBeNull();
    stubStorage({ 'slider.seenRevisions.v1': '{' });
    expect(seenRevision('d1')).toBeNull();
  });

  it('forgets everything quietly without storage', () => {
    stubBrokenStorage();
    expect(() => markRevisionSeen('d1', 2)).not.toThrow();
    expect(seenRevision('d1')).toBeNull();
  });
});
