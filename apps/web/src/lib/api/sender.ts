import {
  API_PREFIX,
  mentionsIn,
  type AccountAuthor,
  type SenderChannel,
  type SenderChannelAgent,
  type SenderCreateGroup,
  type SenderEvent,
  type SenderHome,
  type Attachment,
  type SenderMessage,
  type SenderMessagePage,
  type SenderPin,
  type SenderUpdateChannel,
  type MailThread,
  type MailThreadSummary,
} from '@slider/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api, apiRequest } from '../api-client';
import { cloudAgentKeys } from './cloud-agents';
import { mailChanged, mailKeys } from './mail';
import { todosChanged } from './todos';
import { calendarChanged } from './calendar';

/*
 * „Sender“: the workspace's conversations. The side bar (`useSenderHome`) and an open
 * conversation (`useSenderMessages`) are kept up to date by the live stream (`useSenderLive`);
 * what one writes stands at once (`usePostSenderMessage`) and is swapped for the server's when
 * it comes back.
 */

/** Without the stream (it is down), the side bar asks again this often. */
const HOME_MS = 30_000;
/** A person writing says so this often at most. */
const TYPING_MS = 2500;
const RECONNECT_MS = 4000;

export const senderKeys = {
  all: (workspaceId: string) => ['sender', workspaceId] as const,
  home: (workspaceId: string) => ['sender', workspaceId, 'home'] as const,
  messages: (workspaceId: string, channelId: string) =>
    ['sender', workspaceId, 'messages', channelId] as const,
};

type Pages = InfiniteData<SenderMessagePage, number | null>;

export function useSenderHome(workspaceId: string) {
  return useQuery({
    queryKey: senderKeys.home(workspaceId),
    queryFn: () => api.get<SenderHome>(`/workspaces/${workspaceId}/sender`),
    refetchInterval: HOME_MS,
  });
}

/** A conversation, the latest page first; older ones come with `fetchNextPage`. */
export function useSenderMessages(workspaceId: string, channelId: string) {
  return useInfiniteQuery({
    queryKey: senderKeys.messages(workspaceId, channelId),
    queryFn: ({ pageParam }) =>
      api.get<SenderMessagePage>(
        `/sender/channels/${channelId}/messages${pageParam === null ? '' : `?before=${pageParam}`}`,
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.more ? (last.messages[0]?.seq ?? null) : null),
    // The stream keeps it current; asked again only when one comes back to it.
    staleTime: Infinity,
  });
}

/** Every message of the pages in order, the oldest first. */
export const messagesOf = (
  data: InfiniteData<SenderMessagePage, unknown> | undefined,
): SenderMessage[] => (data ? [...data.pages].reverse().flatMap((page) => page.messages) : []);

/** Puts a message into the open conversation – a new one at the end, a known one in its place. */
function placeMessage(
  queryClient: QueryClient,
  workspaceId: string,
  channelId: string,
  message: SenderMessage,
  replaces?: string,
) {
  queryClient.setQueryData<Pages>(senderKeys.messages(workspaceId, channelId), (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((each) => {
        if (each.id !== message.id && each.id !== replaces) return each;
        found = true;
        return message;
      }),
    }));
    if (!found) {
      const [latest, ...older] = pages;
      if (!latest) return data;
      // Already there by the stream while one's own came back: once only.
      return {
        ...data,
        pages: [{ ...latest, messages: [...latest.messages, message] }, ...older],
      };
    }
    return { ...data, pages };
  });
}

const PENDING = 'pending:';
export const isPending = (message: SenderMessage) => message.id.startsWith(PENDING);

/** What one writes stands at once; refused, it goes again and the text comes back. */
export function usePostSenderMessage(workspaceId: string, channelId: string, me: AccountAuthor) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      text,
      attachments = [],
    }: {
      text: string;
      attachments?: Attachment[];
      pendingId: string;
    }) =>
      api.post<SenderMessage>(`/sender/channels/${channelId}/messages`, {
        text,
        attachments: attachments.map((one) => one.id),
      }),
    onMutate: ({ text, attachments, pendingId }) => {
      placeMessage(queryClient, workspaceId, channelId, {
        id: pendingId,
        seq: Number.MAX_SAFE_INTEGER,
        author: me,
        agent: null,
        text,
        attachments,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      });
    },
    onSuccess: (message, { pendingId }) => {
      // The stream may have brought it already: then the pending one simply goes.
      queryClient.setQueryData<Pages>(senderKeys.messages(workspaceId, channelId), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                messages: page.messages.filter(
                  (each) => each.id !== message.id || each.id === pendingId,
                ),
              })),
            }
          : data,
      );
      placeMessage(queryClient, workspaceId, channelId, message, pendingId);
      bumpChannel(queryClient, workspaceId, channelId, message.createdAt);
    },
    onError: (_error, { pendingId }) => {
      queryClient.setQueryData<Pages>(senderKeys.messages(workspaceId, channelId), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                messages: page.messages.filter((each) => each.id !== pendingId),
              })),
            }
          : data,
      );
    },
  });
}

