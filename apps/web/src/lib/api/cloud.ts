import {
  type CloudArea,
  type CloudAreaColor,
  type CloudAreaCreate,
  type CloudAreaUpdate,
  type CloudBatchResult,
  type CloudEvent,
  type CloudHome,
  type CloudListing,
  type CloudNode,
  type CloudNodeDetail,
  type CloudOverview,
  type CloudPerson,
  type CloudPublic,
  type CloudScope,
  type CloudSearchResult,
  type CloudShare,
  type CloudShareInput,
  type CloudShareUpdate,
  type CloudFocus,
  type CloudSummary,
  type CloudVersion,
  type Comment,
  type Deck,
  type Slide,
} from '@slider/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';
import { SIGNED_URL_STALE_MS } from './revisions';

/**
 * Cloud – the workspace's files. Everything of one workspace lives under `['cloud', id]`, so a
 * change (an upload, a move, a share) refreshes every list of it at once; what the change itself
 * tells – a new name, a pin, a row gone – is written into the lists right away, before the
 * server answers.
 */

export const cloudKeys = {
  all: (workspaceId: string) => ['cloud', workspaceId] as const,
  home: (workspaceId: string) => ['cloud', workspaceId, 'home'] as const,
  lists: (workspaceId: string) => ['cloud', workspaceId, 'nodes'] as const,
  list: (workspaceId: string, place: CloudPlace) =>
    ['cloud', workspaceId, 'nodes', place.scope, place.folder ?? place.area ?? ''] as const,
  node: (workspaceId: string, nodeId: string) => ['cloud', workspaceId, 'node', nodeId] as const,
  nodes: (workspaceId: string) => ['cloud', workspaceId, 'node'] as const,
  search: (workspaceId: string, query: string, filter: CloudSearchFilter = {}) =>
    [
      'cloud',
      workspaceId,
      'search',
      filter.in ?? 'name',
      filter.area ?? '',
      filter.owner ?? '',
      query,
    ] as const,
  activity: (workspaceId: string, areaId: string | null) =>
    ['cloud', workspaceId, 'activity', areaId ?? ''] as const,
  people: (workspaceId: string) => ['cloud', workspaceId, 'people'] as const,
  overview: (workspaceId: string) => ['cloud', workspaceId, 'overview'] as const,
  public: (token: string, nodeId: string | null) => ['cloud-public', token, nodeId ?? ''] as const,
};

