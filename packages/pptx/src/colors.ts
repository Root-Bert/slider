import { attr, child, path, type XmlElement } from './xml';

/** Theme colour slots (`dk1`, `lt1`, `accent1`, …) → `#rrggbb`. */
export type ColorScheme = ReadonlyMap<string, string>;

/**
 * Logical scheme names map onto theme slots through the master's `p:clrMap`. Nearly every deck
 * uses the default mapping, so it is assumed here instead of read from the master.
 */
const DEFAULT_COLOR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
};

const HEX_COLOR = /^[0-9a-f]{6}$/i;

/** Reads `a:themeElements/a:clrScheme` of a theme part. */
export function readColorScheme(theme: XmlElement | null): ColorScheme {
  const scheme = new Map<string, string>();
  for (const slot of path(theme, 'a:themeElements', 'a:clrScheme')?.children ?? []) {
    const color = literalColor(slot);
    if (color) scheme.set(slot.name.replace(/^a:/, ''), color);
  }
  return scheme;
}

/**
 * Resolves the colour held by an element such as `a:solidFill` or `p:bgRef`: `a:srgbClr`,
 * `a:sysClr` or `a:schemeClr` (via the theme). Colour transforms (`a:lumMod`, `a:tint`, …) are
 * ignored, so derived colours come out as their base colour.
 */
export function resolveColor(
  container: XmlElement | undefined,
  scheme: ColorScheme,
): string | null {
  const literal = literalColor(container);
  if (literal) return literal;
  const schemeName = attr(child(container, 'a:schemeClr'), 'val');
  if (!schemeName) return null;
  return scheme.get(DEFAULT_COLOR_MAP[schemeName] ?? schemeName) ?? null;
}

/** Colour of an element's `a:solidFill` child, if it has one. */
export function solidFillOf(element: XmlElement | undefined, scheme: ColorScheme): string | null {
  return resolveColor(child(element, 'a:solidFill'), scheme);
}

function literalColor(container: XmlElement | undefined): string | null {
  const value =
    attr(child(container, 'a:srgbClr'), 'val') ?? attr(child(container, 'a:sysClr'), 'lastClr');
  return value && HEX_COLOR.test(value) ? `#${value.toLowerCase()}` : null;
}
