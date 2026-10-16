import { describe, expect, it } from 'vitest';
import { flatten, THEME } from '../src/theme';

// `node:fs` by name: the shared package runs in browsers too and has no Node types.
const { readFileSync } = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string;
};

const root = new URL('../../../apps/web/src/', import.meta.url);
const css = readFileSync(new URL('styles/index.css', root), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const theme = css.slice(css.indexOf('@theme'));

const token = (name: string): string => {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(theme);
  if (!match) throw new Error(`${name} missing from @theme`);
  return match[1]!.trim();
};
const whiteAlpha = (name: string): number => {
  const match = /^rgb\(255 255 255 \/ ([\d.]+)\)$/.exec(token(name));
  if (!match) throw new Error(`${name} is not white at an alpha: ${token(name)}`);
  return Number(match[1]);
};

describe('THEME mirrors apps/web/src/styles/index.css', () => {
  it('canvas and font', () => {
    expect(THEME.canvas).toBe(token('--color-canvas'));
    expect(THEME.fontSans).toBe(token('--font-sans'));
  });

  it('foreground, hairline and dot alphas', () => {
    expect(THEME.fg).toEqual({
      fg: whiteAlpha('--color-fg'),
      muted: whiteAlpha('--color-fg-muted'),
      subtle: whiteAlpha('--color-fg-subtle'),
      faint: whiteAlpha('--color-fg-faint'),
    });
    expect(THEME.hairline).toBe(whiteAlpha('--color-hairline'));
    expect(THEME.hairlineStrong).toBe(whiteAlpha('--color-hairline-strong'));
    expect(THEME.dot).toBe(whiteAlpha('--color-dot'));
  });

  it('logo back opacity', () => {
    const logo = readFileSync(new URL('ui/Logo.tsx', root), 'utf8');
    expect(logo).toContain(`fillOpacity="${THEME.logoBackOpacity}"`);
  });
});

describe('flatten', () => {
  it('lays white over the canvas', () => {
    expect(flatten(THEME.fg.fg)).toBe('#e6e6e6');
    expect(flatten(THEME.fg.muted)).toBe('#b3b3b3');
    expect(flatten(THEME.fg.subtle)).toBe('#808080');
    expect(flatten(THEME.fg.faint)).toBe('#4d4d4d');
    expect(flatten(0)).toBe('#000000');
    expect(flatten(1)).toBe('#ffffff');
  });

  it('takes another base and colour', () => {
    expect(flatten(0.5, '#ffffff', '#000000')).toBe('#808080');
    expect(() => flatten(0.5, 'black')).toThrow();
  });
});