/** Which list: a folder, an area's top, one's own top – or one across folders. */
export interface CloudPlace {
  scope: CloudScope;
  folder?: string;
  area?: string;
}

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/cloud`;
const queryOf = (values: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
};

// ── Reading ─────────────────────────────────────────────────────────────────

/** Areas, counts and the storage bar – what the shell shows on every page. */
export const useCloudHome = (workspaceId: string) =>
  useQuery({
    queryKey: cloudKeys.home(workspaceId),
    queryFn: () => api.get<CloudHome>(base(workspaceId)),
    enabled: workspaceId !== '',
    staleTime: 15_000,
  });

/** One list – for `useQuery`, or several side by side with `useQueries` (the columns). */
export const cloudListQuery = (workspaceId: string, place: CloudPlace) => ({
  queryKey: cloudKeys.list(workspaceId, place),
  queryFn: () =>
    api.get<CloudListing>(
      `${base(workspaceId)}/nodes${queryOf({ scope: place.scope, folder: place.folder, area: place.area })}`,
    ),
  // Others work here too: what they change shows without a reload.
  refetchInterval: 30_000,
});

export const useCloudList = (workspaceId: string, place: CloudPlace, enabled = true) =>
  useQuery({ ...cloudListQuery(workspaceId, place), enabled });

export const useCloudNode = (workspaceId: string, nodeId: string | null) =>
  useQuery({
    queryKey: cloudKeys.node(workspaceId, nodeId ?? ''),
    queryFn: () => api.get<CloudNodeDetail>(`/cloud/nodes/${encodeURIComponent(nodeId ?? '')}`),
    enabled: Boolean(nodeId),
  });

/** The search by name, or (`within: 'text'`) in what the files say. */
/** Where the search looks, and what narrows it: the page's „Ort“ and „Von“. */
export interface CloudSearchFilter {
  in?: 'name' | 'text' | 'all';
  /** An area's id, `own` or `shared`. */
  area?: string;
  /** Whose it is (a user id). */
  owner?: string;
}

export const useCloudSearch = (
  workspaceId: string,
  query: string,
  filter: CloudSearchFilter = {},
) =>
  useQuery({
    queryKey: cloudKeys.search(workspaceId, query, filter),
    queryFn: () =>
      api.get<CloudSearchResult>(
        `${base(workspaceId)}/search${queryOf({ q: query, in: filter.in ?? 'name', area: filter.area, owner: filter.owner })}`,
      ),
    enabled: query.trim().length > 0,
    placeholderData: keepPreviousData,
    // Files not read yet are read on with each asking.
    refetchInterval: (state) => (state.state.data?.pending ? 1500 : false),
  });

export const useCloudActivity = (workspaceId: string, areaId: string | null, enabled = true) =>
  useQuery({
    queryKey: cloudKeys.activity(workspaceId, areaId),
    queryFn: () =>
      api.get<CloudEvent[]>(
        `${base(workspaceId)}/activity${queryOf({ area: areaId ?? undefined })}`,
      ),
    enabled,
    refetchInterval: 30_000,
  });

/**
 * „Seit deinem letzten Besuch“ on Cloud's start: slow (the AI), so asked only while the page is
 * open and anew only when `stamp` changes (something came in, was read or happened to the files);
 * meanwhile the last answer stays. Outside `['cloud', id]`: a file's change elsewhere is not news
 * to ask the AI again for.
 */
export const useCloudSummary = (workspaceId: string, since: string | null, stamp: string | null) =>
  useQuery({
    queryKey: ['cloud-summary', workspaceId, since, stamp],
    queryFn: () =>
      api.get<CloudSummary>(
        `${base(workspaceId)}/summary${queryOf({ since: since ?? undefined })}`,
      ),
    enabled: stamp !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });

/**
 * „Für dich“ on Cloud's start: what waits for the person across the apps. `plain` at once (and
 * every minute: to-dos, comments and shares change without telling), `told` by the AI for exactly
 * those entries – asked anew when they change; the server answers from its last look while only
 * some went.
 */
export function useCloudFocus(workspaceId: string, stamp: string | null) {
  const plain = useQuery({
    queryKey: ['cloud-focus', workspaceId, false, stamp],
    queryFn: () => api.get<CloudFocus>(`${base(workspaceId)}/focus?ai=0`),
    enabled: stamp !== null,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Back on the page after dealing with a row: asked anew, so it goes at once.
    refetchOnMount: 'always',
  });
  const entries = plain.data?.items.map((item) => `${item.key}@${item.at ?? ''}`).join(',');
  const told = useQuery({
    queryKey: ['cloud-focus', workspaceId, true, entries],
    queryFn: () => api.get<CloudFocus>(`${base(workspaceId)}/focus?ai=1`),
    enabled: entries !== undefined && (plain.data?.items.length ?? 0) > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  return { plain, told };
}

export const useCloudPeople = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: cloudKeys.people(workspaceId),
    queryFn: () => api.get<CloudPerson[]>(`${base(workspaceId)}/people`),
    enabled,
    staleTime: 60_000,
  });

export const useCloudOverview = (workspaceId: string) =>
  useQuery({
    queryKey: cloudKeys.overview(workspaceId),
    queryFn: () => api.get<CloudOverview>(`${base(workspaceId)}/overview`),
  });

/** What a link shows to someone outside. */
export const useCloudPublic = (token: string, nodeId: string | null) =>
  useQuery({
    queryKey: cloudKeys.public(token, nodeId),
    queryFn: () =>
      api.get<CloudPublic>(
        `/cloud/public/${encodeURIComponent(token)}${queryOf({ node: nodeId ?? undefined })}`,
      ),
    retry: false,
    placeholderData: keepPreviousData,
  });

// ── Changing ────────────────────────────────────────────────────────────────

/** Writes into every loaded list of the workspace what a change means for its rows. */
function useListPatch(workspaceId: string) {
  const queryClient = useQueryClient();
  return {
    queryClient,
    /** `change` returns the row as it is now, or `null` to take it out of the list. */
    patch: (change: (node: CloudNode) => CloudNode | null) =>
      queryClient.setQueriesData<CloudListing>(
        { queryKey: cloudKeys.lists(workspaceId) },
        (list) =>
          list ? { ...list, nodes: list.nodes.flatMap((node) => change(node) ?? []) } : list,
      ),
    refresh: () => queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) }),
    /** After the trash: a presentation goes and comes with its file, in Slider's lists too. */
    refreshTrash: () => {
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      return queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
    },
  };
}

export function useCreateCloudFolder(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (input: {
      name: string;
      /** A name already there is counted on instead of refused. */
      numbered?: boolean;
      parentId?: string | null;
      areaId?: string | null;
    }) => api.post<CloudNode>(`${base(workspaceId)}/folders`, input),
    onSuccess: refresh,
  });
}

export function useRenameCloudNode(workspaceId: string) {
  const { patch, refresh, queryClient } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<CloudNode>(`/cloud/nodes/${id}`, { name }),
    onMutate: ({ id, name }) => {
      patch((node) => (node.id === id ? { ...node, name } : node));
      // The file open over the list shows its name too.
      queryClient.setQueryData<CloudNodeDetail>(cloudKeys.node(workspaceId, id), (detail) =>
        detail ? { ...detail, node: { ...detail.node, name } } : detail,
      );
    },
    onSettled: refresh,
  });
}

/** „Anpinnen“ / „Lösen“: a folder in the side bar – shown at once, the side bar follows. */
export function usePinCloudNode(workspaceId: string) {
  const { patch, refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.put<CloudNode>(`/cloud/nodes/${id}/pin`, { pinned }),
    onMutate: ({ id, pinned }) => patch((node) => (node.id === id ? { ...node, pinned } : node)),
    onSettled: refresh,
  });
}

/** A folder's colour – shown at once. */
export function useColorCloudNode(workspaceId: string) {
  const { patch, refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: ({ id, color }: { id: string; color: CloudAreaColor | null }) =>
      api.put<CloudNode>(`/cloud/nodes/${id}/color`, { color }),
    onMutate: ({ id, color }) => patch((node) => (node.id === id ? { ...node, color } : node)),
    onSettled: refresh,
  });
}

type Target = { parentId?: string | null; areaId?: string | null };

/** Moved: the rows leave the folder's list they were in at once, the answer brings the rest. */
export function useMoveCloudNodes(workspaceId: string) {
  const { refresh, queryClient } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (input: { ids: string[] } & Target) =>
      api.post<CloudBatchResult>('/cloud/nodes/move', input),
    onMutate: ({ ids, parentId, areaId }) => {
      const to = parentId ?? areaId ?? '';
      queryClient.setQueriesData<CloudListing>(
        {
          // Only a folder's (or an area's, or one's own top's) list – „Zuletzt“ keeps its rows.
          predicate: ({ queryKey }) =>
            queryKey[0] === 'cloud' &&
            queryKey[1] === workspaceId &&
            queryKey[2] === 'nodes' &&
            queryKey[3] === 'folder' &&
            queryKey[4] !== to,
        },
        (list) =>
          list ? { ...list, nodes: list.nodes.filter((node) => !ids.includes(node.id)) } : list,
      );
    },
    onSettled: refresh,
  });
}

export function useCopyCloudNodes(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (input: { ids: string[] } & Target) =>
      api.post<CloudBatchResult>('/cloud/nodes/copy', input),
    onSettled: refresh,
  });
}

/** Into „Gelöscht“ – the rows leave their lists at once. */
export function useTrashCloudNodes(workspaceId: string) {
  const { patch, refreshTrash } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/trash', { ids }),
    onMutate: (ids) => patch((node) => (ids.includes(node.id) ? null : node)),
    onSettled: refreshTrash,
  });
}

export function useRestoreCloudNodes(workspaceId: string) {
  const { patch, refreshTrash } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) => api.post<CloudBatchResult>('/cloud/nodes/restore', { ids }),
    onMutate: (ids) => patch((node) => (ids.includes(node.id) && node.deleted ? null : node)),
    onSettled: refreshTrash,
  });
}

export function usePurgeCloudNodes(workspaceId: string) {
  const { patch, refreshTrash } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (ids: string[]) =>
      api.post<CloudBatchResult & { purged: string[] }>('/cloud/nodes/purge', { ids }),
    onMutate: (ids) => patch((node) => (ids.includes(node.id) && node.deleted ? null : node)),
    onSettled: refreshTrash,
  });
}

export function useEmptyCloudTrash(workspaceId: string) {
  const { refreshTrash } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: () =>
      api.post<{ purged: number; skipped: CloudBatchResult['skipped'] }>(
        `${base(workspaceId)}/trash/empty`,
        {},
      ),
    onSettled: refreshTrash,
  });
}

// ── Areas ───────────────────────────────────────────────────────────────────

export function useCreateCloudArea(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (input: CloudAreaCreate) =>
      api.post<CloudArea>(`${base(workspaceId)}/areas`, input),
    onSuccess: refresh,
  });
}

export function useUpdateCloudArea(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: ({ id, ...input }: CloudAreaUpdate & { id: string }) =>
      api.patch<CloudArea>(`/cloud/areas/${id}`, input),
    onSuccess: refresh,
  });
}

export function useDeleteCloudArea(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/cloud/areas/${id}`),
    onSuccess: refresh,
  });
}

