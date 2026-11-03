import { loginPath } from './return-to';

/** Typed URL builders – the only place that knows the URL structure. */
export const routes = {
  /** Redirects to the last used workspace (or the onboarding without one). */
  reviews: () => '/',
  workspace: (workspaceId: string) => `/w/${workspaceId}`,
  /**
   * "Bibliothek" next to "Projekte": the workspace's material – fonts, slide masters – with the
   * filter shown as `?filter=` (none: the one last shown).
   */
  workspaceMaterial: (workspaceId: string, filter?: string) =>
    filter
      ? `/w/${workspaceId}/material?filter=${encodeURIComponent(filter)}`
      : `/w/${workspaceId}/material`,
  /** „Neues Asset“: a template to design in the editor, or templates and fonts to upload. */
  newMaterial: (workspaceId: string) => `/w/${workspaceId}/material/neu`,
  /** One uploaded design with all its layouts. */
  workspaceMaster: (workspaceId: string, masterId: string) =>
    `/w/${workspaceId}/material/vorlagen/${masterId}`,
  workspaceSettings: (workspaceId: string) => `/w/${workspaceId}/einstellungen`,
  /** The settings' second tab, „Integrationen“: the workspace's AI – keys, model, its name (admins). */
  workspaceIntegrations: (workspaceId: string) => `/w/${workspaceId}/einstellungen/integrationen`,
  /** The invitations on the settings page (BER-130). */
  workspaceInvites: (workspaceId: string) => `/w/${workspaceId}/einstellungen#einladen`,
  /** The workspace the new deck goes into rides along as `?workspace=`. */
  newReview: (workspaceId?: string | null) =>
    workspaceId ? `/neu?workspace=${encodeURIComponent(workspaceId)}` : '/neu',
  /** Deep links use the stable slide id, never the slide number (BER-95). */
  deck: (deckId: string, slideId?: string | null) =>
    slideId ? `/d/${deckId}?slide=${encodeURIComponent(slideId)}` : `/d/${deckId}`,
  /** Workspace invitation link (BER-129). */
  join: (token: string) => `/join/${token}`,
  login: (returnTo?: string | null) => loginPath(returnTo),
  /** "Konto & Anmeldung": connected logins and passkeys. */
  account: () => '/konto',
  /** "Einstellungen": your colour and how decks open – kept apart from the account. */
  preferences: () => '/einstellungen',
  /** "Nutzung": plan, limits, storage and billing of a workspace (BER-151..155). */
  usage: (workspaceId?: string | null) =>
    workspaceId ? `/nutzung?workspace=${encodeURIComponent(workspaceId)}` : '/nutzung',
  /** Logins, mail and sign-up of a self-hosted instance (instance admin). */
  setup: () => '/einrichtung',
  /** The instance admin's dashboard: numbers, workspaces, accounts (BER-167). */
  instance: () => '/instanz',
  /** Privacy policy and imprint of the instance (BER-141). */
  privacy: () => '/datenschutz',
  imprint: () => '/impressum',
  /** Ask for a copy or deletion of one's data without login (BER-146). */
  dataRequestForm: () => '/datenanfrage',
  /** Same page as the login – the first login creates the account (BER-130). */
  register: () => '/registrieren',
};

/** The current location as a `returnTo` value. */
export const currentPath = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;
