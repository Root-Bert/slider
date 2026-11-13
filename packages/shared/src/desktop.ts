import { z } from 'zod';
import { accentColorSchema } from './model';

/*
 * Signing the desktop app in to a Slider server (BER-201), the way Figma does: the app opens the
 * server's `/desktop-anmelden` in the system browser, the person signs in there and confirms,
 * the page hands a one-time code back through `slider://auth`. The app's local server trades it,
 * with the PKCE verifier only it knows, for a session token of its own.
 */

/** The app's custom URL scheme: `slider://auth?code=…&state=…`. */
export const DESKTOP_SCHEME = 'slider';

/** 43 URL-safe characters: SHA-256 (challenge) or 32 random bytes (verifier), base64url. */
const pkceValue = z.string().regex(/^[\w-]{43}$/);

/** `POST /auth/desktop/code` (on the server, signed in): a code for the PKCE challenge. */
export const desktopCodeInputSchema = z.object({ challenge: pkceValue });
export type DesktopCodeInput = z.infer<typeof desktopCodeInputSchema>;
export interface DesktopCode {
  code: string;
}

/** The account as the desktop app shows it. */
export const cloudAccountSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  color: accentColorSchema,
});
export type CloudAccount = z.infer<typeof cloudAccountSchema>;

/** `POST /auth/desktop/token` (on the server, from the desktop's local server). */
export const desktopTokenInputSchema = z.object({
  code: z.string().min(1).max(2000),
  verifier: pkceValue,
});
export type DesktopTokenInput = z.infer<typeof desktopTokenInputSchema>;
export const desktopTokenSchema = z.object({
  token: z.string(),
  account: cloudAccountSchema,
});
export type DesktopToken = z.infer<typeof desktopTokenSchema>;

/** `POST /auth/desktop/logout` (on the server): ends the desktop's session. */
export const desktopLogoutInputSchema = z.object({ token: z.string().min(1).max(200) });

/** `GET /desktop/cloud` (the desktop's local server): which server, signed in as whom. */
export interface CloudStatus {
  /** e.g. `https://slider.bertro.dev`. */
  server: string;
  account: CloudAccount | null;
  /** How bringing this machine and the account together goes; `null` while signed out. */
  sync?: CloudSync | null;
  /**
   * The account's decks brought here (local deck id), not the ones made here: signing out takes
   * them off this machine unless `keep` („Auf diesem Gerät behalten“). Decks made here always stay.
   */
  cloudDecks?: Record<string, { keep: boolean }>;
}

/** `PUT /desktop/cloud/decks/:deckId/keep`: „Auf diesem Gerät behalten“ on or off. */
export const cloudKeepInputSchema = z.object({ keep: z.boolean() });
export type CloudKeepInput = z.infer<typeof cloudKeepInputSchema>;

/**
 * The desktop keeps the account's workspaces and decks as copies here (BER-201): `syncing` while
 * a pass runs, `offline` without a connection (edits wait), `error` with the first problem.
 */
export interface CloudSync {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  /** The last pass that reached the server. */
  at: string | null;
  message: string | null;
  /** The last time a pass changed something here (decks, workspaces): the page reloads its lists. */
  changedAt: string | null;
}

/**
 * `POST /desktop/cloud/start`, like Bitwarden: without `server` the one signed in to last (at
 * first the hosted Slider), with it a self-hosted one – `slider.firma.de` will do.
 */
export const cloudStartInputSchema = z.object({ server: z.string().max(500).optional() });
export type CloudStartInput = z.infer<typeof cloudStartInputSchema>;

/** `POST /desktop/cloud/start`: the page to open in the system browser. */
export interface CloudSignInStart {
  url: string;
}

/** `POST /desktop/cloud/finish` (the desktop app, from `slider://auth`). */
export const cloudFinishInputSchema = z.object({
  code: z.string().min(1).max(2000),
  state: z.string().min(1).max(200),
});
export type CloudFinishInput = z.infer<typeof cloudFinishInputSchema>;

/**
 * `GET /desktop/cloud/session` (the desktop's local server, for Electron only – it proves itself
 * with the app's secret): the server's session token, set as its cookie so its pages open in the
 * app's tabs signed in. `token: null` when signed out.
 */
export interface CloudSession {
  server: string;
  token: string | null;
  /**
   * Local id → the server's, for what is on both: online the tabs show the server's pages, live
   * (the server is the truth), offline this computer's copies – Electron moves them across.
   */
  decks: Record<string, string>;
  workspaces: Record<string, string>;
}

/** The header Electron proves itself with to its local server (the app's `SLIDER_SECRET`). */
export const DESKTOP_SECRET_HEADER = 'x-slider-desktop-secret';

/**
 * The cookie Electron puts into its browser session for the local server's pages: without it (or
 * the secret) the local server answers nothing – another browser on this machine, or a web page
 * reaching 127.0.0.1, gets no access to the one person it signs in without a login.
 */
export const DESKTOP_PAGE_COOKIE = 'slider_desktop';

/*
 * Files on this computer (BER-201, desktop only): an ODP opened from the Finder, „Öffnen …“ or
 * saved with „Als Datei sichern …“ is linked to its path – every step is written back to it, a
 * change made to it elsewhere comes in as a new version. A PowerPoint opens as a copy (saving it
 * as PowerPoint would lose detail). The routes that take a path only answer Electron (the app's
 * secret, {@link DESKTOP_SECRET_HEADER}): no web page can make the app read or write a file.
 */

/** An absolute path on this computer. */
const localPath = z.string().min(2).max(4096).startsWith('/');

/** `POST /desktop/files/open` (Electron): a file as a presentation – the one it is already, if so. */
export const localFileOpenInputSchema = z.object({ path: localPath });
export type LocalFileOpenInput = z.infer<typeof localFileOpenInputSchema>;
export interface LocalFileOpened {
  deckId: string;
  /** Written back to the file from now on (an ODP); `false`: a copy (a PowerPoint, a PDF …). */
  linked: boolean;
}

/** `POST /desktop/files/:deckId/save` (Electron): the presentation into this file, linked from now on. */
export const localFileSaveInputSchema = z.object({ path: localPath });
export type LocalFileSaveInput = z.infer<typeof localFileSaveInputSchema>;

/** A presentation's file on this computer, as `GET /desktop/files` lists them by deck id. */
export interface LocalFile {
  path: string;
  /** Moved or deleted elsewhere: nothing is written until it is opened again. */
  missing: boolean;
  /** When a change made to the file elsewhere last came in as a new version (ISO), if ever. */
  changedAt: string | null;
}
export type LocalFiles = Record<string, LocalFile>;
