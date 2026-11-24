import {
  ACCENT_COLORS,
  emailDomain,
  type MailRuleSender,
  orgDomain,
  type MailRule,
  type MailRuleKind,
  type MailRuleMatch,
  mailThreadKind,
  type AccountAuthor,
  type MailPerson,
  type MailMessage,
  type MailThread,
  type MailThreadSummary,
  type SenderAgent,
  type SenderChannel,
} from '@slider/shared';
import type { BadgeTone, IconName, MenuAction } from '@/ui';
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
export const hostOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    // Outlook's Safe Links wrap every link of a mail: the host shown is where it leads.
    const wrapped = parsed.hostname.endsWith('.safelinks.protection.outlook.com')
      ? parsed.searchParams.get('url')
      : null;
    if (wrapped) return hostOf(wrapped);
    return parsed.hostname.replace(/^www\./, '');
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

/** „Übersicht“ before the Posteingang: the mailbox's unread as a to-do list (`Triage`). */
export const OVERVIEW = 'uebersicht';

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

type SpamPlaced = Pick<MailThreadSummary, 'spam' | 'spamBy' | 'spamSymbols'>;

interface SpamMarkLook {
  label: string;
  title: string;
  tone: BadgeTone;
  icon: IconName;
}

/** What Rspamd's symbols mean, in words – the first that fits a symbol counts. */
const FILTER_REASONS: [RegExp, string][] = [
  [/^BAYES_SPAM$/, 'ähnelt Mails, die hier als Spam markiert wurden'],
  [/^FUZZY_/, 'als Spam bekannte Mail'],
  [/^(PHISHING|PH_)/, 'Link führt woanders hin, als er zeigt'],
  [/^(DBL_|URIBL_|SURBL_|SEM_URIBL|MSBL_EBL)/, 'Links auf Sperrlisten'],
  [/^(RBL_|RCVD_IN_|RECEIVED_SPAMHAUS|SEM_IP|MAILSPIKE)/, 'Absender-Server auf einer Sperrliste'],
  [
    /^(R_SPF_FAIL|R_SPF_SOFTFAIL|VIOLATED_DIRECT_SPF)$/,
    'Server darf für die Absender-Domain nicht senden',
  ],
  [/^(DMARC_POLICY_|R_DKIM_REJECT)/, 'Absender-Domain bestätigt die Mail nicht'],
  [/^(FREEMAIL_REPLYTO|REPLYTO_|FORGED_)/, 'Absender oder Antwortadresse vorgetäuscht'],
  [/^(HFILTER_|RDNS_NONE|ONCE_RECEIVED)/, 'Absender-Server stellt sich falsch vor'],
  [/^(SUBJ_|R_BAD_CTE|R_MIXED_CHARSET|MIME_BAD|CTE_CASE|MISSING_|MID_)/, 'auffällig gebaute Mail'],
];

/** The filter's reasons as words, strongest first, at most three. */
export function filterReasons(symbols: readonly string[]): string[] {
  const said = symbols
    .map((symbol) => FILTER_REASONS.find(([pattern]) => pattern.test(symbol))?.[1])
    .filter((one): one is string => !!one);
  return [...new Set(said)].slice(0, 3);
}

/**
 * What Slider moved against the provider, to be checked: into spam by the AI or the filter
 * (it came to the inbox), or out of the provider's spam by the AI. Gone once its person decides
 * („Kein Spam“, „Als Spam markieren“). `null`: it lies where the provider put it.
 */
export function spamMarkOf(thread: SpamPlaced): SpamMarkLook | null {
  if (thread.spam && thread.spamBy === 'ai')
    return {
      label: 'Von KI aussortiert',
      title:
        'Kam im Posteingang an – die KI hält sie für Spam oder Phishing. Stimmt das nicht: „Kein Spam“.',
      tone: 'danger',
      icon: 'report',
    };
  if (thread.spam && thread.spamBy === 'filter') {
    const why = filterReasons(thread.spamSymbols ?? []);
    return {
      label: 'Vom Filter aussortiert',
      title: `Kam im Posteingang an – der Spamfilter hält sie für Spam${why.length ? `: ${why.join(', ')}` : ''}. Stimmt das nicht: „Kein Spam“.`,
      tone: 'danger',
      icon: 'report',
    };
  }
  if (thread.spam && thread.spamBy === 'rule')
    return {
      label: 'Blockiert',
      title:
        'Du hast den Absender blockiert – seine Mails landen hier. Aufheben im Menü oder unter Postfächer.',
      tone: 'neutral',
      icon: 'personRemove',
    };
  if (!thread.spam && thread.spamBy === 'ai')
    return {
      label: 'Aus Spam geholt',
      title:
        'Dein Postfach hat sie in Spam gelegt – die KI hält sie für in Ordnung. Ist sie doch Spam: „Als Spam markieren“.',
      tone: 'warning',
      icon: 'undo',
    };
  return null;
}

