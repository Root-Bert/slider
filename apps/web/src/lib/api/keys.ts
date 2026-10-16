/** Central query keys, so invalidation stays consistent across features. */
export const queryKeys = {
  me: ['me'] as const,
  decks: ['decks'] as const,
  /** Every workspace's deck list – invalidate this after a deck was created or changed. */
  deckLists: ['decks', 'list'] as const,
  deckList: (workspaceId: string) => ['decks', 'list', workspaceId] as const,
  deck: (deckId: string) => ['decks', deckId] as const,
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
};

/**
 * Login, workspaces, members and invitations (BER-129). The list of the account's workspaces
 * and pending invitations comes with `GET /me`, so mutations that change them reload `me`.
 */
export const workspaceKeys = {
  providers: ['auth', 'providers'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  invites: (workspaceId: string) => ['workspaces', workspaceId, 'invites'] as const,
  join: (token: string) => ['join', token] as const,
  passkeys: ['account', 'passkeys'] as const,
  identities: ['account', 'identities'] as const,
};
