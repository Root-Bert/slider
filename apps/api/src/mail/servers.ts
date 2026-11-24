import { isIP } from 'node:net';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import {
  MAIL_FOLDER_NAMES,
  mailProviderOf,
  type MailCheckFailure,
  type MailFolderRole,
} from '@slider/shared';
import type { MailFolderEntry, MailSyncState } from '../db/schema';
import { dnsLookup, isPublicAddress, type LookupAll } from '../sources/safe-fetch';

/*
 * How mailboxes are reached: IMAP to read, SMTP to send – any provider. Behind an interface so
 * tests (and the scratch setup) hand in mails without a server.
 */

export interface MailLogin {
  address: string;
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  /**
   * Signed in through the provider („Mit Microsoft/Google anmelden“): its access token, sent as
   * SASL XOAUTH2 to both servers instead of the password.
   */
  accessToken?: string;
}

/**
 * A folder read, by its key: a special folder's role (`inbox`, `sent`, `archive`, `spam`,
 * `trash`), else its path on the server (`foldersToRead`).
 */
export type MailFolder = string;

export interface FetchedMail {
  folder: MailFolder;
  uid: number;
  raw: Uint8Array;
  /** Read on the server already (IMAP `\Seen`). */
  seen?: boolean;
}

/** A mail's read state on the server: in a folder (by its key), by its UID. */
export interface SeenFlag {
  folder: MailFolder;
  uid: number;
  seen: boolean;
}

/** Read or unread, to set on the server: in the folder at `path`, by UID. */
export interface SeenMark {
  path: string;
  uid: number;
  seen: boolean;
}

/** A mail to move by UID from the folder at `path` to the one at `to`. */
export interface MailMove {
  path: string;
  uid: number;
  to: string;
}

/** Moved: its UID in the folder it went to, where the server tells it (UIDPLUS). */
export interface MailMoved extends MailMove {
  newUid: number | null;
}

/** A mail asked for again by UID in the folder at `path` (`MailServers.headers`). */
export interface HeaderWanted {
  path: string;
  uid: number;
}

/** The header fields asked for of one mail – only those, followed by an empty line. */
export interface FetchedHeader extends HeaderWanted {
  header: Uint8Array;
}

export interface OutgoingMail {
  /** Its `Message-ID` as kept here – the copy in „Gesendet“ is known by it. */
  messageId?: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  attachments?: { name: string; type: string; content: Uint8Array }[];
}

export interface MailServers {
  /**
   * Signs in to both servers; throws with what went wrong. Returns the SMTP way that worked when
   * it is not the one given (`checkSmtp`) – to keep instead.
   */
  check(login: MailLogin): Promise<SmtpSetting | undefined | void>;
  /**
   * The mails that came since `state` – on a folder's first read only its latest few. Returns
   * the state to keep.
   */
  fetch(
    login: MailLogin,
    state: MailSyncState,
  ): Promise<{
    mails: FetchedMail[];
    state: MailSyncState;
    folders?: MailFolderEntry[];
    /** The read state of mails read before, in the folders whose mails count unread (`WATCHED`). */
    flags?: SeenFlag[];
  }>;
  /** Sends; returns the sent mail's `Message-ID`. */
  send(login: MailLogin, mail: OutgoingMail): Promise<{ messageId: string }>;
  /** Sets mails read or unread on the server (`\Seen`); returns those set. */
  mark?(login: MailLogin, marks: readonly SeenMark[]): Promise<SeenMark[]>;
  /** Moves mails to another folder on the server; returns those moved. */
  move?(login: MailLogin, moves: readonly MailMove[]): Promise<MailMoved[]>;
  /**
   * Only the named header fields of mails read before – nothing marked read; a UID no longer
   * there or a folder gone is left out.
   */
  headers?(
    login: MailLogin,
    wanted: readonly HeaderWanted[],
    fields: readonly string[],
  ): Promise<FetchedHeader[]>;
}

