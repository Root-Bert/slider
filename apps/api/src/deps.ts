import type { GoogleTokens } from './auth/google';
import type { MicrosoftTokens } from './auth/microsoft';
import type { NextcloudAccounts } from './auth/nextcloud';
import type { OidcClient } from './auth/oidc';
import type { WebAuthn } from './auth/passkeys';
import type { SsoNetwork } from './auth/workspace-sso';
import type { BillingProvider } from './billing/stripe-billing';
import type { Clock } from './clock';
import type { Config } from './config';
import type { Database } from './db/client';
import type { ImportJob, JobQueue } from './import/queue';
import type { RenderProgress } from './import/render-progress';
import type { SlideRenderers } from './import/rerender';
import type { Logger } from './logger';
import type { Mailer } from './mail/mailer';
import type { LiveHub } from './realtime/live-hub';
import type { SourceAdapters } from './sources/source-adapter';
import type { BlobStorage } from './storage/blob-storage';
import type { SyncService } from './sync/sync-service';

/** Everything the HTTP layer depends on; injected so tests can build an app in memory. */
export interface AppDeps {
  config: Config;
  db: Database;
  storage: BlobStorage;
  /** Voice and video recordings (BER-116), a store of their own (`MEDIA_DIR`, later R2). */
  media: BlobStorage;
  queue: JobQueue<ImportJob>;
  sources: SourceAdapters;
  /** Microsoft sign-in tokens per user (BER-92). */
  microsoft: MicrosoftTokens;
  /** Connected Nextcloud accounts and their login flows (BER-135). */
  nextcloud: NextcloudAccounts;
  /** Connected Google accounts for Google Drive (BER-119); no tokens without `config.googleDrive`. */
  googleDrive: GoogleTokens;
  clock: Clock;
  log: Logger;
  /** Presence, live cursors and live comments (BER-104); `createApp` makes one when absent. */
  live?: LiveHub;
  /** Automatic updates of link-imported decks (BER-107). */
  sync: SyncService;
  /**
   * Slide images by Office / LibreOffice (BER-94): which renderers this server has, and the
   * progress of background re-renders. Absent → SVG previews only.
   */
  rendering?: { renderers: SlideRenderers; progress: RenderProgress };
  /** Generic OpenID Connect login (BER-129); `null` when OIDC_ISSUER is not set. */
  oidc: OidcClient | null;
  /** "Weiter mit Google" – the OIDC client against accounts.google.com; `null` without GOOGLE_*. */
  google: OidcClient | null;
  /**
   * How organisations' company logins (BER-162) reach their providers and DNS; real network
   * when absent (tests inject fakes).
   */
  ssoNetwork?: SsoNetwork;
  /** Passkey ceremonies; defaults to `@simplewebauthn/server` (tests inject fakes). */
  webauthn?: WebAuthn;
  /** Stripe for the paid plan (BER-152); `null` without `config.billing` (self-hosting). */
  billing: BillingProvider | null;
  /** Invitation mails; without SMTP a `DevMailer` in development, else a `NullMailer`. */
  mailer: Mailer;
  /**
   * The `users.id` of the dev owner (see {@link Config.devOwner}) – only with `auth.devLogin`,
   * else `null`.
   */
  ownerId: string | null;
  /** Setup page (`/einrichtung`); absent → no setup page (most tests). */
  instance?: InstanceControl;
}

export interface InstanceControl {
  /** The process environment: it always wins over settings stored on the setup page. */
  env: NodeJS.ProcessEnv;
  /** Restarts the server so saved settings take effect; `null` → whoever runs it restarts it. */
  restart: (() => void) | null;
}
