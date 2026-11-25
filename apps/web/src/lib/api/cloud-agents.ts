import type {
  Attachment,
  CloudAgentAuto,
  CloudAgentRepeatInput,
  CloudAgentAsk,
  CloudAgentDetail,
  CloudAgentFile,
  CloudAgentFileContent,
  CloudAgentSummary,
  SenderHome,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { cloudKeys } from './cloud';
import { senderKeys, type PlaceMessage } from './sender';

/**
 * „Agenten“ in Cloud: orders to the AI that it works on in the server, each with its chats –
 * its owner's, or everyone's in the workspace once shared. Its page asks again every moment:
 * what it writes shows as it comes, and so does who else is there and who is writing. Their keys live under the workspace's `['cloud', id]`, so a change to the files
 * refreshes them too.
 */

/** How often a working agent is asked how far it is. */
const WORKING_MS = 1500;
const LIST_MS = 5000;
/** How often an open agent is asked who else is there; the asking says one is there oneself. */
const HERE_MS = 3000;
/** A person writing says so this often at most. */
const TYPING_MS = 2000;

/** The clock a time in an order is meant on („jeden Montag um 8“): this browser's. */
const ownZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const cloudAgentKeys = {
  list: (workspaceId: string) => [...cloudKeys.all(workspaceId), 'agents'] as const,
  one: (workspaceId: string, agentId: string) =>
    [...cloudKeys.all(workspaceId), 'agents', agentId] as const,
  file: (workspaceId: string, agentId: string, fileId: string) =>
    [...cloudKeys.all(workspaceId), 'agents', agentId, 'file', fileId] as const,
};

export function useCloudAgents(workspaceId: string) {
  return useQuery({
    queryKey: cloudAgentKeys.list(workspaceId),
    queryFn: () => api.get<CloudAgentSummary[]>(`/workspaces/${workspaceId}/cloud/agents`),
    refetchInterval: (query) =>
      query.state.data?.some((agent) => agent.running) ? LIST_MS : 30_000,
  });
}

export function useCloudAgent(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: cloudAgentKeys.one(workspaceId, agentId),
    queryFn: () => api.get<CloudAgentDetail>(`/cloud/agents/${agentId}`),
    // As often while it has seen something it waits to work on: that reads live too.
    refetchInterval: (query) =>
      query.state.data?.running || query.state.data?.watching.length ? WORKING_MS : HERE_MS,
  });
}

/** A desk file's text – asked for when it is opened. */
export function useCloudAgentFile(workspaceId: string, agentId: string, fileId: string | null) {
  return useQuery({
    queryKey: cloudAgentKeys.file(workspaceId, agentId, fileId ?? ''),
    queryFn: () => api.get<CloudAgentFileContent>(`/cloud/agents/${agentId}/files/${fileId}`),
    enabled: fileId !== null,
  });
}

/** What one writes to an agent: words, and the files put on them. */
export interface AgentInput {
  text: string;
  attachments?: Attachment[];
}
const inputBody = (input: string | AgentInput) =>
  typeof input === 'string'
    ? { text: input, attachments: [] }
    : { text: input.text, attachments: (input.attachments ?? []).map((one) => one.id) };

/**
 * A new agent with its order, standing in an area (`areaId`) or in none – its owner's alone, or
 * (`shared`) given to that area's people, in none the workspace's.
 */
