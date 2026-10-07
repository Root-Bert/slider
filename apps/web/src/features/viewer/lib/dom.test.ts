import { describe, expect, it } from 'vitest';
import { overflowEdges } from './dom';

describe('overflowEdges', () => {
  it('reports no hidden content when everything fits', () => {
    expect(overflowEdges(0, 500, 500)).toEqual({ start: false, end: false });
  });

  it('reports the clipped side(s) while scrolling', () => {
    expect(overflowEdges(0, 1000, 400)).toEqual({ start: false, end: true });
    expect(overflowEdges(300, 1000, 400)).toEqual({ start: true, end: true });
    expect(overflowEdges(600, 1000, 400)).toEqual({ start: true, end: false });
  });

  it('ignores sub-pixel leftovers', () => {
    expect(overflowEdges(599.5, 1000, 400)).toEqual({ start: true, end: false });
  });
});