export const newPendingId = () => `${PENDING}${crypto.randomUUID()}`;

export function useEditSenderMessage(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string; before: SenderMessage }) =>
      api.patch<SenderMessage>(`/sender/messages/${id}`, { text }),
    onMutate: ({ before, text }) =>
      placeMessage(queryClient, workspaceId, channelId, {
        ...before,
        text,
        editedAt: new Date().toISOString(),
      }),
    onSuccess: (message) => placeMessage(queryClient, workspaceId, channelId, message),
    onError: (_error, { before }) => placeMessage(queryClient, workspaceId, channelId, before),
  });
}

export function useDeleteSenderMessage(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (before: SenderMessage) =>
      api.delete(`/sender/messages/${before.id}`).then(() => before),
    onMutate: (before) =>
      placeMessage(queryClient, workspaceId, channelId, { ...before, text: '', deleted: true }),
    onError: (_error, before) => placeMessage(queryClient, workspaceId, channelId, before),
  });
}

/** Sets a conversation's count in the side bar (`unread`) and moves it up when written in. */
function patchChannel(
  queryClient: QueryClient,
  workspaceId: string,
  channelId: string,
  change: (channel: SenderChannel) => SenderChannel,
) {
  queryClient.setQueryData<SenderHome>(senderKeys.home(workspaceId), (home) => {
    if (!home) return home;
    const each = (list: SenderChannel[]) =>
      list.map((channel) => (channel.id === channelId ? change(channel) : channel));
    return {
      ...home,
      areas: home.areas.map((area) => ({ ...area, channels: each(area.channels) })),
      groups: each(home.groups),
      direct: each(home.direct),
    };
  });
}

function bumpChannel(queryClient: QueryClient, workspaceId: string, channelId: string, at: string) {
  patchChannel(queryClient, workspaceId, channelId, (channel) => ({ ...channel, updatedAt: at }));
}

const readAt = new Map<string, number>();
/** The caller read a conversation up to `seq`: its count goes at once. */
export function useReadSenderChannel(workspaceId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (channelId: string, seq: number) => {
      patchChannel(queryClient, workspaceId, channelId, (channel) =>
        channel.unread === 0 && !channel.mentioned
          ? channel
          : { ...channel, unread: 0, mentioned: false },
      );
      if ((readAt.get(channelId) ?? 0) >= seq) return;
      readAt.set(channelId, seq);
      void api.post(`/sender/channels/${channelId}/read`, { seq }).catch(() => {
        readAt.delete(channelId);
      });
    },
    [queryClient, workspaceId],
  );
}

const typingAt = new Map<string, number>();
/** Says that one is writing – the others see it for a moment. Nothing waits for it. */
export function tellTypingInSender(channelId: string) {
  const now = Date.now();
  if (now - (typingAt.get(channelId) ?? 0) < TYPING_MS) return;
  typingAt.set(channelId, now);
  void api.post(`/sender/channels/${channelId}/typing`, {}).catch(() => {});
}

function useHomeChange<TInput, TResult>(
  workspaceId: string,
  run: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) }),
  });
}

export const useCreateSenderGroup = (workspaceId: string) =>
  useHomeChange(workspaceId, (input: SenderCreateGroup) =>
    api.post<SenderChannel>(`/workspaces/${workspaceId}/sender/groups`, input),
  );

export const useOpenSenderDirect = (workspaceId: string) =>
  useHomeChange(workspaceId, (userId: string) =>
    api.post<SenderChannel>(`/workspaces/${workspaceId}/sender/direct`, { userId }),
  );

