import { loginPath } from '@/features/auth/lib/return-to';

/** Typed URL builders – the only place that knows the URL structure. */
export const routes = {
  /** Redirects to the last used workspace (or the onboarding without one). */
  reviews: () => '/',
  workspace: (workspaceId: string) => `/w/${workspaceId}`,
  workspaceSettings: (workspaceId: string) => `/w/${workspaceId}/einstellungen`,
  /** The invitations on the settings page (BER-130). */
  workspaceInvites: (workspaceId: string) => `/w/${workspaceId}/einstellungen#einladen`,
  /** The workspace the new deck goes into rides along as `?workspace=`. */
  newReview: (workspaceId?: string | null) =>
    workspaceId ? `/neu?workspace=${encodeURIComponent(workspaceId)}` : '/neu',
  /** Deep links use the stable slide id, never the slide number (BER-95). */
  deck: (deckId: string, slideId?: string | null) =>
    slideId ? `/d/${deckId}?slide=${encodeURIComponent(slideId)}` : `/d/${deckId}`,
  invite: (token: string) => `/r/${token}`,
  /** Workspace invitation link (BER-129). */
  join: (token: string) => `/join/${token}`,
  login: (returnTo?: string | null) => loginPath(returnTo),
  /** "Konto & Anmeldung": connected logins and passkeys. */
  account: () => '/konto',
  /** Same page as the login – the first login creates the account (BER-130). */
  register: () => '/registrieren',
};

/** Absolute URL for sharing (review links). */
export const absoluteUrl = (path: string) => new URL(path, window.location.origin).toString();

/** The current location as a `returnTo` value. */
export const currentPath = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;