/**
 * The menu's word on spam (a row's and the open mail's): „Kein Spam“ or „Als Spam markieren“ –
 * on a mail Slider moved (`spamMarkOf`) the one that keeps it where it lies first: its mark goes,
 * the AI moves it no more. `mark(spam, toast)` says it to the server.
 */
export function spamActions(
  thread: SpamPlaced,
  mark: (spam: boolean, toast: string) => void,
): MenuAction[] {
  const notSpam: MenuAction = {
    label: 'Kein Spam',
    icon: 'mail',
    onSelect: () => mark(false, thread.spam ? 'Zurück im Posteingang' : 'Bleibt im Posteingang'),
  };
  const isSpam: MenuAction = {
    label: 'Als Spam markieren',
    icon: 'report',
    onSelect: () => mark(true, 'Als Spam markiert'),
  };
  // A rule's placing is lifted with the rule (`ruleActions`), not kept by hand.
  const moved = spamMarkOf(thread) !== null && thread.spamBy !== 'rule';
  return thread.spam
    ? moved
      ? [isSpam, notSpam]
      : [notSpam]
    : moved
      ? [notSpam, isSpam]
      : [isSpam];
}

/** One's rule that counts for an address: its own before its firm's. */
export function ruleFor(address: string, rules: readonly MailRule[]): MailRule | null {
  const own = address.trim().toLowerCase();
  const firm = orgDomain(emailDomain(own));
  return (
    rules.find((one) => one.match === 'address' && one.value === own) ??
    rules.find((one) => one.match === 'domain' && one.value === firm) ??
    null
  );
}

/**
 * The menu's rules for a conversation's sender (a row's and the open mail's): in the Posteingang
 * „Absender blockieren“ (and its firm, never a mail provider's domain), in Spam „Absender
 * vertrauen“ – where a rule counts already, only lifting it. `add` and `remove` say it to the
 * server.
 */
export function ruleActions(
  sender: MailRuleSender | null | undefined,
  spam: boolean,
  rules: readonly MailRule[] | undefined,
  add: (kind: MailRuleKind, match: MailRuleMatch, value: string) => void,
  remove: (rule: MailRule) => void,
): MenuAction[] {
  if (!sender || !rules) return [];
  // The server says who and which domain (`ruleSender`): the menu offers only what it takes.
  const own = sender.address;
  const firm = sender.domain;
  const counts = ruleFor(own, rules);
  const named = (rule: Pick<MailRule, 'match' | 'value'>) =>
    rule.match === 'address' ? 'Absender' : rule.value;
  const kind: MailRuleKind = spam ? 'trust' : 'block';
  const offered: { match: MailRuleMatch; value: string }[] = [
    { match: 'address', value: own },
    ...(firm ? [{ match: 'domain' as const, value: firm }] : []),
  ];
  return [
    ...(counts
      ? [
          {
            label:
              counts.kind === 'block'
                ? `${named(counts)} nicht mehr blockieren`
                : `${named(counts)} nicht mehr vertrauen`,
            icon: 'undo' as const,
            onSelect: () => remove(counts),
          },
        ]
      : []),
    // A rule that counts is lifted first: then the menu offers anew.
    ...(counts ? [] : offered).map((one): MenuAction => ({
      label:
        kind === 'block'
          ? one.match === 'address'
            ? 'Absender blockieren'
            : `Alle von ${one.value} blockieren`
          : one.match === 'address'
            ? 'Absender vertrauen'
            : `Allen von ${one.value} vertrauen`,
      icon: kind === 'block' ? 'personRemove' : 'shield',
      title:
        kind === 'block'
          ? 'Neue Mails landen in Spam – auch die bisherigen'
          : 'Landet nie mehr in Spam, wenn die Absender-Domain bestätigt ist',
      onSelect: () => add(kind, one.match, one.value),
    })),
  ].map((action, index) => (index === 0 ? { ...action, divider: true } : action));
}
