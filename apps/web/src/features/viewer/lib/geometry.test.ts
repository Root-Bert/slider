import { describe, expect, it } from 'vitest';
import { denormalizeRect, normalizeClientPoint, placePopover } from './geometry';

const box = { left: 100, top: 50, width: 400, height: 200 };

describe('normalizeClientPoint', () => {
  it('maps viewport positions into 0–1 slide space', () => {
    expect(normalizeClientPoint(300, 150, box)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('clamps positions outside the slide', () => {
    expect(normalizeClientPoint(0, 1000, box)).toEqual({ x: 0, y: 1 });
  });

  it('survives an empty box', () => {
    expect(normalizeClientPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

it('denormalizes rects back to viewport boxes', () => {
  expect(denormalizeRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, box)).toEqual({
    left: 200,
    top: 150,
    right: 400,
    bottom: 200,
  });
});

describe('placePopover', () => {
  const viewport = { width: 1000, height: 800 };
  const popover = { width: 300, height: 200 };

  it('prefers the right side', () => {
    expect(
      placePopover({ left: 100, top: 100, right: 200, bottom: 150 }, popover, viewport),
    ).toEqual({
      left: 212,
      top: 100,
      side: 'right',
    });
  });

  it('flips to the left when the right side is too narrow', () => {
    const placement = placePopover(
      { left: 800, top: 100, right: 900, bottom: 150 },
      popover,
      viewport,
    );
    expect(placement).toEqual({ left: 488, top: 100, side: 'left' });
  });

  it('falls back to below and clamps into the viewport', () => {
    const placement = placePopover(
      { left: 200, top: 700, right: 900, bottom: 750 },
      popover,
      viewport,
    );
    expect(placement.side).toBe('below');
    expect(placement.top).toBe(800 - 200 - 12);
  });
});