/** On a folder's first read: this many of its latest mails. */
export const FIRST_READ = 30;
/** At most this many mails per round, all folders together – the rest comes the next round. */
const PER_ROUND = 100;
const TIMEOUT_MS = 20_000;
/** A mail larger is left on the server (attachments up to 25 MB, base64 makes them a third more). */
export const MAX_RAW_BYTES = 40 * 1024 * 1024;
/** What one round reads at most, all folders together – the next round goes on where it stopped. */
const BYTES_PER_ROUND = 200 * 1024 * 1024;
/** One mailbox's whole round; a server dragging it out is cut off. */
const ROUND_MS = 3 * 60 * 1000;
/**
 * The folders whose mails count unread (mail.ts `ARRIVES`): there the read state of the mails read
 * before is asked again each round – what changed since (CONDSTORE), else of the latest few.
 */
const WATCHED = new Set(['inbox', 'spam']);
/** Mails whose header fields one FETCH asks for (`headers`). */
const HEADERS_PER_FETCH = 400;
/** Without CONDSTORE: the read state of this many latest mails, each round. */
export const FLAGS_WINDOW = 300;

/** A server named for a mailbox that is no public one – the network inside, the cloud's metadata. */
export class MailHostBlocked extends Error {}

/**
 * Where a mailbox's server is reached: the address its name resolves to, only when every one of
 * them is public (a name may not lead into the network the server stands in). The connection
 * goes to that very address – the name resolving anew in between (DNS rebinding) changes
 * nothing – while TLS still checks the certificate against the name.
 */
export async function mailHostAddress(
  host: string,
  side: 'IMAP' | 'SMTP',
  lookup: LookupAll = dnsLookup,
): Promise<string> {
  const blocked = () =>
    new MailHostBlocked(
      `Der ${side}-Server ist keine öffentliche Adresse – stimmt der Servername?`,
    );
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw blocked();
    return host;
  }
  let found: readonly { address: string }[];
  try {
    found = await lookup(host);
  } catch {
    throw new Error(`Den ${side}-Server gibt es nicht – stimmt der Servername?`);
  }
  const first = found[0]?.address;
  if (!first || found.some((one) => !isPublicAddress(one.address))) throw blocked();
  return first;
}

/** imapflow's settings for a mailbox, reached at `address` (`mailHostAddress`). */
export const imapOptions = (login: MailLogin, address: string) => ({
  host: address,
  ...(isIP(login.imapHost) ? {} : { servername: login.imapHost }),
  port: login.imapPort,
  secure: login.imapSecure,
  // Without TLS from the start, STARTTLS or nothing – never the password in the clear.
  ...(login.imapSecure ? {} : { doSTARTTLS: true }),
  // An access token: AUTHENTICATE XOAUTH2 (`user=…^Aauth=Bearer …^A^A`), never a password.
  auth: login.accessToken
    ? { user: login.username, accessToken: login.accessToken }
    : { user: login.username, pass: login.password },
  logger: false as const,
  connectionTimeout: TIMEOUT_MS,
  greetingTimeout: TIMEOUT_MS,
  socketTimeout: 60_000,
});

async function imap(login: MailLogin): Promise<ImapFlow> {
  return new ImapFlow(imapOptions(login, await mailHostAddress(login.imapHost, 'IMAP')));
}

/** nodemailer's settings for a mailbox, reached at `address` (`mailHostAddress`). */
export const smtpOptions = (login: MailLogin, address: string) => ({
  host: address,
  port: login.smtpPort,
  secure: login.smtpSecure,
  requireTLS: !login.smtpSecure,
  ...(isIP(login.smtpHost) ? {} : { tls: { servername: login.smtpHost } }),
  // An access token: AUTH XOAUTH2 with it as it is – nodemailer asks nobody for a new one.
  auth: login.accessToken
    ? { type: 'OAuth2' as const, user: login.username, accessToken: login.accessToken }
    : { user: login.username, pass: login.password },
  connectionTimeout: TIMEOUT_MS,
  greetingTimeout: TIMEOUT_MS,
  socketTimeout: 60_000,
});

async function smtp(login: MailLogin) {
  return createTransport(smtpOptions(login, await mailHostAddress(login.smtpHost, 'SMTP')));
}

/** A mailbox not let in: the sentence to show, the step where it stopped, the server's words. */
export class MailCheckError extends Error {
  constructor(
    message: string,
    readonly failure: MailCheckFailure,
  ) {
    super(message);
    this.name = 'MailCheckError';
  }
}

