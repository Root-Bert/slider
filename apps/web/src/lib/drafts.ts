import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SenderDraft, SenderDraftTarget } from '@slider/shared';
import { accountKey, api, ApiError } from '@/lib/api-client';
import { createStoredStore, type StoredStore } from '@/lib/storage';

/**
 * Where a draft goes, and in which workspace: a conversation of Sender's (the key is its id), a
 * mail's answer, an agent's chat, a new agent's order (in an area, or none), a new mail. Names
 * are kept with it for the list – a mail or an area is not in the side bar's data.
 */
export type DraftTarget = SenderDraftTarget & { workspaceId: string };

/** What was written and not sent, when it was last changed, and where it goes. */
export interface Draft {
  text: string;
  at: string;
  /** None: an older one of this browser, kept before drafts went to the server. */
  target?: DraftTarget;
  /** What the server has: nothing of it waits to go there. */
  synced?: true;
}

/** The keys beside conversation ids – ids are UUIDs, these have a prefix. */
export const draftKeys = {
  mail: (threadId: string) => `mail:${threadId}`,
  agent: (agentId: string, chatId: string) => `agent:${agentId}:${chatId}`,
  /** A new agent's order: the workspace's (Neu › Agent, „Agenten“, Cloud's start) or an area's. */
  newAgent: (workspaceId: string, areaId?: string) =>
    areaId ? `agent-new:${workspaceId}:${areaId}` : `agent-new:${workspaceId}`,
  newMail: (workspaceId: string) => `mail-new:${workspaceId}`,
};

type Drafts = Readonly<Record<string, Draft>>;

const TARGETS = new Set(['conversation', 'mail', 'agent', 'agent-new', 'mail-new']);
const isDraft = (value: unknown): value is Draft => {
  if (typeof value !== 'object' || value === null) return false;
  const { text, at, target } = value as Draft;
  return (
    typeof text === 'string' &&
    typeof at === 'string' &&
    (target === undefined ||
      (typeof target === 'object' &&
        target !== null &&
        TARGETS.has(target.kind) &&
        typeof target.workspaceId === 'string'))
  );
};

/** Something written: words – or, for a new mail, to whom or its subject; a mail's files. */
export const hasWords = (draft: Pick<Draft, 'text' | 'target'> | undefined): boolean =>
  !!draft &&
  (!!draft.text.trim() ||
    (draft.target?.kind === 'mail-new' &&
      !!(draft.target.to.trim() || draft.target.subject.trim())) ||
    ((draft.target?.kind === 'mail' || draft.target?.kind === 'mail-new') &&
      (draft.target.uploads?.length ?? 0) > 0));

/**
 * Every draft – of every conversation, mail, agent chat, new agent – by its key, kept in this
 * browser (per account, `accountKey`; signing out drops it, `forgetOffline`) and for the account
 * on the server, so it waits on every device. This browser's copy is what the fields show at
 * once; what changed goes up a moment after the last key (`push`), what another device wrote
 * comes down with the list (`useDraftSync`). The newer one wins. A draft thrown away stays here,
 * empty, until the server has let go of it too.
 */
const stores = new Map<string, StoredStore<Drafts>>();
function store(): StoredStore<Drafts> {
  const key = accountKey('slider.sender.drafts');
  let found = stores.get(key);
  if (!found) {
    found = createStoredStore<Drafts>({
      key,
      parse: (value) =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).filter(([, draft]) => isDraft(draft)))
          : {},
      fallback: {},
      crossTab: true,
    });
    stores.set(key, found);
  }
  return found;
}

export const draftOf = (key: string): string => store().getSnapshot()[key]?.text ?? '';

/** The whole draft (a new mail's fields are in its target). */
export const draftFor = (key: string): Draft | undefined => store().getSnapshot()[key];

/**
 * Keeps what is written; nothing written (or only spaces) is no draft. `target` says where it
 * goes – the one kept before stays when none is given.
 */
export function setDraft(key: string, text: string, target?: DraftTarget): void {
  const drafts = store();
  const all = drafts.getSnapshot();
  const before = all[key];
  const kept = target ?? before?.target;
  const next: Draft = { text, at: new Date().toISOString(), ...(kept ? { target: kept } : {}) };
  if (!hasWords(next)) {
    if (!before || (!hasWords(before) && !before.synced)) return;
    if (!kept) {
      // Never on the server (from before it kept drafts): gone at once.
      const { [key]: _gone, ...rest } = all;
      drafts.set(rest);
      return;
    }
    // Empty until the server has let go of it as well.
    drafts.set({ ...all, [key]: { ...next, text: '' } });
    schedule(key);
    return;
  }
  if (before?.text === text && JSON.stringify(before.target) === JSON.stringify(kept)) return;
  drafts.set({ ...all, [key]: next });
  // One of this browser from before drafts went to the server stays here (`mergeDrafts`).
  if (kept) schedule(key);
}

/** Throws a draft away (sent, „Löschen“) – a new mail's address and subject with its words. */
export function dropDraft(key: string): void {
  const target = draftFor(key)?.target;
  setDraft(
    key,
    '',
    target?.kind === 'mail-new'
      ? { ...target, to: '', cc: '', bcc: '', subject: '', forward: null, uploads: [] }
      : target?.kind === 'mail'
        ? { ...target, uploads: [] }
        : target,
  );
}

export function useDrafts(): Drafts {
  const drafts = store();
  return useSyncExternalStore(drafts.subscribe, drafts.getSnapshot);
}

/** One draft's words, following what another device or tab wrote. */
export const useDraftText = (key: string | undefined): string => {
  const drafts = useDrafts();
  return key ? (drafts[key]?.text ?? '') : '';
};

// ── To the server and back ──────────────────────────────────────────────────

