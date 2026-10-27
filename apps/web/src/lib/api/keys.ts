/** Central query keys, so invalidation stays consistent across features. */
export const queryKeys = {
  me: ['me'] as const,
  decks: ['decks'] as const,
  /** Every workspace's deck list – invalidate this after a deck was created or changed. */
  deckLists: ['decks', 'list'] as const,
  deckList: (workspaceId: string) => ['decks', 'list', workspaceId] as const,
  deck: (deckId: string) => ['decks', deckId] as const,
  /** Text search through a workspace's slides and comments (BER-175); under `decks`, so changes refresh it. */
  deckSearch: (workspaceId: string, query: string) =>
    ['decks', 'search', workspaceId, query] as const,
  /** The folders of one workspace – outside `decks`, so deck invalidation leaves them alone. */
  folders: (workspaceId: string) => ['folders', workspaceId] as const,
  slides: (deckId: string) => ['decks', deckId, 'slides'] as const,
  comments: (deckId: string) => ['decks', deckId, 'comments'] as const,
  people: (deckId: string) => ['decks', deckId, 'people'] as const,
  status: (deckId: string) => ['decks', deckId, 'status'] as const,
  revisions: (deckId: string) => ['decks', deckId, 'revisions'] as const,
  /**
   * One revision's diff – it never changes. Fetched by id (never via `latest`), so an entry can
   * never hold another revision's diff, and outside the `revisions` list key so reloading the
   * list doesn't refetch every diff.
   */
  revisionDiff: (deckId: string, revisionId: string | null) =>
    ['decks', deckId, 'revision-diff', revisionId] as const,
  deletedSlides: (deckId: string, revisionId: string | null) =>
    ['decks', deckId, 'deleted-slides', revisionId] as const,
  /** One slide in every revision (Alt/Neu, BER-109) – keyed by the current revision too. */
  slideVersions: (deckId: string, slideId: string, revisionId: string | null) =>
    ['decks', deckId, 'slide-versions', slideId, revisionId] as const,
  /** Stored files of a review and what older versions take up (managers only). */
  storage: (deckId: string) => ['decks', deckId, 'storage'] as const,
  /** Who may open a review (managers only, "Zugriff einschränken …"). */
  access: (deckId: string) => ['decks', deckId, 'access'] as const,
  /** Whether and how a deck can be edited, with its elements (BER-180, managers only). */
  edit: (deckId: string) => ['decks', deckId, 'edit'] as const,
  /**
   * A slide taken apart at an edit step – never changes, so outside the deck's keys: what
   * refreshes the deck (`useLive`) does not ask for it again.
   */
  slideLayers: (deckId: string, slideId: string | null, seq: number | undefined) =>
    ['slideLayers', deckId, slideId, seq] as const,
  /**
   * Stock photos for a search – outside the deck's keys too: every refresh of the deck would
   * search again, and each search counts against the person's limit on the server.
   */
  stockSearch: (deckId: string, query: string, orientation: string) =>
    ['stockSearch', deckId, query, orientation] as const,
  /** The AI's proposals for the deck's slides (BER-183). */
  proposals: (deckId: string) => ['decks', deckId, 'proposals'] as const,
};

/**
 * Login, workspaces, members and invitations (BER-129). The list of the account's workspaces
 * and pending invitations comes with `GET /me`, so mutations that change them reload `me`.
 */
export const workspaceKeys = {
  providers: ['auth', 'providers'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  invites: (workspaceId: string) => ['workspaces', workspaceId, 'invites'] as const,
  /** What happens to someone's reviews if they left now (BER-165). */
  departure: (workspaceId: string, userId: string, successor: string | null) =>
    ['workspaces', workspaceId, 'departure', userId, successor] as const,
  /** Plan, limits, storage and billing of one workspace – the "Nutzung" page (BER-151). */
  usage: (workspaceId: string) => ['workspaces', workspaceId, 'usage'] as const,
  /** The other members online right now (the header's avatars). */
  online: (workspaceId: string) => ['workspaces', workspaceId, 'online'] as const,
  /** Company login of one workspace (BER-162), admins only. */
  sso: (workspaceId: string) => ['workspaces', workspaceId, 'sso'] as const,
  /** The workspace's AI keys (BER-183), admins only. */
  ai: (workspaceId: string) => ['workspaces', workspaceId, 'ai'] as const,
  fonts: (workspaceId: string) => ['workspaces', workspaceId, 'fonts'] as const,
  join: (token: string) => ['join', token] as const,
  passkeys: ['account', 'passkeys'] as const,
  identities: ['account', 'identities'] as const,
  /** Microsoft accounts connected for OneDrive/SharePoint (`GET /me/microsoft`). */
  microsoft: ['account', 'microsoft'] as const,
  /** Nextcloud accounts connected for files (`GET /me/nextcloud`, BER-135). */
  nextcloud: ['account', 'nextcloud'] as const,
  nextcloudSettings: ['nextcloud', 'settings'] as const,
  /** Google accounts connected for Google Drive (`GET /me/google`, BER-119). */
  google: ['account', 'google'] as const,
  /** One folder, "Mit mir geteilt" or a search in the Nextcloud browser. */
  nextcloudListing: (connectionId: string, kind: 'files' | 'shared' | 'search', key: string) =>
    ['nextcloud', connectionId, kind, key] as const,
};
