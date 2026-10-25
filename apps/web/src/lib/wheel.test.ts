import { describe, expect, it } from 'vitest';
import { wheelPixels } from './wheel';

describe('wheelPixels', () => {
  it('keeps pixels and turns lines into pixels', () => {
    expect(wheelPixels(10, 0)).toBe(10);
    expect(wheelPixels(-3, 1)).toBe(-48);
  });
});
