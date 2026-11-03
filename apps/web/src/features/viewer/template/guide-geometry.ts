import type { Guide } from '@slider/shared';

export const sameGuide = (a: Guide, b: Guide) =>
  a.orientation === b.orientation && Math.abs(a.position - b.position) < 0.001;
