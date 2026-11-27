import { useState } from 'react';
import { readString, writeString } from './storage';

/**
 * How a page with „Liste“ / „Kacheln“ opens, the same for every such page and kept in this browser
 * (`/einstellungen` → Darstellung): `auto` as one had it there last, else always as rows or tiles –
 * switched on the page, it stays so until one leaves it.
 */
export const VIEW_DEFAULT_KEY = 'slider.view.default';
export const VIEW_DEFAULTS = ['auto', 'list', 'tiles'] as const;
export type ViewDefault = (typeof VIEW_DEFAULTS)[number];

/** The pages name their tiles either way. */
const TILES: readonly string[] = ['tiles', 'grid'];

const oneOf = <T extends string>(options: readonly T[], value: string | null): value is T =>
  value !== null && (options as readonly string[]).includes(value);

export function readViewDefault(): ViewDefault {
  const stored = readString(VIEW_DEFAULT_KEY);
  return oneOf(VIEW_DEFAULTS, stored) ? stored : 'auto';
}

/**
 * The view a page opens with: the setting's rows or tiles where the page has them; on `auto` the
 * first of `stored` the page knows (its own last, then what it inherits); else its `fallback`.
 */
export function openingView<T extends string>(
  options: readonly T[],
  fallback: T,
  setting: ViewDefault,
  stored: readonly (string | null)[],
): T {
  const fixed =
    setting === 'list'
      ? options.find((option) => option === 'list')
      : setting === 'tiles'
        ? options.find((option) => TILES.includes(option))
        : undefined;
  if (fixed) return fixed;
  if (setting === 'auto') {
    const last = stored.find((value) => oneOf(options, value));
    if (last !== undefined && oneOf(options, last)) return last;
  }
  return fallback;
}

/**
 * A page's „Liste“ / „Kacheln“ (and whatever else its switch offers), remembered for that page
 * under `key` – read as the setting says when the page opens (or `key` changes), written on every
 * switch, so „Automatisch“ finds it again. `inherit` is read when the page has none of its own yet
 * and written along: a folder never switched opens as the last one did.
 */
export function useViewChoice<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T,
  inherit?: string,
) {
  const open = () =>
    openingView(options, fallback, readViewDefault(), [
      readString(key),
      inherit ? readString(inherit) : null,
    ]);
  const [state, setState] = useState(() => ({ key, value: open() }));
  let value = state.value;
  if (state.key !== key) {
    // Another page in the same component (a tab): opened anew, in this render already.
    value = open();
    setState({ key, value });
  }
  const update = (next: T) => {
    setState({ key, value: next });
    writeString(key, next);
    if (inherit) writeString(inherit, next);
  };
  return [value, update] as const;
}
