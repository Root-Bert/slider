import type {
  LinkedMailAccount,
  MailAccount,
  MailAccountInput,
  MailDraft,
  MailInsights,
  MailMessage,
  MailOAuthResult,
  MailOAuthStart,
  MailPerson,
  MailPrepared,
  MailRule,
  MailRuleAdded,
  MailRuleKind,
  MailRuleMatch,
  MailSync,
  MailThread,
  MailThreadSummary,
  MailUpload,
} from '@slider/shared';
import { withSignature } from '@slider/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, apiRequest, uploadWithProgress } from '../api-client';

/*
 * Mail in Sender: one's mailboxes in a workspace and their conversations. Kept under Sender's
 * keys, so its live stream (`{ type: 'mail' }`) and its way back after a gap fetch them anew.
 */

/** Without the stream, the list asks again this often. */
const THREADS_MS = 60_000;

export const mailKeys = {
  all: (workspaceId: string) => ['sender', workspaceId, 'mail'] as const,
  accounts: (workspaceId: string) => ['sender', workspaceId, 'mail', 'accounts'] as const,
  threads: (workspaceId: string) => ['sender', workspaceId, 'mail', 'threads'] as const,
  /** One mailbox's folder – under `threads`, so whatever tells the list tells these too. */
  folder: (workspaceId: string, accountId: string, folder: string) =>
    ['sender', workspaceId, 'mail', 'threads', accountId, folder] as const,
  /** What a search finds (in one mailbox, or all) – under `threads`, told as the list is. */
  search: (workspaceId: string, query: string, accountId: string, inText: boolean) =>
    ['sender', workspaceId, 'mail', 'threads', 'search', accountId, inText, query] as const,
  thread: (workspaceId: string, threadId: string) =>
    ['sender', workspaceId, 'mail', 'thread', threadId] as const,
  /** The AI panel beside it – under its conversation: what tells that (a new mail) tells this. */
  insights: (workspaceId: string, threadId: string) =>
    ['sender', workspaceId, 'mail', 'thread', threadId, 'insights'] as const,
  /** Whom one wrote with, offered as an address is typed. */
  addresses: (workspaceId: string) => ['sender', workspaceId, 'mail', 'addresses'] as const,
  /** What an agent got ready for „Neues Postfach“ (`prepare_mailbox`). */
  prepared: (workspaceId: string) => ['sender', workspaceId, 'mail', 'prepared'] as const,
  /** One's own rules for senders (blocked, trusted). */
  rules: (workspaceId: string) => ['sender', workspaceId, 'mail', 'rules'] as const,
};