export function useOrderCloudAgent(
  workspaceId: string,
  areaId: string | null = null,
  /** Ordered beside a mail (`MailAside`): the agent is told which one – by id, not its text. */
  mailThreadId?: string,
  shared = false,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | AgentInput) =>
      api.post<CloudAgentDetail>(`/workspaces/${workspaceId}/cloud/agents`, {
        ...inputBody(input),
        areaId,
        shared,
        zone: ownZone(),
        mailThreadId,
      }),
    onSuccess: (agent) => {
      queryClient.setQueryData(cloudAgentKeys.one(workspaceId, agent.id), agent);
      queryClient.setQueryData<CloudAgentSummary[]>(
        cloudAgentKeys.list(workspaceId),
        (list) => list && [agent, ...list.filter((each) => each.id !== agent.id)],
      );
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
      // Sender's bar and Cloud's list one's agents as chats: there at once, the latest first.
      queryClient.setQueryData<SenderHome>(
        senderKeys.home(workspaceId),
        (home) =>
          home && {
            ...home,
            agents: [
              {
                id: agent.id,
                title: agent.title,
                owner: agent.owner,
                areaId: agent.areaId,
                shared: agent.shared,
                running: agent.running,
                unread: 0,
                updatedAt: agent.updatedAt,
              },
              ...home.agents.filter((each) => each.id !== agent.id),
            ],
          },
      );
      void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
    },
  });
}

/**
 * Written to, the agent works: „läuft“ at once in the side bars (Sender's home) and on its card,
 * the latest first; refused, both ask again – and the agent itself: shared or deleted elsewhere
 * since, its page and the column beside a mail (`MailAside`) know at once, not at the next poll.
 */
function markRunning(queryClient: QueryClient, workspaceId: string, agentId: string) {
  const now = new Date().toISOString();
  queryClient.setQueryData<SenderHome>(
    senderKeys.home(workspaceId),
    (home) =>
      home && {
        ...home,
        agents: home.agents.map((each) =>
          each.id === agentId ? { ...each, running: true, updatedAt: now } : each,
        ),
      },
  );
  queryClient.setQueryData<CloudAgentSummary[]>(cloudAgentKeys.list(workspaceId), (list) =>
    list?.map((each) => (each.id === agentId ? { ...each, running: true, updatedAt: now } : each)),
  );
}

function unmarkRunning(queryClient: QueryClient, workspaceId: string, agentId: string) {
  void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.one(workspaceId, agentId) });
}

export function useMessageCloudAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      text,
      attachments = [],
      chatId,
      mailThreadId,
      replyTo,
    }: {
      text: string;
      /** Files put on it: the agent reads them. */
      attachments?: Attachment[];
      chatId: string;
      /** Written beside a mail: the agent is told which one, as with the order. */
      mailThreadId?: string;
      /** „Antworten“: a message of that chat, quoted above it. */
      replyTo?: string;
    }) =>
      api.post<CloudAgentDetail>(`/cloud/agents/${agentId}/messages`, {
        text,
        attachments: attachments.map((one) => one.id),
        chatId,
        zone: ownZone(),
        mailThreadId,
        replyTo,
      }),
    onMutate: () => markRunning(queryClient, workspaceId, agentId),
    onSuccess: (agent) => queryClient.setQueryData(cloudAgentKeys.one(workspaceId, agentId), agent),
    onError: () => unmarkRunning(queryClient, workspaceId, agentId),
  });
}

/**
 * A message of the agent's chats changed by Sender's own routes (a reaction, a change, deleted):
 * shown in place at once, what only an agent's message has kept (`useEditSenderMessage` …).
 */
export function usePlaceAgentMessage(workspaceId: string, agentId: string): PlaceMessage {
  const queryClient = useQueryClient();
  return (message) =>
    queryClient.setQueryData<CloudAgentDetail>(cloudAgentKeys.one(workspaceId, agentId), (agent) =>
      agent
        ? {
            ...agent,
            chats: agent.chats.map((chat) => ({
              ...chat,
              messages: chat.messages.map((each) =>
                each.id === message.id ? { ...each, ...message } : each,
              ),
            })),
          }
        : agent,
    );
}

const typingAt = new Map<string, number>();
/** Says that one is writing in a chat – the others see it for a moment. Nothing waits for it. */
export function tellTypingInCloudAgent(agentId: string, chatId: string) {
  const now = Date.now();
  if (now - (typingAt.get(chatId) ?? 0) < TYPING_MS) return;
  typingAt.set(chatId, now);
  void api.post<void>(`/cloud/agents/${agentId}/typing`, { chatId }).catch(() => {});
}

