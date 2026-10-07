/**
 * Flex gap around the 24px gap divider, equal to the stage padding: 32 + 24 + 32 = 88px from
 * slide to slide on desktop, line centred (Desktop-1 87:317, Desktop-7 87:238). Narrower on
 * phones, so the next slide's ⊕ still peeks in. Connector lanes beside the slide run in it.
 */
export const STAGE_GAP = 'var(--stage-pad)';
export const GAP_DIVIDER_PX = 24;

/**
 * Width of a slide box: as tall as the zoomed stage allows (`--slide-h`), but never wider than
 * the stage itself – that keeps phones at full width. Must be used inside the stage container,
 * where `100cqw` is its content box (the width between the paddings).
 */
export const slideWidthCss = (aspectRatio: number) =>
  `min(calc(var(--slide-h) * ${aspectRatio}), 100cqw)`;
