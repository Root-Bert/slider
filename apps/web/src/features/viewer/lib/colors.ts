import type { AccentColor } from '@slider/shared';
import { accentAlpha, accentColor } from '@/lib/accent';

export { accentAlpha };

export const POWERPOINT_COLOR = 'var(--color-powerpoint)';

/** Colour of a comment's marks: PowerPoint orange for imported comments, else the author's accent. */
export const markColor = (comment: { source: 'app' | 'pptx'; author: { color: AccentColor } }) =>
  comment.source === 'pptx' ? POWERPOINT_COLOR : accentColor(comment.author.color);