export function useStopCloudAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.post<void>(`/cloud/agents/${agentId}/stop`, { chatId }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: cloudAgentKeys.one(workspaceId, agentId) }),
  });
}

/**
 * Whose one's agent is – one's own, the workspace's (`shared`) or an area's (`areaId`) – shown
 * at once.
 */
export function useShareCloudAgent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      shared,
      areaId = null,
    }: {
      agentId: string;
      shared: boolean;
      areaId?: string | null;
    }) => api.patch<void>(`/cloud/agents/${agentId}`, { shared, areaId }),
    onMutate: ({ agentId, shared, areaId = null }) => {
      queryClient.setQueryData<CloudAgentSummary[]>(cloudAgentKeys.list(workspaceId), (list) =>
        list?.map((agent) => (agent.id === agentId ? { ...agent, shared, areaId } : agent)),
      );
      queryClient.setQueryData<CloudAgentDetail>(
        cloudAgentKeys.one(workspaceId, agentId),
        (agent) => agent && { ...agent, shared, areaId },
      );
    },
    onSettled: (_data, _error, { agentId }) => {
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.one(workspaceId, agentId) });
    },
  });
}

/** „Umbenennen“: its owner names it – at once in its lists and on its page; a refusal undoes it. */
export function useRenameCloudAgent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, title }: { agentId: string; title: string }) =>
      api.patch<void>(`/cloud/agents/${agentId}/title`, { title }),
    onMutate: ({ agentId, title }) => {
      queryClient.setQueryData<CloudAgentSummary[]>(cloudAgentKeys.list(workspaceId), (list) =>
        list?.map((agent) => (agent.id === agentId ? { ...agent, title } : agent)),
      );
      queryClient.setQueryData<CloudAgentDetail>(
        cloudAgentKeys.one(workspaceId, agentId),
        (agent) => agent && { ...agent, title },
      );
    },
    onSettled: (_data, _error, { agentId }) => {
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.one(workspaceId, agentId) });
    },
  });
}

/** „Wiederholen“: the order the agent takes up again by itself, and when – `null` ends that. */
export function useRepeatCloudAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repeat: CloudAgentRepeatInput) =>
      api.put<CloudAgentDetail>(`/cloud/agents/${agentId}/repeat`, { repeat }),
    onSuccess: (agent) => {
      queryClient.setQueryData(cloudAgentKeys.one(workspaceId, agentId), agent);
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
    },
  });
}

/**
 * What the agent does by itself, in its owner's hand: paused (the repeated order and the
 * watches stay, nothing runs) or one watch taken away – shown at once.
 */
export function useAutoCloudAgent(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const key = cloudAgentKeys.one(workspaceId, agentId);
  return useMutation({
    mutationFn: (change: CloudAgentAuto) =>
      api.patch<CloudAgentDetail>(`/cloud/agents/${agentId}/auto`, change),
    onMutate: (change) => {
      queryClient.setQueryData<CloudAgentDetail>(
        key,
        (agent) =>
          agent && {
            ...agent,
            paused: change.paused ?? agent.paused,
            watches: agent.watches.filter((each) => each.id !== change.removeWatch),
            // Told to start: what it waited on is its work now.
            watching: change.startNow ? [] : agent.watching,
          },
      );
    },
    onSuccess: (agent) => queryClient.setQueryData(key, agent),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
    },
  });
}

export function useDeleteCloudAgent(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.delete(`/cloud/agents/${agentId}`),
    onMutate: (agentId) => {
      queryClient.setQueryData<CloudAgentSummary[]>(cloudAgentKeys.list(workspaceId), (list) =>
        list?.filter((agent) => agent.id !== agentId),
      );
      // Sender's bar and Cloud's list one's agents as chats: gone there too, at once.
      queryClient.setQueryData<SenderHome>(
        senderKeys.home(workspaceId),
        (home) => home && { ...home, agents: home.agents.filter((each) => each.id !== agentId) },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
    },
  });
}