export function useUpdateSenderChannel(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SenderUpdateChannel) =>
      api.patch<SenderChannel>(`/sender/channels/${channelId}`, input),
    onMutate: (input) =>
      patchChannel(queryClient, workspaceId, channelId, (channel) => ({
        ...channel,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
      })),
    onSuccess: (channel) => channelCame(queryClient, workspaceId, channel),
    onError: () => queryClient.invalidateQueries({ queryKey: senderKeys.all(workspaceId) }),
  });
}

/** The server's copy of a conversation, into the side bar and its page. */
function channelCame(queryClient: QueryClient, workspaceId: string, channel: SenderChannel) {
  patchChannel(queryClient, workspaceId, channel.id, () => channel);
  queryClient.setQueryData<Pages>(senderKeys.messages(workspaceId, channel.id), (data) =>
    data ? { ...data, pages: data.pages.map((page) => ({ ...page, channel })) } : data,
  );
}

/**
 * „Agent hinzufügen“: one picked stands there at once; none picked (`agent` left out), a new one
 * is made – it stands there once the server made it, and the agents list learns of it.
 */
export function useAddSenderAgent(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agent }: { agent?: SenderChannelAgent }) =>
      api.post<SenderChannel>(
        `/sender/channels/${channelId}/agents`,
        agent ? { agentId: agent.id } : {},
      ),
    onMutate: ({ agent }) => {
      if (agent)
        patchChannel(queryClient, workspaceId, channelId, (channel) => ({
          ...channel,
          agents: channel.agents.some((each) => each.id === agent.id)
            ? channel.agents
            : [...channel.agents, agent],
        }));
    },
    onSuccess: (channel, { agent }) => {
      channelCame(queryClient, workspaceId, channel);
      if (!agent)
        void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: senderKeys.all(workspaceId) }),
  });
}

/** „Entfernen“: an added agent goes out of the conversation at once – it stays. */
export function useRemoveSenderAgent(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      apiRequest<SenderChannel>(`/sender/channels/${channelId}/agents/${agentId}`, {
        method: 'DELETE',
      }),
    onMutate: (agentId) =>
      patchChannel(queryClient, workspaceId, channelId, (channel) => ({
        ...channel,
        agents: channel.agents.filter((each) => each.id !== agentId),
      })),
    onSuccess: (channel) => channelCame(queryClient, workspaceId, channel),
    onError: () => queryClient.invalidateQueries({ queryKey: senderKeys.all(workspaceId) }),
  });
}

/**
 * „Anpinnen“ / „Lösen“ a chat (a conversation, an agent) or a mail: it moves to the top of its
 * list – or back – at once; refused, it goes back and the caller says why.
 */
export function usePinSender(workspaceId: string) {
  const queryClient = useQueryClient();
  const place = ({ kind, id }: SenderPin, pinnedAt: string | null) => {
    if (kind === 'channel') {
      patchChannel(queryClient, workspaceId, id, (channel) => ({ ...channel, pinnedAt }));
    } else if (kind === 'agent') {
      queryClient.setQueryData<SenderHome>(
        senderKeys.home(workspaceId),
        (home) =>
          home && {
            ...home,
            agents: home.agents.map((each) => (each.id === id ? { ...each, pinnedAt } : each)),
          },
      );
    } else {
      queryClient.setQueriesData<MailThreadSummary[]>(
        { queryKey: mailKeys.threads(workspaceId) },
        (list) => list?.map((each) => (each.id === id ? { ...each, pinnedAt } : each)),
      );
      // The open mail's menu says it too.
      queryClient.setQueryData<MailThread>(
        mailKeys.thread(workspaceId, id),
        (thread) => thread && { ...thread, pinnedAt },
      );
    }
  };
  const listOf = (input: SenderPin) =>
    input.kind === 'mail' ? mailKeys.threads(workspaceId) : senderKeys.home(workspaceId);
  const mutationKey = ['sender-pin', workspaceId];
  return useMutation({
    mutationKey,
    // One after another, in the order picked: the last one stays on the server too.
    scope: { id: `sender-pin:${workspaceId}` },
    mutationFn: (input: SenderPin) => api.post<{ pinnedAt: string | null }>('/sender/pins', input),
    onMutate: async (input) => {
      // A list on its way from before the pin would put the row back where it was.
      await queryClient.cancelQueries({ queryKey: listOf(input) });
      place(input, input.pinned ? new Date().toISOString() : null);
    },
    // Pinned and loosened again at once: the first answer would undo the second pick.
    onSuccess: ({ pinnedAt }, input) => {
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      place(input, pinnedAt);
    },
    onError: (_error, input) => void queryClient.invalidateQueries({ queryKey: listOf(input) }),
  });
}

