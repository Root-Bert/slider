import type { MailUnsubscribed, SenderTriage, SenderTriageRead } from '@slider/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { mailKeys } from './mail';
import { senderKeys } from './sender';

/*
 * Sender's start as a to-do list (`/sender/triage`): everything unread in groups – at once as
 * the server sorts it by itself, then as the AI sorts and tells it (a line per item, a sentence
 * per group, one on top). Asked anew when `stamp` changes (something came in or was read);
 * meanwhile the last answer stays on screen. `mailbox`: one mailbox's view („Übersicht“).
 */

const triageKey = (workspaceId: string) => [...senderKeys.all(workspaceId), 'triage'] as const;

function useTriageQuery(workspaceId: string, stamp: string | null, mailbox: string, ai: boolean) {
  return useQuery({
    queryKey: [...triageKey(workspaceId), mailbox, ai, stamp],
    queryFn: () =>
      api.get<SenderTriage>(
        `/workspaces/${workspaceId}/sender/triage?ai=${ai ? 1 : 0}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`,
      ),
    enabled: stamp !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: ai ? false : 3,
  });
}

/**
 * Both answers: `plain` at once, `told` once the AI is through (it takes seconds). Show `told`
 * when it is there and as new as `plain`, else `plain`.
 */
export function useSenderTriage(workspaceId: string, stamp: string | null, mailbox = '') {
  const plain = useTriageQuery(workspaceId, stamp, mailbox, false);
  const told = useTriageQuery(workspaceId, stamp, mailbox, true);
  return { plain, told };
}

type Item = SenderTriageRead['items'][number];
const keyOf = (item: Item) => `${item.kind}:${item.id}`;

/** Every triage on hand without these items: gone at once, whatever the server says after. */
function dropItems(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  items: Item[],
) {
  const gone = new Set(items.map(keyOf));
  queryClient.setQueriesData<SenderTriage>({ queryKey: triageKey(workspaceId) }, (triage) =>
    triage
      ? {
          ...triage,
          groups: triage.groups
            .map((group) => ({
              ...group,
              items: group.items.filter((each) => !gone.has(keyOf(each.item))),
            }))
            .filter((group) => group.items.length > 0),
        }
      : triage,
  );
}

/** What tells the side bar's counts and the mails' list: they change, and so does the stamp. */
const told = (queryClient: ReturnType<typeof useQueryClient>, workspaceId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: mailKeys.threads(workspaceId) }),
  ]);

/** „Gelesen“ / „Alle gelesen“: conversations, agents and mails read at once – gone from the list. */
export function useReadTriage(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: Item[]) =>
      api.post<void>(`/workspaces/${workspaceId}/sender/triage/read`, { items }),
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: triageKey(workspaceId) });
      dropItems(queryClient, workspaceId, items);
    },
    onSettled: () => told(queryClient, workspaceId),
  });
}

/**
 * „Abbestellen“ for newsletters: gone from the list at once; what only a page can do comes back
 * unread (`link`, its page to open) once the server has answered.
 */
export function useUnsubscribeMail(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadIds: string[]) =>
      api.post<MailUnsubscribed[]>(`/workspaces/${workspaceId}/mail/unsubscribe`, { threadIds }),
    onMutate: async (threadIds) => {
      await queryClient.cancelQueries({ queryKey: triageKey(workspaceId) });
      dropItems(
        queryClient,
        workspaceId,
        threadIds.map((id) => ({ kind: 'mail', id })),
      );
    },
    onSettled: () => told(queryClient, workspaceId),
  });
}