/** The desk file as the server now has it, written into the open agent at once. */
function useDeskPatch(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  return (file: CloudAgentFile) =>
    queryClient.setQueryData<CloudAgentDetail>(
      cloudAgentKeys.one(workspaceId, agentId),
      (agent) => {
        if (!agent) return agent;
        const files = agent.files.map((each) => (each.id === file.id ? file : each));
        const open = files.filter((each) => each.status === 'open');
        return {
          ...agent,
          files,
          openFiles: open.length,
          desk: open.slice(0, 3).map(({ id, name, kind, nodeId, thumbnailUrl }) => ({
            id,
            name,
            kind,
            nodeId,
            thumbnailUrl,
          })),
        };
      },
    );
}

/** „Übernehmen“: what lies on the desk happens – every list of the files asks again. */
export function useTakeCloudAgentFile(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const patch = useDeskPatch(workspaceId, agentId);
  return useMutation({
    mutationFn: (fileId: string) =>
      api.post<{ file: CloudAgentFile }>(`/cloud/agents/${agentId}/files/${fileId}/take`),
    onSuccess: ({ file }) => {
      patch(file);
      void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
    },
  });
}

/**
 * „Löschen“, „Senden“ … or „Abbrechen“ on an agent's card: shown decided at once; what came of
 * it (done, or why not) when the server answers. A refusal comes back as the card was.
 */
export function useDecideCloudAgentAsk(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const key = cloudAgentKeys.one(workspaceId, agentId);
  const patch = (ask: Pick<CloudAgentAsk, 'id'> & Partial<CloudAgentAsk>) =>
    queryClient.setQueryData<CloudAgentDetail>(key, (agent) =>
      agent
        ? {
            ...agent,
            chats: agent.chats.map((chat) => ({
              ...chat,
              messages: chat.messages.map((message) =>
                message.asks?.some((each) => each.id === ask.id)
                  ? {
                      ...message,
                      asks: message.asks.map((each) =>
                        each.id === ask.id ? { ...each, ...ask } : each,
                      ),
                    }
                  : message,
              ),
            })),
          }
        : agent,
    );
  return useMutation({
    mutationFn: ({ ask, confirm }: { ask: CloudAgentAsk; confirm: boolean }) =>
      api.post<CloudAgentAsk>(`/cloud/agents/${agentId}/asks/${ask.id}`, { confirm }),
    onMutate: ({ ask, confirm }) => {
      patch({ id: ask.id, state: confirm ? 'done' : 'cancelled' });
    },
    onSuccess: (ask) => {
      patch(ask);
      void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
    },
    onError: (_error, { ask }) => {
      patch(ask);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** „Alle übernehmen“: the whole desk at once; what could not be done comes back by name. */
export function useTakeCloudAgentDesk(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ taken: number; failed: { name: string; message: string }[] }>(
        `/cloud/agents/${agentId}/take`,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) }),
  });
}

/** „Verwerfen“ and back: shown at once. */
export function useSetCloudAgentFileAside(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const patch = useDeskPatch(workspaceId, agentId);
  return useMutation({
    mutationFn: ({ file, aside }: { file: CloudAgentFile; aside: boolean }) =>
      api.patch<CloudAgentFile>(`/cloud/agents/${agentId}/files/${file.id}`, { aside }),
    onMutate: ({ file, aside }) =>
      patch({ ...file, status: aside ? 'discarded' : 'open', undoable: false }),
    // Taken back, the files are as before: every list of them asks again.
    onSuccess: (file) => {
      patch(file);
      void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.list(workspaceId) });
    },
    onError: () =>
      queryClient.invalidateQueries({ queryKey: cloudAgentKeys.one(workspaceId, agentId) }),
  });
}
