import { describe, expect, it } from 'vitest';
import { atScrollEdge, wheelPixels } from './wheel';

const scroller = (scrollLeft: number) =>
  ({ scrollLeft, scrollWidth: 300, clientWidth: 100 }) as HTMLElement;

describe('wheelPixels', () => {
  it('keeps pixels and turns lines into pixels', () => {
    expect(wheelPixels(10, 0)).toBe(10);
    expect(wheelPixels(-3, 1)).toBe(-48);
  });
});

describe('atScrollEdge', () => {
  it('stops at the start going left and at the end going right', () => {
    expect(atScrollEdge(scroller(0), -10)).toBe(true);
    expect(atScrollEdge(scroller(0), 10)).toBe(false);
    expect(atScrollEdge(scroller(200), 10)).toBe(true);
    expect(atScrollEdge(scroller(100), -10)).toBe(false);
  });
});