export function useSetCloudAreaMembers(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: ({
      id,
      members,
    }: {
      id: string;
      members: { userId: string; title: string | null }[];
    }) => api.put<CloudArea>(`/cloud/areas/${id}/members`, { members }),
    onSuccess: refresh,
  });
}

// ── Sharing, versions ───────────────────────────────────────────────────────

/**
 * Who something is shared with shows at once, in every open view of it: `change` makes the
 * shares of a file or folder as they are after the step. Answers how to take it back, should
 * the server refuse.
 */
function useSharesPatch(workspaceId: string) {
  const { refresh, queryClient } = useListPatch(workspaceId);
  const patch = (change: (shares: CloudShare[], nodeId: string) => CloudShare[]) => {
    const before = queryClient.getQueriesData<CloudNodeDetail>({
      queryKey: cloudKeys.nodes(workspaceId),
    });
    queryClient.setQueriesData<CloudNodeDetail>(
      { queryKey: cloudKeys.nodes(workspaceId) },
      (detail) => (detail ? { ...detail, shares: change(detail.shares, detail.node.id) } : detail),
    );
    return () => {
      for (const [key, detail] of before) queryClient.setQueryData(key, detail);
    };
  };
  return { patch, refresh, queryClient };
}

/** `shown`: the share as it will look (a person's) – listed at once, the server's follows. */
export function useCreateCloudShare(workspaceId: string) {
  const { patch, refresh, queryClient } = useSharesPatch(workspaceId);
  return useMutation({
    mutationFn: ({
      nodeId,
      shown: _shown,
      ...input
    }: CloudShareInput & { nodeId: string; shown?: CloudShare }) =>
      api.post<CloudShare>(`/cloud/nodes/${nodeId}/shares`, input),
    onMutate: async ({ nodeId, shown }) => {
      if (!shown) return undefined;
      await queryClient.cancelQueries({ queryKey: cloudKeys.nodes(workspaceId) });
      return patch((shares, id) => (id === nodeId ? [...shares, shown] : shares));
    },
    onError: (_error, _input, undo) => undo?.(),
    onSettled: refresh,
  });
}