/** What the live stream says changed: the list, and the conversation named (all when none). */
export function mailChanged(
  queryClient: QueryClient,
  workspaceId: string,
  threadId: string | null,
) {
  void queryClient.invalidateQueries({ queryKey: mailKeys.threads(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: mailKeys.accounts(workspaceId) });
  void queryClient.invalidateQueries({
    queryKey: threadId ? mailKeys.thread(workspaceId, threadId) : mailKeys.all(workspaceId),
  });
}

export const useMailAccounts = (workspaceId: string) =>
  useQuery({
    queryKey: mailKeys.accounts(workspaceId),
    queryFn: () => api.get<MailAccount[]>(`/workspaces/${workspaceId}/mail/accounts`),
  });

/** The mailbox an agent got ready for the form, while it waits (`null`: none). */
export const useMailPrepared = (workspaceId: string) =>
  useQuery({
    queryKey: mailKeys.prepared(workspaceId),
    queryFn: () => api.get<MailPrepared | null>(`/workspaces/${workspaceId}/mail/prepared`),
  });

export const useMailThreads = (workspaceId: string) =>
  useQuery({
    queryKey: mailKeys.threads(workspaceId),
    queryFn: () => api.get<MailThreadSummary[]>(`/workspaces/${workspaceId}/mail/threads`),
    refetchInterval: THREADS_MS,
  });

/**
 * The conversations that hold every word – in any folder, of one mailbox or all (`accountId`):
 * subject, names and addresses, with `inText` what the mails say too (as Cloud's „in what files
 * say“); the newest 200. Nothing asked while the query is empty.
 */
export const useMailSearch = (
  workspaceId: string,
  query: string,
  { accountId = '', inText = false, enabled = true } = {},
) =>
  useQuery({
    queryKey: mailKeys.search(workspaceId, query, accountId, inText),
    queryFn: () =>
      api.get<MailThreadSummary[]>(
        `/workspaces/${workspaceId}/mail/threads?q=${encodeURIComponent(query)}${accountId ? `&account=${encodeURIComponent(accountId)}` : ''}${inText ? '&in=all' : ''}`,
      ),
    enabled: enabled && query !== '',
    placeholderData: keepPreviousData,
  });

/** What lies in one folder of one mailbox (a conversation shows where one of its mails lies). */
const folderQuery = (workspaceId: string, accountId: string, folder: string) => ({
  queryKey: mailKeys.folder(workspaceId, accountId, folder),
  queryFn: () =>
    api.get<MailThreadSummary[]>(
      `/workspaces/${workspaceId}/mail/threads?account=${encodeURIComponent(accountId)}&folder=${encodeURIComponent(folder)}`,
    ),
});

export const useMailFolder = (workspaceId: string, accountId: string, folder: string) =>
  useQuery({
    ...folderQuery(workspaceId, accountId, folder),
    enabled: accountId !== '',
    refetchInterval: THREADS_MS,
  });

/** Fetched ahead (the other mailboxes' Posteingang): switched to, its mails stand there at once. */
export const prefetchMailFolder = (
  queryClient: QueryClient,
  workspaceId: string,
  accountId: string,
  folder = 'inbox',
) =>
  void queryClient.prefetchQuery({
    ...folderQuery(workspaceId, accountId, folder),
    staleTime: 30_000,
  });

const threadQuery = (workspaceId: string, threadId: string) => ({
  queryKey: mailKeys.thread(workspaceId, threadId),
  queryFn: () => api.get<MailThread>(`/mail/threads/${threadId}`),
});

/** One conversation – none asked for while `threadId` is empty. */
export const useMailThread = (workspaceId: string, threadId: string) =>
  useQuery({ ...threadQuery(workspaceId, threadId), enabled: threadId !== '' });

/** Fetched ahead (a row under the pointer): opened, it stands there at once. */
export const prefetchMailThread = (
  queryClient: QueryClient,
  workspaceId: string,
  threadId: string,
) => void queryClient.prefetchQuery({ ...threadQuery(workspaceId, threadId), staleTime: 30_000 });

/** Every list of conversations held – all of them, and each folder's. */
const updateLists = (
  queryClient: QueryClient,
  workspaceId: string,
  change: (list: MailThreadSummary[]) => MailThreadSummary[],
) =>
  queryClient.setQueriesData<MailThreadSummary[]>(
    { queryKey: mailKeys.threads(workspaceId) },
    (list) => (list ? change(list) : list),
  );

function useMailChange<Input, Output>(workspaceId: string, run: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}

/** Tried with both servers before it is kept – the server says why not. */
export const useAddMailAccount = (workspaceId: string) =>
  useMailChange(workspaceId, (input: MailAccountInput) =>
    api.post<MailAccount>(`/workspaces/${workspaceId}/mail/accounts`, input),
  );

export const useUpdateMailAccount = (workspaceId: string) =>
  useMailChange(workspaceId, ({ id, ...input }: Partial<MailAccountInput> & { id: string }) =>
    api.patch<MailAccount>(`/mail/accounts/${id}`, input),
  );

/**
 * A mailbox's own name, where it shows: at once in every list (`label`, empty: its default) – a
 * refusal puts the old one back.
 */
export function useRenameMailAccount(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = mailKeys.accounts(workspaceId);
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.patch<MailAccount>(`/mail/accounts/${id}`, { label }),
    onMutate: async ({ id, label }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<MailAccount[]>(key);
      queryClient.setQueryData<MailAccount[]>(key, (now) =>
        now?.map((one) => (one.id === id ? { ...one, label: label.trim() || null } : one)),
      );
      return { before };
    },
    onError: (_error, _input, context) => queryClient.setQueryData(key, context?.before),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/**
 * „Mit Microsoft/Google anmelden“: the provider's page to go to (same tab); it comes back to
 * `returnTo` with `?anmeldung=<id>` – `useMailOAuthResult` reads how it ended.
 */
export const startMailOAuth = (workspaceId: string, input: MailOAuthStart) =>
  api.post<{ url: string }>(`/workspaces/${workspaceId}/mail/oauth`, input);

export const mailOAuthResult = (id: string) =>
  api.get<MailOAuthResult>(`/mail/oauth/${encodeURIComponent(id)}`);

/** Removes a mailbox („Entfernen“ in Post) – its calendars, if on, stay in the calendar. */
export function useDeleteMailAccount(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/mail/accounts/${id}`),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: ['calendar', workspaceId] }),
      ]),
  });
}

/** Calendars alone with a password become a mailbox again (tried on its servers first). */
export function useAddMailboxToCalendars(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<MailAccount>(`/mail/accounts/${id}/mailbox`),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: ['calendar', workspaceId] }),
      ]),
  });
}

/** One's accounts at mail providers in every workspace and what each is linked for (Konto). */
export const useLinkedMailAccounts = () =>
  useQuery({
    queryKey: ['me', 'mail-accounts'] as const,
    queryFn: () => api.get<LinkedMailAccount[]>('/me/mail-accounts'),
  });

/** How often one's mailboxes are read (Einstellungen › Mail › Aktualisieren) – for the account. */
const mailSyncKey = ['mail', 'sync'] as const;
export const useMailSync = () =>
  useQuery({ queryKey: mailSyncKey, queryFn: () => api.get<MailSync>('/mail/sync') });

/** Set at once (optimistic); refused, back as it was. */
export function useSetMailSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (minutes: MailSync['minutes']) => api.put<MailSync>('/mail/sync', { minutes }),
    onMutate: async (minutes) => {
      await queryClient.cancelQueries({ queryKey: mailSyncKey });
      const before = queryClient.getQueryData<MailSync>(mailSyncKey);
      queryClient.setQueryData<MailSync>(mailSyncKey, { minutes });
      return { before };
    },
    onError: (_error, _minutes, context) => queryClient.setQueryData(mailSyncKey, context?.before),
    onSuccess: (now) => queryClient.setQueryData(mailSyncKey, now),
  });
}

export const useSyncMailAccount = (workspaceId: string) =>
  useMailChange(workspaceId, (id: string) =>
    api.post<void>(`/mail/accounts/${id}/sync?workspaceId=${encodeURIComponent(workspaceId)}`),
  );

/**
 * Whom one wrote with (those one wrote to first), for the address fields – fetched once the fields
 * are there, filtered as one types.
 */
export const useMailAddressBook = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: mailKeys.addresses(workspaceId),
    queryFn: () => api.get<MailPerson[]>(`/workspaces/${workspaceId}/mail/addresses`),
    enabled,
    staleTime: 5 * 60_000,
  });

/** Opened: nothing new in it – the count goes at once. */
export function useReadMailThread(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api.post<void>(`/mail/threads/${threadId}/read`),
    onMutate: (threadId) =>
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === threadId ? { ...each, unread: 0 } : each)),
      ),
  });
}

/** New again (its latest mail): the count is back at once. */
export function useUnreadMailThread(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api.post<void>(`/mail/threads/${threadId}/unread`),
    onMutate: (threadId) =>
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) =>
          each.id === threadId ? { ...each, unread: Math.max(each.unread, 1) } : each,
        ),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.threads(workspaceId) }),
  });
}

/** Spam or not: it moves at once. */
export function useMailSpam(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, spam }: { threadId: string; spam: boolean }) =>
      api.post<void>(`/mail/threads/${threadId}/spam`, { spam }),
    onMutate: ({ threadId, spam }) => {
      updateLists(queryClient, workspaceId, (list) =>
        list.map((each) => (each.id === threadId ? { ...each, spam, spamBy: 'person' } : each)),
      );
      queryClient.setQueryData<MailThread>(mailKeys.thread(workspaceId, threadId), (thread) =>
        thread ? { ...thread, spam, spamBy: 'person' } : thread,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}

/** Gone from the list at once. */
export function useDeleteMailThread(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api.delete(`/mail/threads/${threadId}`),
    onMutate: (threadId) =>
      updateLists(queryClient, workspaceId, (list) => list.filter((each) => each.id !== threadId)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.threads(workspaceId) }),
  });
}

const PENDING = 'pending:';
export const isPendingMail = (message: MailMessage) => message.id.startsWith(PENDING);

/**
 * An answer stands in the conversation at once (faint until the mail server took it); refused, it
 * goes again and the caller says why.
 */
/** Whom a written mail goes to, as set in its fields. */
// Types, not interfaces: a request's body takes them as they are (`JsonBody`).
export type MailRecipients = {
  to: string[];
  cc: string[];
  bcc: string[];
};

/** A reply as written: to whom (`all`, or the addresses as set) and how long it waits. */
export type MailReplyInput = Partial<MailRecipients> & {
  text: string;
  all: boolean;
  delay: number;
  /** Files put on it – sent as their ids, shown on it at once. */
  uploads?: MailUpload[];
};

/** Only the ids of files put on a mail go to the server. */
const withUploadIds = <T extends { uploads?: MailUpload[] }>({ uploads, ...rest }: T) => ({
  ...rest,
  uploads: (uploads ?? []).map((one) => one.id),
});

const peopleOf = (addresses: string[] | undefined) =>
  (addresses ?? []).map((address) => ({ address: address.toLowerCase(), name: '' }));

export function useReplyMail(
  workspaceId: string,
  threadId: string,
  me: MailMessage['from'],
  /** The mailbox's, under the words as the server puts it (`withSignature`). */
  signature?: string | null,
) {
  const queryClient = useQueryClient();
  const key = mailKeys.thread(workspaceId, threadId);
  return useMutation({
    mutationFn: (input: MailReplyInput) =>
      api.post<MailMessage>(`/mail/threads/${threadId}/reply`, withUploadIds(input)),
    onMutate: ({ text, to, cc, bcc, uploads }) => {
      const id = `${PENDING}${crypto.randomUUID()}`;
      queryClient.setQueryData<MailThread>(key, (thread) =>
        thread
          ? {
              ...thread,
              messages: [
                ...thread.messages,
                {
                  id,
                  from: me,
                  to: peopleOf(to),
                  cc: peopleOf(cc),
                  ...(bcc?.length ? { bcc: peopleOf(bcc) } : {}),
                  subject: '',
                  text: withSignature(text, signature),
                  sentAt: new Date().toISOString(),
                  outgoing: true,
                  auth: 'pass',
                  attachments: uploads ?? [],
                },
              ],
            }
          : thread,
      );
      return { id };
    },
    onSuccess: (message, _input, context) =>
      queryClient.setQueryData<MailThread>(key, (thread) =>
        thread
          ? {
              ...thread,
              messages: thread.messages.map((each) => (each.id === context.id ? message : each)),
            }
          : thread,
      ),
    onError: (_error, _input, context) =>
      queryClient.setQueryData<MailThread>(key, (thread) =>
        thread && context
          ? { ...thread, messages: thread.messages.filter((each) => each.id !== context.id) }
          : thread,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.threads(workspaceId) }),
  });
}

export const useSendMail = (workspaceId: string) =>
  useMailChange(
    workspaceId,
    (
      input: MailRecipients & {
        accountId: string;
        subject: string;
        text: string;
        delay: number;
        forward?: { threadId: string; messageId: string };
        uploads?: MailUpload[];
      },
    ) =>
      api.post<{ threadId: string; message: MailMessage }>(
        `/workspaces/${workspaceId}/mail/send`,
        withUploadIds(input),
      ),
  );

/** What a mail taken back out of the outbox said – for its field again. */
export interface MailTakenBack extends MailRecipients {
  text: string;
  /** Its files, back on the mail being written. */
  uploads: MailUpload[];
  subject: string;
  threadGone: boolean;
}

/** Takes a mail back out of the outbox before it goes: gone from the conversation at once. */
export function useTakeBackMail(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, messageId }: { threadId: string; messageId: string }) =>
      apiRequest<MailTakenBack>(`/mail/threads/${threadId}/messages/${messageId}/outbox`, {
        method: 'DELETE',
      }),
    onMutate: ({ threadId, messageId }) =>
      queryClient.setQueryData<MailThread>(mailKeys.thread(workspaceId, threadId), (thread) =>
        thread
          ? { ...thread, messages: thread.messages.filter((each) => each.id !== messageId) }
          : thread,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}

/** A mail that did not go: out again right away – on its way at once. */
export function useSendMailAgain(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, messageId }: { threadId: string; messageId: string }) =>
      api.post<void>(`/mail/threads/${threadId}/messages/${messageId}/outbox/retry`),
    onMutate: ({ threadId, messageId }) =>
      queryClient.setQueryData<MailThread>(mailKeys.thread(workspaceId, threadId), (thread) =>
        thread
          ? {
              ...thread,
              messages: thread.messages.map((each) =>
                each.id === messageId && each.outbox
                  ? { ...each, outbox: { ...each.outbox, state: 'sending' as const, error: null } }
                  : each,
              ),
            }
          : thread,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}

/** Has the AI look at the conversation anew – it says so while it works. */
export function useAskMailContext(workspaceId: string, threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>(`/mail/threads/${threadId}/context`),
    onMutate: () =>
      queryClient.setQueryData<MailThread>(mailKeys.thread(workspaceId, threadId), (thread) =>
        thread ? { ...thread, contextState: 'working' } : thread,
      ),
  });
}

/**
 * The AI panel beside a conversation: who is on it, files that fit, where its attachments go –
 * worked out without a model – and the bullets, if made already (`summary`).
 */
export const useMailInsights = (workspaceId: string, threadId: string, enabled: boolean) =>
  useQuery({
    queryKey: mailKeys.insights(workspaceId, threadId),
    queryFn: () => api.get<MailInsights>(`/mail/threads/${threadId}/insights`),
    enabled,
  });

/** Has the AI write the bullets for the conversation as it stands (kept for the next opening). */
/** Puts a file on a mail being written from this mailbox – `onProgress` from 0 to 1. */
export const uploadMailFile = (
  accountId: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) => {
  const form = new FormData();
  form.append('file', file);
  return uploadWithProgress<MailUpload>(
    `/mail/accounts/${accountId}/uploads`,
    form,
    onProgress,
    signal,
  );
};

/** Takes a file off a mail being written – gone on the server too (never awaited by the field). */
export const dropMailUpload = (uploadId: string) =>
  apiRequest<void>(`/mail/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => undefined);

/** A reply the AI writes from the conversation and the notes in the field. */
export const useDraftMailReply = (threadId: string) =>
  useMutation({
    mutationFn: (notes: string) =>
      api.post<MailDraft>(`/mail/threads/${threadId}/draft`, { notes }),
  });

/** The bullets being made for a conversation – the panel's spark breathes, whoever asked. */
export const mailSummaryKey = (threadId: string) => ['mail', 'summary', threadId] as const;

/** The AI's bullets beside a conversation – `anew`: made again though kept („Neu einschätzen“). */
export function useSummarizeMail(workspaceId: string, threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: mailSummaryKey(threadId),
    mutationFn: (anew: boolean | void) =>
      api.post<MailInsights>(`/mail/threads/${threadId}/insights/summary${anew ? '?neu=1' : ''}`),
    onSuccess: (insights) =>
      queryClient.setQueryData(mailKeys.insights(workspaceId, threadId), insights),
  });
}

