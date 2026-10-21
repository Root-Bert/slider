import { describe, expect, it } from 'vitest';
import { parseSlideInput, stepSlide } from './slide-input';

describe('parseSlideInput', () => {
  it('reads a position within the deck', () => {
    expect(parseSlideInput('7', 16)).toBe(7);
    expect(parseSlideInput(' 12 ', 16)).toBe(12);
    expect(parseSlideInput('007', 16)).toBe(7);
  });

  it('clamps out-of-range numbers to 1..total', () => {
    expect(parseSlideInput('0', 16)).toBe(1);
    expect(parseSlideInput('-3', 16)).toBe(1);
    expect(parseSlideInput('99', 16)).toBe(16);
    expect(parseSlideInput('999', 12)).toBe(12);
  });

  it('rounds decimals (dot or comma)', () => {
    expect(parseSlideInput('3.4', 16)).toBe(3);
    expect(parseSlideInput('3,6', 16)).toBe(4);
  });

  it('returns null for anything that is not a number', () => {
    expect(parseSlideInput('', 16)).toBeNull();
    expect(parseSlideInput('   ', 16)).toBeNull();
    expect(parseSlideInput('abc', 16)).toBeNull();
    expect(parseSlideInput('3a', 16)).toBeNull();
    expect(parseSlideInput('-', 16)).toBeNull();
  });

  it('returns null for an empty deck', () => {
    expect(parseSlideInput('1', 0)).toBeNull();
  });
});

describe('stepSlide', () => {
  it('steps by ±1 within the deck', () => {
    expect(stepSlide(5, 1, 16)).toBe(6);
    expect(stepSlide(5, -1, 16)).toBe(4);
  });

  it('stops at the ends', () => {
    expect(stepSlide(16, 1, 16)).toBe(16);
    expect(stepSlide(1, -1, 16)).toBe(1);
  });
});
