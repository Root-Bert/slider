import {
  ACCENT_COLORS,
  mailThreadKind,
  type AccountAuthor,
  type MailPerson,
  type MailMessage,
  type MailThread,
  type MailThreadSummary,
  type SenderAgent,
  type SenderChannel,
} from '@slider/shared';
import { byLatest } from './direct';
import { pinnedFirst } from './pins';

/** What a person of a mail is called: their name, else their address. */
export const mailName = (person: Pick<MailPerson, 'name' | 'address'>) =>
  person.name.trim() || person.address;

/**
 * A person of a mail as an author, for their picture and name: a colleague as they are in the
 * workspace, anyone else in a colour of their address.
 */
export function mailAuthor(
  person: Pick<MailPerson, 'name' | 'address'> & { userId?: string | null },
  people: readonly AccountAuthor[],
): AccountAuthor {
  const colleague = person.userId ? people.find((each) => each.id === person.userId) : undefined;
  if (colleague) return colleague;
  let hash = 0;
  for (const char of person.address) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    id: `mail:${person.address}`,
    name: mailName(person),
    type: 'owner',
    color: ACCENT_COLORS[hash % ACCENT_COLORS.length] ?? 'blue',
  };
}

/** Mail conversations with colleagues only on them stand among the chats, as a group would. */
export const mailGroupsOf = (threads: readonly MailThreadSummary[] | undefined) =>
  (threads ?? []).filter((each) => !each.spam && mailThreadKind(each.people) === 'group');

export const isMailChat = (
  chat: SenderChannel | SenderAgent | MailThreadSummary,
): chat is MailThreadSummary => 'snippet' in chat;

/**
 * The chats outside the areas with the colleagues-only mail conversations, the latest first –
 * pinned ones above them, the latest pinned first.
 */
export const withMailChats = (
  chats: readonly (SenderChannel | SenderAgent)[],
  threads: readonly MailThreadSummary[] | undefined,
) =>
  pinnedFirst(
    byLatest<SenderChannel | SenderAgent | MailThreadSummary>([...chats, ...mailGroupsOf(threads)]),
  );

/** How many mail conversations (not spam, not colleagues only) have something unread. */
export const unreadMailOf = (threads: readonly MailThreadSummary[] | undefined) =>
  (threads ?? []).filter(
    (each) => !each.spam && each.unread > 0 && mailThreadKind(each.people) === 'mail',
  ).length;

/** A group-like mail conversation's name: who is on it, by first name. */
export const mailGroupName = (thread: Pick<MailThreadSummary, 'people' | 'subject'>) =>
  thread.subject || thread.people.map((each) => mailName(each).split(/\s+/)[0]).join(', ');

/**
 * A mail's own words and what it quotes below them („Am … schrieb …:“, „> …“) – the quote
 * folded away, as mail programs do.
 */
export function splitQuoted(text: string): { fresh: string; quoted: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line, index) =>
      /^(am|on)\s.+(schrieb|wrote)[^:]*:\s*$/i.test(line.trim()) ||
      /^-{2,}\s*(original message|ursprüngliche nachricht|weitergeleitete nachricht)/i.test(
        line.trim(),
      ) ||
      (/^(von|from):\s/i.test(line.trim()) &&
        index > 0 &&
        lines[index - 1]?.trim() === '' &&
        /^(gesendet|sent|date|datum):/i.test(lines[index + 1]?.trim() ?? '')) ||
      (line.startsWith('>') &&
        lines.slice(index).every((rest) => rest.startsWith('>') || !rest.trim())),
  );
  if (cut <= 0) return { fresh: text.trim(), quoted: '' };
  return {
    fresh: lines.slice(0, cut).join('\n').trim(),
    quoted: lines.slice(cut).join('\n').trim(),
  };
}

/** A web address's host, without „www.“ – under a link's name. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * Which mailbox and which of its folders the mail page shows: `?postfach=<id>&ordner=<key>` – the
 * folder's key (`inbox`, `sent`, `archive`, `spam`, `trash`, else its path on the server). Left
 * out: the first mailbox, its Posteingang (so `?ordner=spam` from before still opens Spam).
 * „Ungelesen“ is no part of it: on or off, it holds for every mailbox (`useMailView`).
 */
export interface MailView {
  accountId: string | null;
  folder: string;
}

export const mailViewOf = (params: URLSearchParams): MailView => ({
  accountId: params.get('postfach'),
  folder: params.get('ordner') || 'inbox',
});

/** The address's query for a view – what is the default is left out. */
export function mailViewSearch(view: MailView & { accountId: string }, first: boolean) {
  const params = new URLSearchParams();
  if (!first) params.set('postfach', view.accountId);
  if (view.folder !== 'inbox') params.set('ordner', view.folder);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Whether a received mail may not be from whom it says: its domain said no, or it carries a
 * colleague's address that no signature vouched for this time.
 */
export const unverifiedMail = (message: MailMessage, thread: Pick<MailThread, 'people'>) =>
  !message.outgoing &&
  (message.auth === 'fail' ||
    (message.auth !== 'pass' &&
      thread.people.some((one) => one.userId && one.address === message.from.address)));

/**
 * Where a new mail is written: in the mail page's pane, where an opened one stands
 * (`…/mail/neu` – a conversation's id is a UUID, never this).
 */
export const NEW_MAIL = 'neu';