/**
 * Puts an attachment into Cloud – where the panel suggests (`areaId`/`parentId`), else where the
 * AI said. The panel shows it put there at once (`nodeId` empty until the server says which);
 * refused, it is back.
 */
export function useFileMailAttachment(workspaceId: string, threadId: string) {
  const queryClient = useQueryClient();
  const key = mailKeys.insights(workspaceId, threadId);
  return useMutation({
    mutationFn: (input: {
      attachmentId: string;
      areaId?: string | null;
      parentId?: string | null;
    }) => api.post<{ nodeId: string; name: string }>(`/mail/threads/${threadId}/file`, input),
    onMutate: async ({ attachmentId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<MailInsights>(key);
      queryClient.setQueryData<MailInsights>(key, (now) =>
        now
          ? {
              ...now,
              filing: now.filing.map((one) =>
                one.attachmentId === attachmentId ? { ...one, nodeId: '' } : one,
              ),
            }
          : now,
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}

export const useMailRules = (workspaceId: string) =>
  useQuery({
    queryKey: mailKeys.rules(workspaceId),
    queryFn: () => api.get<MailRule[]>(`/workspaces/${workspaceId}/mail/rules`),
  });

/**
 * A rule for the sender of a conversation's latest mail: the server places its conversations
 * (blocked to spam, trusted out of it), the lists follow.
 */
export function useAddMailRule(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      kind,
      match,
    }: {
      threadId: string;
      kind: MailRuleKind;
      match: MailRuleMatch;
    }) => api.post<MailRuleAdded>(`/mail/threads/${threadId}/rule`, { kind, match }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}

/** A rule gone at once: its sender's mails stay where they lie, their mark goes. */
export function useDeleteMailRule(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => api.delete(`/mail/rules/${ruleId}`),
    onMutate: (ruleId) => {
      queryClient.setQueryData<MailRule[]>(mailKeys.rules(workspaceId), (rules) =>
        rules?.filter((one) => one.id !== ruleId),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.all(workspaceId) }),
  });
}
