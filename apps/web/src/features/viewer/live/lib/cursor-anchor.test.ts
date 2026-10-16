import { describe, expect, it } from 'vitest';
import { sameCursor } from './cursor-anchor';

const cursor = (slideId: string, x: number, y: number) => ({ slideId, point: { x, y } });

describe('sameCursor', () => {
  it('compares slide and point', () => {
    expect(sameCursor(null, null)).toBe(true);
    expect(sameCursor(null, cursor('s1', 0, 0))).toBe(false);
    expect(sameCursor(cursor('s1', 0.5, 0.5), null)).toBe(false);
    expect(sameCursor(cursor('s1', 0.5, 0.5), cursor('s1', 0.5, 0.5))).toBe(true);
    expect(sameCursor(cursor('s1', 0.5, 0.5), cursor('s1', 0.6, 0.5))).toBe(false);
    expect(sameCursor(cursor('s1', 0.5, 0.5), cursor('s1', 0.5, 0.6))).toBe(false);
    expect(sameCursor(cursor('s1', 0.5, 0.5), cursor('s2', 0.5, 0.5))).toBe(false);
  });
});
