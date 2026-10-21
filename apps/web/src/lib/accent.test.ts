import { ACCENT_COLORS } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_COLOR_NAMES,
  POWERPOINT_COLOR,
  accentAlpha,
  accentColor,
  isLightAccent,
  onAccentClass,
  ringColor,
} from './accent';

describe('accent colours', () => {
  it('maps to the theme variables', () => {
    expect(accentColor('red')).toBe('var(--color-accent-red)');
    expect(accentColor('powerpoint')).toBe('var(--color-powerpoint)');
    expect(POWERPOINT_COLOR).toBe('var(--color-powerpoint)');
    expect(ringColor('powerpoint')).toBe('var(--color-ring-powerpoint)');
    expect(ringColor('cyan')).toBe('var(--color-ring-cyan)');
  });

  it('mixes translucent variants', () => {
    expect(accentAlpha('blue', 30)).toBe(
      'color-mix(in srgb, var(--color-accent-blue) 30%, transparent)',
    );
  });

  it('names every pickable colour in German', () => {
    expect(Object.keys(ACCENT_COLOR_NAMES).sort()).toEqual([...ACCENT_COLORS].sort());
    expect(ACCENT_COLOR_NAMES.violet).toBe('Violett');
  });
});

describe('text on an accent', () => {
  it.each(['yellow', 'green', 'cyan'] as const)('%s is light and takes black', (color) => {
    expect(isLightAccent(color)).toBe(true);
    expect(onAccentClass(color)).toBe('text-black');
  });

  it.each(['red', 'blue', 'violet', 'powerpoint'] as const)('%s takes white', (color) => {
    expect(isLightAccent(color)).toBe(false);
    expect(onAccentClass(color)).toBe('text-white');
  });
});
