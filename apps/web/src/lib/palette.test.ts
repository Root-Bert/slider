import { ACCENT_COLORS } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { parseColor, readIndexCss, themeTokens } from '../styles/theme-css';
import {
  ACCENT_HEX,
  CANVAS,
  FLOAT_SHADOW_ALPHA,
  GLASS_SOLID,
  HAIRLINE_STRONG_ALPHA,
  POWERPOINT_HEX,
  readToken,
} from './palette';

const tokens = themeTokens(await readIndexCss());
const token = (name: string) => {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} missing from @theme`);
  return value;
};

describe('palette mirrors styles/index.css', () => {
  it('solid surfaces', () => {
    expect(CANVAS).toBe(token('--color-canvas'));
    expect(GLASS_SOLID).toBe(token('--color-glass-solid'));
  });

  it('alphas', () => {
    expect(parseColor(token('--color-hairline-strong'))).toEqual({
      rgb: [255, 255, 255],
      alpha: HAIRLINE_STRONG_ALPHA,
    });
    expect(parseColor(token('--shadow-float'))).toEqual({
      rgb: [0, 0, 0],
      alpha: FLOAT_SHADOW_ALPHA,
    });
  });

  it('accents', () => {
    expect(Object.keys(ACCENT_HEX).sort()).toEqual([...ACCENT_COLORS].sort());
    for (const color of ACCENT_COLORS) {
      expect(ACCENT_HEX[color]).toBe(token(`--color-accent-${color}`));
    }
    expect(POWERPOINT_HEX).toBe(token('--color-powerpoint'));
  });
});

describe('readToken', () => {
  it('falls back without a DOM', () => {
    expect(readToken('--color-accent-red', '#123456')).toBe('#123456');
  });
});
