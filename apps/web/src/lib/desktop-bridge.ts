import type { CloudAccount } from '@slider/shared';

/*
 * The desktop app's bridge (BER-201, desktop/page-preload.cjs): what this computer adds to the
 * same web app – its files, the decks it keeps, signing it out. Asked for as a capability, not as
 * a platform: in the browser it is missing and those actions are simply not offered. It is there
 * on this computer's pages and, online, on the server's (the tabs show those, live); deck ids are
 * always the page's own.
 */

export interface DesktopState {
  platform: string;
  account: CloudAccount | null;
  server: string | null;
  /** The tabs show the server's pages (online, signed in). */
  live: boolean;
  /** The account's decks brought to this computer → kept after signing out. */
  kept: Record<string, boolean>;
  /**
   * Decks that are a file on this computer (`missing`: moved or deleted elsewhere; `changedAt`:
   * when a change made to it elsewhere last came in).
   */
  files: Record<string, { missing: boolean; changedAt: string | null }>;
}

export interface DesktopBridge {
  state(): Promise<DesktopState | null>;
  openFiles(): Promise<void>;
  saveAs(deckId: string, title: string): Promise<boolean>;
  reveal(deckId: string): Promise<boolean>;
  keep(deckId: string, keep: boolean): Promise<boolean>;
  signOut(): Promise<boolean>;
  /**
   * What the presentation offers in the app's tab bar, top right (Präsentieren,
   * Referentenansicht, Exportieren, ✕); `null`: nothing. A click there arrives as
   * `DESKTOP_BAR_EVENT` on `window`, within a user gesture. Missing in older apps.
   */
  deckBar?(offer: DesktopBarOffer | null): void;
}

/** The presentation's buttons in the app's tab bar: „Exportieren“ only for whoever can edit. */
export interface DesktopBarOffer {
  share: boolean;
  /** „Exportieren“ is open – its button shows pressed. */
  shareOpen: boolean;
  /** A template being designed: ✕ says „Vorlage schließen“. */
  template: boolean;
}

/** A button of the tab bar pressed: `detail` is the action. */
export const DESKTOP_BAR_EVENT = 'slider:desktop-bar';
export type DesktopBarAction = 'present' | 'presenter' | 'share' | 'close';

/** The desktop app shows „Präsentieren“, „Referentenansicht“, „Exportieren“ and ✕ in its tab bar. */
export const inDesktopBar = () => !!desktopBridge()?.deckBar;

declare global {
  interface Window {
    sliderDesktop?: DesktopBridge;
  }
}

export const desktopBridge = (): DesktopBridge | null =>
  typeof window === 'undefined' ? null : (window.sliderDesktop ?? null);

/** „Im Finder zeigen“ on the Mac, the folder elsewhere. */
export const revealLabel = (platform: string | undefined) =>
  platform === 'darwin' ? 'Im Finder zeigen' : 'Im Ordner zeigen';

/** A presentation Slider can write as a file of its own: ODP (and its template). */
export const savableAsFile = (fileName: string) => /\.(odp|otp)$/i.test(fileName);