export function useUpdateCloudShare(workspaceId: string) {
  const { patch, refresh, queryClient } = useSharesPatch(workspaceId);
  return useMutation({
    mutationFn: ({ id, ...input }: CloudShareUpdate & { id: string }) =>
      api.patch<CloudShare>(`/cloud/shares/${id}`, input),
    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: cloudKeys.nodes(workspaceId) });
      return patch((shares) =>
        shares.map((share) => (share.id === id ? { ...share, ...input } : share)),
      );
    },
    onError: (_error, _input, undo) => undo?.(),
    onSettled: refresh,
  });
}

export function useRemoveCloudShare(workspaceId: string) {
  const { patch, refresh, queryClient } = useSharesPatch(workspaceId);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/cloud/shares/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: cloudKeys.nodes(workspaceId) });
      return patch((shares) => shares.filter((share) => share.id !== id));
    },
    onError: (_error, _input, undo) => undo?.(),
    onSettled: refresh,
  });
}

export function useRestoreCloudVersion(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (versionId: string) =>
      api.post<CloudNode>(`/cloud/versions/${versionId}/restore`, {}),
    onSuccess: refresh,
  });
}

export function useLabelCloudVersion(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string | null }) =>
      api.patch<CloudVersion>(`/cloud/versions/${id}`, { label }),
    onSuccess: refresh,
  });
}