/** Microsoft's mail servers: since 2024 only OAuth signs in there, a password never. */
const MICROSOFT_HOST = /(^|\.)(office365\.com|outlook\.com)$/i;

/**
 * What a server answered to a sign-in, to show: one line, short, without the password, the
 * username or an address inside – and without IMAP's tag or the trace Microsoft appends
 * (`[BE1P…COM 2026-…]`).
 */
export function serverWords(text: unknown, login?: Pick<MailLogin, 'username' | 'password'>) {
  if (typeof text !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  let words = text.replace(/[\x00-\x1f\x7f]+/g, ' ');
  for (const secret of [login?.password, login?.username])
    if (secret && secret.length >= 3) words = words.split(secret).join('…');
  words = words
    .replace(/\[[^\]]*\d{4}-\d{2}-\d{2}[^\]]*\]/g, '')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    // IMAP's tag and status before the words (`3 NO …`).
    .replace(/^[A-Za-z0-9.]+ (NO|BAD) /, '');
  if (!words) return undefined;
  return words.length > 160 ? `${words.slice(0, 159)}…` : words;
}

/**
 * Why a server did not let a mailbox in: the step, a sentence a person can act on (with what to
 * try at their provider), and – for a refused sign-in – the server's own words.
 */
export function mailFailure(
  error: unknown,
  side: 'IMAP' | 'SMTP',
  login?: Pick<MailLogin, 'address' | 'username' | 'password' | 'imapHost' | 'smtpHost'> &
    Partial<Pick<MailLogin, 'accessToken'>>,
): { text: string } & MailCheckFailure {
  const lower = side === 'IMAP' ? 'imap' : 'smtp';
  if (error instanceof MailHostBlocked) return { text: error.message, step: `${lower}-server` };
  const raw = error instanceof Error ? error.message : String(error);
  const err = error as {
    authenticationFailed?: boolean;
    tlsFailed?: boolean;
    code?: string;
    responseCode?: number;
    response?: unknown;
  };
  const code = err.code ?? '';
  const provider = login ? mailProviderOf(login.address) : null;
  const host = side === 'IMAP' ? login?.imapHost : login?.smtpHost;
  if (err.authenticationFailed || code === 'EAUTH' || err.responseCode === 535) {
    // The server offers no password sign-in at all (IMAP's LOGINDISABLED without AUTH=PLAIN),
    // or it is Microsoft's, which has refused every password since 2024.
    const response = typeof err.response === 'string' ? err.response : '';
    const noPassword =
      raw === 'Login is disabled' ||
      /5\.7\.139|basic auth\w* is disabled|SmtpClientAuthentication is disabled/i.test(response) ||
      (!!host && MICROSOFT_HOST.test(host));
    const serverSays = raw === 'Login is disabled' ? undefined : serverWords(response, login);
    const step = `${lower}-login` as const;
    if (login?.accessToken) {
      // Signed in through the provider and still refused: the server takes no mail programs.
      const gmail = /(^|\.)gmail\.com$/i.test(host ?? '');
      return {
        text: `Der ${side}-Server hat die Anmeldung über ${gmail ? 'Google' : 'Microsoft'} abgelehnt. ${
          gmail
            ? 'Ist IMAP in Gmail eingeschaltet (Einstellungen › Weiterleitung und POP/IMAP)?'
            : 'Ist IMAP in Outlook eingeschaltet (Einstellungen › E-Mail › Weiterleitung und IMAP)? Bei einer Firma kann es die IT abgeschaltet haben.'
        } Sonst melde dich neu an.`,
        step,
        ...(serverSays ? { serverSays } : {}),
      };
    }
    if (noPassword)
      return {
        text:
          (host && MICROSOFT_HOST.test(host) && provider?.noPassword) ||
          `Der ${side}-Server nimmt keine Passwörter an, auch keine App-Passwörter – nur die Anmeldung über den Anbieter selbst (OAuth). Die kann Office noch nicht.`,
        step,
        ...(serverSays ? { serverSays } : {}),
      };
    return {
      text: `Der ${side}-Server hat die Anmeldung abgelehnt – Benutzername oder Passwort nimmt er nicht an. ${
        provider?.refused ??
        'Manche Anbieter wollen ein App-Passwort, oder dass Mail-Programme in ihren Einstellungen erlaubt sind.'
      }`,
      step,
      ...(serverSays ? { serverSays } : {}),
    };
  }
  if (code === 'ENOTFOUND' || code === 'EDNS' || /^Den (IMAP|SMTP)-Server gibt es nicht/.test(raw))
    return {
      text: `Den ${side}-Server gibt es nicht – stimmt der Servername?`,
      step: `${lower}-server`,
    };
  if (
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ALTNAME/i.test(code) ||
    /certificate/i.test(raw)
  )
    return {
      text: `Dem Zertifikat des ${side}-Servers traut Office nicht – es passt nicht zu seinem Namen oder ist abgelaufen. Stimmen Servername und Port?`,
      step: `${lower}-tls`,
    };
  // Encryption that does not fit the port: TLS against a plain port fails the handshake, plain
  // against a TLS port waits for a greeting that never comes.
  if (
    err.tlsFailed ||
    code === 'ETLS' ||
    code === 'GREETING_TIMEOUT' ||
    code.startsWith('ERR_SSL') ||
    /wrong version number|SSL routines|STARTTLS|Greeting never received/i.test(raw)
  )
    return {
      text: `Der ${side}-Server ist erreicht, aber verschlüsselt nicht so wie eingestellt – passen Port und „Verschlüsselt (SSL/TLS)“ zusammen? Üblich: ${
        side === 'IMAP' ? '993 verschlüsselt, 143 ohne' : '465 verschlüsselt, 587 ohne'
      } (dann per STARTTLS).`,
      step: `${lower}-tls`,
    };
  if (silent(code, raw))
    return {
      text: `Der ${side}-Server antwortet nicht – stimmen Server und Port?`,
      step: `${lower}-server`,
    };
  // Nothing of what the server said: a banner or an error from inside tells too much.
  return {
    text: `Der ${side}-Server lehnt die Verbindung ab – stimmen Server, Port und Verschlüsselung?`,
    step: `${lower}-server`,
  };
}

