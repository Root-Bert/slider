/**
 * Flex gap around the 24px gap divider: 4 + 24 + 4 = 32px between slides, line centred (Desktop-1).
 */
export const STAGE_GAP_PX = 4;
export const GAP_DIVIDER_PX = 24;

/**
 * Width of a slide box: as tall as the zoomed stage allows (`--slide-h`), but never wider than
 * the stage itself – that keeps phones at full width. Must be used inside the stage container.
 */
export const slideWidthCss = (aspectRatio: number) =>
  `min(calc(var(--slide-h) * ${aspectRatio}), calc(100cqw - 2 * var(--stage-pad)))`;