export function useDeleteCloudVersion(workspaceId: string) {
  const { refresh } = useListPatch(workspaceId);
  return useMutation({
    mutationFn: (versionId: string) => api.delete(`/cloud/versions/${versionId}`),
    onSuccess: refresh,
  });
}

/** A file opened in Slider: a presentation made of it (or the one that was made of it before). */
export function usePresentCloudNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const deck = await api.post<Deck>(`/cloud/nodes/${nodeId}/present`, {});
      await warmDeck(queryClient, deck);
      return deck;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['decks', 'list'] }),
  });
}

/** How long „Öffnen“ (already showing that it loads) waits at most for what the viewer needs. */
const WARM_MS = 1500;
/** Slides whose pictures are loaded before: what the viewer shows first. */
const WARM_PICTURES = 3;

/**
 * A ready presentation's deck, slides and comments put in the cache – as `useDeck`, `useSlides`,
 * `useComments` ask for them – and its first slides' pictures loaded, before it opens: the viewer
 * then stands at once with its slides, not after a spinner and empty frames. Waits at most
 * {@link WARM_MS}; whatever is not there by then comes as before.
 */
async function warmDeck(queryClient: QueryClient, deck: Deck): Promise<void> {
  if (deck.import.status !== 'ready') return;
  const id = deck.id;
  const work = Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.deck(id),
      queryFn: () => api.get<Deck>(`/decks/${id}`),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.comments(id),
      queryFn: () => api.get<Comment[]>(`/decks/${id}/comments`),
    }),
    queryClient
      .fetchQuery({
        queryKey: queryKeys.slides(id),
        queryFn: () => api.get<Slide[]>(`/decks/${id}/slides`),
        staleTime: SIGNED_URL_STALE_MS,
      })
      .then((slides) => {
        // The strip's small pictures on their way too, not waited for.
        for (const slide of slides) new Image().src = slide.thumbnailUrl;
        return Promise.allSettled(
          slides
            .filter((slide) => !slide.hidden)
            .slice(0, WARM_PICTURES)
            .flatMap((slide) => [
              // What the stage shows first (`SwapImage`'s `initialSrc`), then what it takes from
              // the two sizes (`slideSrcSet`) at about its width.
              decoded(slide.thumbnailUrl),
              slide.thumbnailUrl === slide.imageUrl
                ? null
                : decoded(slide.imageUrl, `${slide.thumbnailUrl} 1280w, ${slide.imageUrl} 3840w`),
            ]),
        );
      }),
  ]).catch(() => {});
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, WARM_MS))]);
}

/** A picture loaded and decoded – of `srcSet` the one the browser takes at half the window. */
function decoded(src: string, srcSet?: string): Promise<void> {
  const picture = new Image();
  if (srcSet) {
    picture.sizes = '50vw';
    picture.srcset = srcSet;
  }
  picture.src = src;
  return picture.decode();
}