/** No answer at all from the server's port: refused, dropped, timed out – not even a refusal. */
const silent = (code: string, raw: string) =>
  [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'CONNECT_TIMEOUT',
    'ECONNECTION',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ].includes(code) || /timeout/i.test(raw);

/** How a mailbox sends: the SMTP port and whether TLS starts at once (else STARTTLS). */
export type SmtpSetting = Pick<MailLogin, 'smtpPort' | 'smtpSecure'>;

/** The other usual way into the same SMTP server: 465 with TLS at once ↔ 587 with STARTTLS. */
export function otherSmtp({ smtpPort, smtpSecure }: SmtpSetting): SmtpSetting | undefined {
  if (smtpPort === 465 && smtpSecure) return { smtpPort: 587, smtpSecure: false };
  if (smtpPort === 587 && !smtpSecure) return { smtpPort: 465, smtpSecure: true };
  return undefined;
}

async function verifySmtp(login: MailLogin) {
  const transport = await smtp(login);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/**
 * Signs in to SMTP. A port that does not answer at all is tried the other usual way
 * (`otherSmtp`): many hosts block 465 or 587 going out (Hetzner, AWS, … block 465), and a
 * person cannot know that. Only the same server, and never in the clear – 587 requires STARTTLS
 * (`smtpOptions`), the certificate is checked against the name either way. Returns the way that
 * worked when it was the other one; a refusal there (a password, say) tells more than silence.
 */
export async function checkSmtp(
  login: MailLogin,
  verify: (login: MailLogin) => Promise<void> = verifySmtp,
): Promise<SmtpSetting | undefined> {
  try {
    await verify(login);
    return undefined;
  } catch (error) {
    const other = otherSmtp(login);
    const unanswered = (one: unknown) =>
      mailFailure(one, 'SMTP', login).step === 'smtp-server' &&
      silent((one as { code?: string }).code ?? '', one instanceof Error ? one.message : '');
    if (!other || !unanswered(error)) throw checkError(error, 'SMTP', login);
    const next = { ...login, ...other };
    try {
      await verify(next);
      return other;
    } catch (second) {
      throw unanswered(second)
        ? checkError(error, 'SMTP', login)
        : checkError(second, 'SMTP', next);
    }
  }
}

/** What a server's refusal means, in a sentence a person can act on. */
export const mailErrorText = (
  error: unknown,
  side: 'IMAP' | 'SMTP',
  login?: Parameters<typeof mailFailure>[2],
): string => mailFailure(error, side, login).text;

/** The same as an error that carries the step and the server's words to the form. */
function checkError(error: unknown, side: 'IMAP' | 'SMTP', login: MailLogin): MailCheckError {
  const { text, ...failure } = mailFailure(error, side, login);
  return new MailCheckError(text, failure);
}

interface EnvelopeAddress {
  name?: string;
  address?: string;
}

/** What the server says of a mail without handing it over (IMAP's envelope). */
export interface MailEnvelope {
  date?: Date | string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  from?: EnvelopeAddress[];
  to?: EnvelopeAddress[];
  cc?: EnvelopeAddress[];
}

const addresses = (list: EnvelopeAddress[] | undefined) =>
  (list ?? [])
    .filter((one) => !!one.address)
    .map((one) => ({ name: one.name ?? '', address: one.address ?? '' }));

/**
 * A mail too large to fetch, as a short mail of its own: who, when, what about – and that it is
 * read in the mailbox. Its `Message-ID` is the mail's (or one made of its place), so it comes once.
 */
export async function tooLargeMail(
  envelope: MailEnvelope,
  bytes: number,
  place: string,
): Promise<Uint8Array> {
  const date = envelope.date ? new Date(envelope.date) : new Date();
  const composer = new MailComposer({
    from: addresses(envelope.from)[0] ?? 'unbekannt@invalid',
    to: addresses(envelope.to),
    cc: addresses(envelope.cc),
    subject: envelope.subject ?? '',
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    messageId: envelope.messageId || `<too-large-${place}@slider>`,
    inReplyTo: envelope.inReplyTo || undefined,
    text: `Diese Mail ist zu groß für Office (${Math.ceil(bytes / (1024 * 1024))} MB). Lies sie in deinem Postfach beim Anbieter.`,
  });
  const built = await new Promise<Buffer>((resolve, reject) =>
    composer.compile().build((error, message) => (error ? reject(error) : resolve(message))),
  );
  return new Uint8Array(built);
}

/** What a round has read so far: kept also when it is cut off. */
export interface Round {
  mails: FetchedMail[];
  state: MailSyncState;
  /** The read state of mails read before (`WATCHED` folders). */
  flags?: SeenFlag[];
  /** What the round may still read – shared by its folders (`PER_ROUND`, `BYTES_PER_ROUND`). */
  left?: { mails: number; bytes: number };
}

/** A folder as the server lists it (imapflow's `list()`). */
export interface ListedFolder {
  path: string;
  delimiter?: string;
  flags: Set<string>;
  specialUse?: string;
  subscribed?: boolean;
}

/**
 * The special folders read, by their flag. Not read: `\All` (Gmail's „Alle Nachrichten“),
 * `\Flagged` and `\Important` – they hold the other folders’ mails again – and `\Drafts`.
 */
const ROLE_OF: Record<string, MailFolderRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Archive': 'archive',
  '\\Junk': 'spam',
  '\\Trash': 'trash',
};
const ROLE_ORDER: readonly MailFolderRole[] = ['inbox', 'sent', 'archive', 'spam', 'trash'];
const SKIPPED = new Set(['\\All', '\\Flagged', '\\Important', '\\Drafts']);

