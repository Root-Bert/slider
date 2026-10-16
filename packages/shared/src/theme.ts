/*
 * Base values of Slider's dark theme for code outside the web app's stylesheet – today the
 * invitation mails (apps/api). The source of truth is `apps/web/src/styles/index.css`;
 * `test/theme.test.ts` fails when these drift from it.
 */

export const THEME = {
  /** `--color-canvas`. */
  canvas: '#000000',
  /** White alphas of `--color-fg`, `-muted`, `-subtle`, `-faint`. */
  fg: { fg: 0.9, muted: 0.7, subtle: 0.5, faint: 0.3 },
  /** White alphas of `--color-hairline` and `--color-hairline-strong`. */
  hairline: 0.08,
  hairlineStrong: 0.16,
  /** White alpha of the `dot-grid` dots (`--color-dot`). */
  dot: 0.14,
  /** Fill opacity of the back slide in the Slider mark (`ui/Logo.tsx`). */
  logoBackOpacity: 0.45,
  /** `--font-sans`. */
  fontSans: "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif",
} as const;

const channels = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`expected #rrggbb, got ${hex}`);
  const digits = match[1]!;
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
};

/**
 * `color` at `alpha` laid over the solid `over`, as an opaque `#rrggbb` – for clients that don't
 * blend `rgba` (mail). `flatten(0.9)` is white 90 % on the canvas: `#e6e6e6`.
 */
export function flatten(alpha: number, over: string = THEME.canvas, color = '#ffffff'): string {
  const top = channels(color);
  const base = channels(over);
  return `#${top
    .map((value, i) => Math.round(value * alpha + base[i]! * (1 - alpha)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}