export const useDeleteSenderChannel = (workspaceId: string) =>
  useHomeChange(workspaceId, (channelId: string) => api.delete(`/sender/channels/${channelId}`));

export const useLeaveSenderGroup = (workspaceId: string) =>
  useHomeChange(workspaceId, (channelId: string) =>
    api.delete(`/sender/channels/${channelId}/members/me`),
  );

export function useAddToSenderGroup(workspaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api.post<SenderChannel>(`/sender/channels/${channelId}/members`, { userIds }),
    onSuccess: (channel) =>
      queryClient.setQueryData<Pages>(senderKeys.messages(workspaceId, channelId), (data) =>
        data ? { ...data, pages: data.pages.map((page) => ({ ...page, channel })) } : data,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) }),
  });
}

/**
 * The workspace's live stream while Sender is open: new and changed messages go into the
 * conversations kept, counts into the side bar; typing goes to `onTyping`.
 */
export function useSenderLive(
  workspaceId: string,
  {
    openChannel,
    me,
    onTyping,
    onMessage,
  }: {
    /** The conversation on screen: new messages there are read, not counted. */
    openChannel: () => string | null;
    /** One's own messages (from another tab or device) are not counted. */
    me: () => AccountAuthor | null;
    onTyping: (channelId: string, author: AccountAuthor) => void;
    /** A new message, once the side bar counts it; `open`: it came into the one on screen. */
    onMessage: (channelId: string, message: SenderMessage, open: boolean) => void;
  },
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let source: EventSource | null = null;
    let timer = 0;
    let closed = false;
    let down = false;
    const onEvent = (event: SenderEvent) => {
      switch (event.type) {
        case 'message': {
          const kept = queryClient.getQueryData<Pages>(
            senderKeys.messages(workspaceId, event.channelId),
          );
          if (kept) placeMessage(queryClient, workspaceId, event.channelId, event.message);
          const open = openChannel() === event.channelId && document.visibilityState === 'visible';
          const self = me();
          const mine = !event.message.agent && event.message.author?.id === self?.id;
          const named = !!self && mentionsIn(event.message.text, [self]).length > 0;
          patchChannel(queryClient, workspaceId, event.channelId, (channel) => ({
            ...channel,
            updatedAt: event.message.createdAt,
            unread: open || mine ? 0 : channel.unread + 1,
            mentioned: open || mine ? false : channel.mentioned || named,
          }));
          onMessage(event.channelId, event.message, open);
          if (!queryClient.getQueryData(senderKeys.home(workspaceId)))
            void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
          break;
        }
        case 'changed':
          placeMessage(queryClient, workspaceId, event.channelId, event.message);
          break;
        case 'typing':
          onTyping(event.channelId, event.author);
          break;
        case 'channels':
          void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
          break;
        // An agent came, went or changed (here, in another tab, by someone sharing it).
        case 'agent':
          void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
          void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
          break;
        case 'mail':
          mailChanged(queryClient, workspaceId, event.threadId);
          break;
        case 'todos':
          todosChanged(queryClient, workspaceId);
          break;
        case 'calendar':
          calendarChanged(queryClient, workspaceId);
          break;
      }
    };
    const open = () => {
      const stream = new EventSource(`${API_PREFIX}/workspaces/${workspaceId}/sender/live`, {
        withCredentials: true,
      });
      source = stream;
      stream.addEventListener('open', () => {
        if (!down) return;
        down = false;
        // Back after a gap: what was said meanwhile comes by asking.
        void queryClient.invalidateQueries({ queryKey: senderKeys.all(workspaceId) });
      });
      stream.addEventListener('sender', (message) => {
        onEvent(JSON.parse((message as MessageEvent<string>).data) as SenderEvent);
      });
      stream.addEventListener('error', () => {
        down = true;
        if (stream.readyState === EventSource.CLOSED && !closed) {
          timer = window.setTimeout(open, RECONNECT_MS);
        }
      });
    };
    open();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      source?.close();
    };
    // `openChannel` and `onTyping` are read when an event comes, not when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, queryClient]);
}