/**
 * The folders of a mailbox to read, in the order they are read: the inbox first, then the special
 * ones (Gesendet, Archiv, Spam, Papierkorb), then its own by name. Not what cannot be opened
 * (`\Noselect`), not what only gathers other folders' mails (`SKIPPED`); where the server marks
 * some subscribed, only those (as mail programs show them). An own folder is named by its path
 * („Kunden / Acme“, without a leading „INBOX.“ where everything lies inside the inbox).
 */
export function foldersToRead(listed: readonly ListedFolder[]): MailFolderEntry[] {
  const subscribing = listed.some((one) => one.subscribed);
  const roles = new Set<MailFolderRole>();
  const special: MailFolderEntry[] = [];
  const own: MailFolderEntry[] = [];
  for (const box of listed) {
    if (box.flags.has('\\Noselect') || box.flags.has('\\NonExistent')) continue;
    const inbox = box.path.toUpperCase() === 'INBOX';
    const use = inbox ? '\\Inbox' : box.specialUse;
    if (use && SKIPPED.has(use)) continue;
    const role = use ? ROLE_OF[use] : undefined;
    if (role && !roles.has(role)) {
      roles.add(role);
      special.push({
        key: role,
        path: inbox ? 'INBOX' : box.path,
        name: MAIL_FOLDER_NAMES[role],
        role,
      });
      continue;
    }
    if (subscribing && !box.subscribed) continue;
    const parts = box.delimiter ? box.path.split(box.delimiter) : [box.path];
    if (parts.length > 1 && parts[0]?.toUpperCase() === 'INBOX') parts.shift();
    // A path the same as a role's key would read as that folder: left out (imapflow takes such
    // names for the special folders already, unless the server named another one).
    if ((ROLE_ORDER as readonly string[]).includes(box.path)) continue;
    own.push({ key: box.path, path: box.path, name: parts.join(' / '), role: null });
  }
  const order = (entry: MailFolderEntry) => ROLE_ORDER.indexOf(entry.role ?? 'inbox');
  return [
    ...special.toSorted((one, other) => order(one) - order(other)),
    ...own.toSorted((one, other) => one.name.localeCompare(other.name, 'de')),
  ];
}

