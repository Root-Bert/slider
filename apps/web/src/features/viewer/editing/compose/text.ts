import type { LiveElement } from '@slider/shared';

/** Whether any of its paragraphs holds a character. */
export const holdsText = (live: LiveElement) =>
  live.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text));
