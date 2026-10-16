import { ACCENT_COLORS, type AccentColor, type Author } from '@slider/shared';
import { createStoredStore } from '@/lib/storage';

/**
 * Colours the viewer picked for *other* people (click their avatar). Only this browser sees
 * them – everyone keeps their own colour for themselves and for the others. The hook is
 * `useColorOverrides`.
 */
export type ColorOverrides = Readonly<Record<string, AccentColor>>;

const STORAGE_KEY = 'slider.colorOverrides.v1';
export const NO_COLOR_OVERRIDES: ColorOverrides = {};

/** The single store behind `useColorOverrides`. */
export const colorOverridesStore = createStoredStore<ColorOverrides>({
  key: STORAGE_KEY,
  parse: (value) =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, AccentColor] =>
            (ACCENT_COLORS as readonly unknown[]).includes(entry[1]),
          ),
        )
      : NO_COLOR_OVERRIDES,
  fallback: NO_COLOR_OVERRIDES,
});

/** `null` drops the override – the person shows in their own colour again. */
export function setColorOverride(authorId: string, color: AccentColor | null) {
  const { [authorId]: _, ...rest } = colorOverridesStore.getSnapshot();
  colorOverridesStore.set(color ? { ...rest, [authorId]: color } : rest);
}

/** `author` in the colour the viewer picked for them, if any. PowerPoint authors stay orange. */
export function withColorOverride<T extends Author>(author: T, overrides: ColorOverrides): T {
  if (author.type === 'external') return author;
  const color = overrides[author.id];
  return color && color !== author.color ? { ...author, color } : author;
}