export async function readFolder(
  client: Pick<ImapFlow, 'getMailboxLock' | 'mailbox' | 'fetch'> &
    Partial<Pick<ImapFlow, 'enabled'>>,
  path: string,
  folder: MailFolder,
  round: Round,
): Promise<void> {
  const known = round.state[folder];
  const left = (round.left ??= { mails: PER_ROUND, bytes: BYTES_PER_ROUND });
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const box = client.mailbox;
    if (!box) return;
    const validity = String(box.uidValidity);
    // Where mails count unread, the server's change counter (CONDSTORE) is kept with the place:
    // the next round asks only what changed since.
    const watched = WATCHED.has(folder);
    const condstore =
      watched && !!client.enabled?.has('CONDSTORE') && !!box.highestModseq && !box.noModseq;
    const mod = condstore ? { modseq: String(box.highestModseq) } : {};
    let next = box.uidNext;
    if (known && known.validity === validity) {
      next = known.next;
      // The mails read before: read or unread meanwhile (in a mail program, on the phone).
      const unchanged = condstore && known.modseq === String(box.highestModseq);
      if (watched && box.exists > 0 && next > 1 && !unchanged) {
        const flags = (round.flags ??= []);
        const since = condstore && known.modseq ? BigInt(known.modseq) : null;
        const range = since ? `1:${next - 1}` : `${Math.max(1, box.exists - FLAGS_WINDOW + 1)}:*`;
        for await (const message of client.fetch(
          range,
          { uid: true, flags: true },
          since ? { uid: true, changedSince: since } : {},
        )) {
          if (message.uid >= next || !message.flags) continue;
          flags.push({ folder, uid: message.uid, seen: message.flags.has('\\Seen') });
        }
      }
    } else if (box.exists > 0) {
      // First read: the latest few by their place in the folder – UIDs need not follow each other
      // (Outlook's leave wide gaps, so `uidNext - FIRST_READ` held one mail or none).
      const from = Math.max(1, box.exists - FIRST_READ + 1);
      for await (const message of client.fetch(`${from}:*`, { uid: true }))
        next = Math.min(next, message.uid);
    }
    round.state[folder] = { validity, next, ...mod };
    // First their sizes: what is too large is told of, a round stays within its bytes.
    const seen: number[] = [];
    const wanted: number[] = [];
    const large = new Map<number, number>();
    let full = false;
    if (box.exists > 0 && next < box.uidNext) {
      let bytes = 0;
      for await (const message of client.fetch(
        `${next}:*`,
        { uid: true, size: true },
        { uid: true },
      )) {
        // `n:*` hands the last mail even when it is older than n.
        if (message.uid < next) continue;
        const size = message.size ?? 0;
        if (size <= MAX_RAW_BYTES && wanted.length > 0 && bytes + size > left.bytes) {
          full = true;
          break;
        }
        seen.push(message.uid);
        if (size <= MAX_RAW_BYTES) {
          wanted.push(message.uid);
          bytes += size;
        } else large.set(message.uid, size);
        if (seen.length >= left.mails) {
          full = true;
          break;
        }
      }
      left.mails -= seen.length;
      left.bytes -= bytes;
    }
    const last = seen.at(-1);
    const done = full && last ? last + 1 : Math.max(next, box.uidNext);
    if (large.size > 0) {
      for await (const message of client.fetch(
        [...large.keys()].join(','),
        { uid: true, envelope: true, flags: true },
        { uid: true },
      )) {
        const raw = await tooLargeMail(
          message.envelope ?? {},
          large.get(message.uid) ?? 0,
          `${folder}-${validity}-${message.uid}`,
        );
        round.mails.push({ folder, uid: message.uid, raw, seen: !!message.flags?.has('\\Seen') });
      }
    }
    // Mail by mail: cut off, the next round goes on after the last one read whole.
    const got = new Set<number>();
    let waiting = 0;
    const advance = () => {
      while (waiting < wanted.length && got.has(wanted[waiting]!)) waiting += 1;
      round.state[folder] = { validity, next: wanted[waiting] ?? done, ...mod };
    };
    if (wanted.length > 0) {
      for await (const message of client.fetch(
        wanted.join(','),
        { uid: true, source: true, flags: true },
        { uid: true },
      )) {
        got.add(message.uid);
        if (message.source && message.source.length <= MAX_RAW_BYTES)
          round.mails.push({
            folder,
            uid: message.uid,
            raw: new Uint8Array(message.source),
            seen: !!message.flags?.has('\\Seen'),
          });
        advance();
      }
    }
    round.state[folder] = { validity, next: done, ...mod };
  } finally {
    lock.release();
  }
}

