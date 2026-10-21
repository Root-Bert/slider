import { describe, expect, it } from 'vitest';
import { newReviewSubtitle } from './new-review-copy';

describe('newReviewSubtitle', () => {
  it('names OneDrive/SharePoint only where the picker is offered', () => {
    expect(newReviewSubtitle(true)).toContain('OneDrive oder SharePoint');
    expect(newReviewSubtitle(false)).not.toMatch(/OneDrive|SharePoint/);
    expect(newReviewSubtitle(false)).toContain('hochladen oder per Link');
  });

  it('names Nextcloud once an account or the organisation’s Nextcloud is there', () => {
    expect(newReviewSubtitle(false, true)).toContain('aus Nextcloud öffnen');
    expect(newReviewSubtitle(true, true)).toContain('OneDrive, SharePoint oder Nextcloud');
    expect(newReviewSubtitle(false, false, true)).toContain('aus Google Drive öffnen');
    expect(newReviewSubtitle(true, true, true)).toContain(
      'OneDrive, SharePoint, Google Drive oder Nextcloud',
    );
  });
});
