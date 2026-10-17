import { describe, expect, it } from 'vitest';
import { newReviewSubtitle } from './new-review-copy';

describe('newReviewSubtitle', () => {
  it('names OneDrive/SharePoint only where the picker is offered', () => {
    expect(newReviewSubtitle(true)).toContain('OneDrive oder SharePoint');
    expect(newReviewSubtitle(false)).not.toMatch(/OneDrive|SharePoint/);
    expect(newReviewSubtitle(false)).toContain('hochladen oder per Link');
  });
});
