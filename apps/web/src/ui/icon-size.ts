/** The icon size scale (apps/web/design-system.md §8), in px. */
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, '2xl': 24 } as const;

export type IconSizeName = keyof typeof ICON_SIZE;
/** A step of the scale by name, or its px value. */
export type IconSize = IconSizeName | number;

/** Resolves a size name (`'lg'`) or px value (`18`) to px. */
export const iconPx = (size: IconSize): number =>
  typeof size === 'number' ? size : ICON_SIZE[size];
