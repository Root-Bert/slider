import { SLIDE_PARAM } from '../../hooks/useSlideUrlSync';
import { AUDIENCE_PARAM, AUDIENCE_VALUE } from './show-sync';

/** The Window Management API's part used here (Chromium); not in TypeScript's DOM types yet. */
interface ScreenArea {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
interface ScreenDetails {
  screens: ScreenArea[];
  currentScreen: ScreenArea;
}
type WithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };
type ExtendedScreen = Screen & { isExtended?: boolean };

/** A second screen is attached and the browser can place a window on it. */
export const canUseSecondScreen = (): boolean =>
  typeof (window as WithScreens).getScreenDetails === 'function' &&
  (window.screen as ExtendedScreen).isExtended === true;

/** The viewer's address as the audience's window of this deck, starting on `slideId`. */
export function audienceUrl(href: string, slideId: string | null): string {
  const url = new URL(href);
  url.searchParams.set(AUDIENCE_PARAM, AUDIENCE_VALUE);
  if (slideId) url.searchParams.set(SLIDE_PARAM, slideId);
  else url.searchParams.delete(SLIDE_PARAM);
  return url.toString();
}

/**
 * Opens the audience's slide show in a window of its own (the same one again if it is open) –
 * within the click, else the browser blocks it. With a second screen and the Window Management
 * API it is then moved onto that screen and fills it (the browser asks once); otherwise it opens
 * beside and is dragged there. `null`: the browser blocked it.
 */
export function openAudienceWindow(deckId: string, slideId: string | null): Window | null {
  const shown = window.open(
    audienceUrl(window.location.href, slideId),
    `slider-audience-${deckId}`,
    'popup,width=960,height=540',
  );
  if (!shown) return null;
  if (canUseSecondScreen()) void moveToOtherScreen(shown);
  return shown;
}

async function moveToOtherScreen(shown: Window) {
  try {
    const details = await (window as WithScreens).getScreenDetails!();
    const other = details.screens.find((screen) => screen !== details.currentScreen);
    if (!other || shown.closed) return;
    shown.moveTo(other.availLeft, other.availTop);
    shown.resizeTo(other.availWidth, other.availHeight);
  } catch {
    // Not allowed: it stays where it opened.
  }
}