/** How long after the last key a draft goes up. */
const PUSH_MS = 800;
/** Without a focus or a change, the list asks again this often. */
const LIST_MS = 30_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Keys on their way up; a change meanwhile goes after (`again`). */
const sending = new Set<string>();
const again = new Set<string>();
/** When the server last took a key's change (this page's clock) – a list asked before misses it. */
const confirmed = new Map<string, number>();
/** Refused outright (too long, too many): that change is not sent again – the next one is. */
const refused = new Map<string, string>();

function schedule(key: string, delay = PUSH_MS): void {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void push(key);
    }, delay),
  );
}

const draftPath = (workspaceId: string, key: string) =>
  `/workspaces/${workspaceId}/drafts/${encodeURIComponent(key)}`;

/** The target as the server keeps it – the workspace is its place. */
const serverTarget = ({ workspaceId: _workspace, ...target }: DraftTarget): SenderDraftTarget =>
  target;

/** Sends one draft's change; refused or offline, it waits for the next round. */
async function push(key: string): Promise<void> {
  const draft = store().getSnapshot()[key];
  const workspaceId = draft?.target?.workspaceId;
  if (!draft || draft.synced || !draft.target || !workspaceId) return;
  if (refused.get(key) === draft.at) return;
  if (sending.has(key)) {
    again.add(key);
    return;
  }
  sending.add(key);
  try {
    let answer: SenderDraft | undefined;
    if (hasWords(draft)) {
      answer =
        (await api.put<SenderDraft | undefined>(draftPath(workspaceId, key), {
          text: draft.text,
          target: serverTarget(draft.target),
          at: draft.at,
        })) ?? undefined;
    } else {
      await api.delete(`${draftPath(workspaceId, key)}?at=${encodeURIComponent(draft.at)}`);
    }
    confirmed.set(key, Date.now());
    const drafts = store();
    const now = drafts.getSnapshot();
    const current = now[key];
    // Changed meanwhile: that change goes next.
    if (!current || current.at !== draft.at) return;
    if (answer && answer.at > draft.at) {
      // Written later on another device: that one stands.
      drafts.set({ ...now, [key]: fromServer(workspaceId, answer) });
    } else if (hasWords(current)) {
      drafts.set({ ...now, [key]: { ...current, synced: true } });
    } else {
      const { [key]: _gone, ...rest } = now;
      drafts.set(rest);
    }
  } catch (error) {
    // Refused outright: kept here (never taken for one the server let go of), not sent again
    // and again. Offline or too many at once: the next round sends it.
    if (
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    )
      refused.set(key, draft.at);
  } finally {
    sending.delete(key);
    if (again.delete(key)) schedule(key, 0);
  }
}

const fromServer = (workspaceId: string, draft: SenderDraft): Draft => ({
  text: draft.text,
  at: draft.at,
  target: { ...draft.target, workspaceId } as DraftTarget,
  synced: true,
});

/** Every change of the workspace not on the server yet goes up (a start, back online). */
function pushAll(workspaceId: string): void {
  for (const [key, draft] of Object.entries(store().getSnapshot()))
    if (!draft.synced && draft.target?.workspaceId === workspaceId && !timers.has(key))
      void push(key);
}

/**
 * Lays the server's list (asked at `asked`) over this browser's: the newer of each wins; one the
 * server no longer has was sent or thrown away elsewhere – unless it waits to go up, or the
 * server took it after the list was asked. An older draft of this browser for one of the
 * workspace's conversations (`conversations`) is given its place and goes up.
 */
export function mergeDrafts(
  workspaceId: string,
  list: readonly SenderDraft[],
  asked: number,
  conversations: ReadonlySet<string>,
): void {
  const drafts = store();
  const all: Record<string, Draft> = { ...drafts.getSnapshot() };
  let changed = false;
  const server = new Set<string>();
  for (const draft of list) {
    server.add(draft.key);
    const local = all[draft.key];
    if (local && local.at >= draft.at) continue;
    all[draft.key] = fromServer(workspaceId, draft);
    changed = true;
  }
  for (const [key, local] of Object.entries(all)) {
    if (server.has(key)) continue;
    if (!local.target) {
      if (!conversations.has(key)) continue;
      all[key] = { ...local, target: { kind: 'conversation', workspaceId } };
      changed = true;
      continue;
    }
    if (local.target.workspaceId !== workspaceId || !local.synced) continue;
    if ((confirmed.get(key) ?? 0) > asked) continue;
    delete all[key];
    changed = true;
  }
  if (changed) drafts.set(all);
  pushAll(workspaceId);
}

export const draftsQueryKey = (workspaceId: string) => ['sender', workspaceId, 'drafts'] as const;

/**
 * Keeps this browser's drafts of the workspace and the server's the same: asks for the list on
 * start, on focus and every half minute, sends what waits when the browser is back online.
 * `conversations`: the workspace's conversations, for drafts kept before the server had them.
 */
export function useDraftSync(workspaceId: string, conversations: readonly string[] | undefined) {
  const list = useQuery({
    queryKey: draftsQueryKey(workspaceId),
    queryFn: async () => {
      const asked = Date.now();
      return { asked, drafts: await api.get<SenderDraft[]>(`/workspaces/${workspaceId}/drafts`) };
    },
    refetchInterval: LIST_MS,
    refetchOnWindowFocus: 'always',
  });
  const known = conversations?.join(' ');
  const data = list.data;
  useEffect(() => {
    if (!data || known === undefined) return;
    mergeDrafts(workspaceId, data.drafts, data.asked, new Set(known.split(' ')));
  }, [data, known, workspaceId]);
  useEffect(() => {
    const online = () => pushAll(workspaceId);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [workspaceId]);
}
