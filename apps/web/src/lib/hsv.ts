/** A colour as the picker holds it: hue 0–360, saturation and value 0–1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** `#rrggbb` → HSV; `null` for anything else. */
export function hexToHsv(hex: string): Hsv | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1] as string, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** HSV → `#rrggbb`. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const sat = clamp01(s);
  const val = clamp01(v);
  const f = (n: number) => {
    const k = (n + (((h % 360) + 360) % 360) / 60) % 6;
    const channel = val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(channel * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/** A colour with its opacity as CSS. */
export function withOpacity(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  const alpha = Math.round(clamp01(opacity) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${alpha}`;
}