export const realMailServers: MailServers = {
  async check(login) {
    const client = await imap(login).catch((error: unknown) => {
      throw checkError(error, 'IMAP', login);
    });
    try {
      await client.connect();
    } catch (error) {
      throw checkError(error, 'IMAP', login);
    } finally {
      await client.logout().catch(() => client.close());
    }
    return checkSmtp(login);
  },

  async fetch(login, state) {
    const client = await imap(login);
    try {
      await client.connect();
    } catch (error) {
      throw new Error(mailErrorText(error, 'IMAP', login), { cause: error });
    }
    let late = false;
    const deadline = setTimeout(() => {
      late = true;
      client.close();
    }, ROUND_MS);
    const round: Round = {
      mails: [],
      state: { ...state },
      left: { mails: PER_ROUND, bytes: BYTES_PER_ROUND },
    };
    let folders: MailFolderEntry[] = [];
    try {
      folders = foldersToRead(await client.list());
      // A folder gone from the server is forgotten; read again, it starts with a first read.
      for (const key of Object.keys(round.state))
        if (!folders.some((one) => one.key === key)) delete round.state[key];
      if (!folders.some((one) => one.key === 'inbox'))
        folders.unshift({
          key: 'inbox',
          path: 'INBOX',
          name: MAIL_FOLDER_NAMES.inbox,
          role: 'inbox',
        });
      // The inbox first; once the round's budget is spent, the rest waits for the next round.
      for (const one of folders) {
        if (round.left && (round.left.mails <= 0 || round.left.bytes <= 0)) break;
        await readFolder(client, one.path, one.key, round);
      }
      return { ...round, folders };
    } catch (error) {
      // Cut off: what came is kept, the next round goes on from there.
      if (late && round.mails.length > 0)
        return { ...round, ...(folders.length ? { folders } : {}) };
      if (late)
        throw new Error('Der IMAP-Server braucht zu lange – es geht beim nächsten Abruf weiter.', {
          cause: error,
        });
      throw new Error(mailErrorText(error, 'IMAP', login), { cause: error });
    } finally {
      clearTimeout(deadline);
      if (!late) await client.logout().catch(() => client.close());
    }
  },

  async mark(login, marks) {
    const client = await imap(login);
    try {
      await client.connect();
    } catch (error) {
      throw new Error(mailErrorText(error, 'IMAP', login), { cause: error });
    }
    const done: SeenMark[] = [];
    try {
      for (const path of new Set(marks.map((one) => one.path))) {
        const some = marks.filter((one) => one.path === path);
        // Opened to write (SELECT); a UID no longer there (moved, deleted) changes nothing.
        const lock = await client.getMailboxLock(path);
        try {
          for (const seen of [true, false]) {
            const these = some.filter((one) => one.seen === seen);
            if (these.length === 0) continue;
            const range = these.map((one) => one.uid).join(',');
            const stored = seen
              ? await client.messageFlagsAdd(range, ['\\Seen'], { uid: true, silent: true })
              : await client.messageFlagsRemove(range, ['\\Seen'], { uid: true, silent: true });
            if (stored) done.push(...these);
          }
        } finally {
          lock.release();
        }
      }
      return done;
    } finally {
      await client.logout().catch(() => client.close());
    }
  },

  async move(login, moves) {
    const client = await imap(login);
    try {
      await client.connect();
    } catch (error) {
      throw new Error(mailErrorText(error, 'IMAP', login), { cause: error });
    }
    const done: MailMoved[] = [];
    try {
      for (const path of new Set(moves.map((one) => one.path))) {
        const lock = await client.getMailboxLock(path);
        try {
          for (const to of new Set(moves.filter((one) => one.path === path).map((one) => one.to))) {
            const these = moves.filter((one) => one.path === path && one.to === to);
            // MOVE (RFC 6851), else copied and expunged (imapflow); a UID no longer there moves
            // nothing.
            const moved = await client.messageMove(these.map((one) => one.uid).join(','), to, {
              uid: true,
            });
            if (moved)
              done.push(
                ...these.map((one) => ({ ...one, newUid: moved.uidMap?.get(one.uid) ?? null })),
              );
          }
        } finally {
          lock.release();
        }
      }
      return done;
    } finally {
      await client.logout().catch(() => client.close());
    }
  },

  async headers(login, wanted, fields) {
    const client = await imap(login);
    try {
      await client.connect();
    } catch (error) {
      throw new Error(mailErrorText(error, 'IMAP', login), { cause: error });
    }
    const found: FetchedHeader[] = [];
    try {
      for (const path of new Set(wanted.map((one) => one.path))) {
        const uids = wanted.filter((one) => one.path === path).map((one) => one.uid);
        let lock: Awaited<ReturnType<ImapFlow['getMailboxLock']>>;
        try {
          // Opened to read (EXAMINE): nothing marked read.
          lock = await client.getMailboxLock(path, { readOnly: true });
        } catch {
          continue;
        }
        try {
          // In parts: a server takes a command line only so long.
          for (let at = 0; at < uids.length; at += HEADERS_PER_FETCH)
            for await (const message of client.fetch(
              uids.slice(at, at + HEADERS_PER_FETCH).join(','),
              { uid: true, headers: [...fields] },
              { uid: true },
            ))
              if (message.headers)
                found.push({ path, uid: message.uid, header: new Uint8Array(message.headers) });
        } finally {
          lock.release();
        }
      }
      return found;
    } finally {
      await client.logout().catch(() => client.close());
    }
  },

  async send(login, mail) {
    const transport = await smtp(login);
    try {
      const info = await transport.sendMail({
        from: login.name ? { name: login.name, address: login.address } : login.address,
        to: mail.to,
        cc: mail.cc.length > 0 ? mail.cc : undefined,
        bcc: mail.bcc && mail.bcc.length > 0 ? mail.bcc : undefined,
        messageId: mail.messageId,
        attachments: mail.attachments?.map((one) => ({
          filename: one.name,
          contentType: one.type,
          content: Buffer.from(one.content),
        })),
        subject: mail.subject,
        text: mail.text,
        inReplyTo: mail.inReplyTo ?? undefined,
        references: mail.references.length > 0 ? mail.references : undefined,
      });
      return { messageId: info.messageId };
    } catch (error) {
      throw new Error(mailErrorText(error, 'SMTP', login), { cause: error });
    } finally {
      transport.close();
    }
  },
};
