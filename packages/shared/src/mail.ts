import { z } from 'zod';

/*
 * Mail in Sender: a person's mailboxes (IMAP to read, SMTP to send, any provider) in a workspace.
 * What a colleague of the workspace mails them – signed by their domain – lands in their direct
 * conversation in Sender; everything else is a mail conversation beside the chats, with what the
 * AI makes of it (what it is about, which files belong to it, where its attachments could go).
 */

/** `signin`: Microsoft or Google ended its sign-in (revoked, expired) – its person signs in anew. */
export const MAIL_ACCOUNT_STATES = ['new', 'ok', 'error', 'signin'] as const;
export type MailAccountState = (typeof MAIL_ACCOUNT_STATES)[number];

/** Who a mailbox can sign in through instead of a password (OAuth, XOAUTH2 to IMAP and SMTP). */
export const MAIL_OAUTH_PROVIDERS = ['microsoft', 'google'] as const;
export type MailOAuthProvider = (typeof MAIL_OAUTH_PROVIDERS)[number];
export const MAIL_OAUTH_LABELS: Record<MailOAuthProvider, string> = {
  microsoft: 'Microsoft',
  google: 'Google',
};
/** How a mailbox signs in: its password, or through its provider („Mit Microsoft anmelden“). */
export type MailSignIn = 'password' | MailOAuthProvider;

/** A mailbox as its owner sees it – never its password. */
export interface MailAccount {
  id: string;
  address: string;
  /** The name mails go out under. */
  name: string;
  /** What its person called it („Arbeit“) – `null`: its default name (`mailboxLabels`). */
  label: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  signIn: MailSignIn;
  state: MailAccountState;
  error: string | null;
  lastSyncAt: string | null;
  /** Whether the workspace's AI reads its new mails by itself. */
  aiReads: boolean;
  /** Its folders in the order they show (`mailFolderList`): Posteingang first. */
  folders: MailFolder[];
}

/**
 * The folders Slider names itself, in the order they show. Drafts are not read: an unsent draft
 * would join its conversation as if sent, and each autosave would be a mail of its own.
 */
export const MAIL_FOLDER_ROLES = ['inbox', 'sent', 'archive', 'spam', 'trash'] as const;
export type MailFolderRole = (typeof MAIL_FOLDER_ROLES)[number];
export const MAIL_FOLDER_NAMES: Record<MailFolderRole, string> = {
  inbox: 'Posteingang',
  sent: 'Gesendet',
  archive: 'Archiv',
  spam: 'Spam',
  trash: 'Papierkorb',
};

/**
 * A folder of a mailbox: `key` is a special folder's role (`inbox`, `sent` …), else the folder's
 * path on the server; `name` as it shows („Kunden / Acme“ for a folder inside another).
 */
export interface MailFolder {
  key: string;
  name: string;
  role: MailFolderRole | null;
}

/**
 * A mailbox's folders as they show: Posteingang, Gesendet and Spam always (Slider's own sent
 * mails and what the AI calls spam lie there even without such a folder on the server), the other
 * special ones where the server has them, then its own folders by name.
 */
export function mailFolderList(kept: readonly MailFolder[]): MailFolder[] {
  const roles = MAIL_FOLDER_ROLES.flatMap((role): MailFolder[] =>
    kept.some((one) => one.role === role) || role === 'inbox' || role === 'sent' || role === 'spam'
      ? [{ key: role, name: MAIL_FOLDER_NAMES[role], role }]
      : [],
  );
  const own = kept
    .filter((one) => !one.role)
    .toSorted((one, other) => one.name.localeCompare(other.name, 'de'));
  return [...roles, ...own.map(({ key, name }) => ({ key, name, role: null }))];
}

/** A mailbox's own name, at most this long – trimmed; empty: back to its default. */
export const MAX_MAILBOX_LABEL = 60;
export const mailboxLabelSchema = z
  .string()
  .trim()
  .max(MAX_MAILBOX_LABEL, `Höchstens ${MAX_MAILBOX_LABEL} Zeichen.`);

/**
 * A mailbox's default name: who it signs in through („Google“, „Microsoft“), else its provider
 * („GMX“, „iCloud“), else its domain.
 */
export function mailboxDefaultLabel(
  account: Pick<MailAccount, 'address'> & { signIn?: MailSignIn },
): string {
  const provider = mailProviderOf(account.address);
  return account.signIn === 'google' || provider?.oauth === 'google'
    ? 'Google'
    : account.signIn === 'microsoft' || provider?.oauth === 'microsoft'
      ? 'Microsoft'
      : (provider?.name ?? account.address.split('@')[1] ?? account.address);
}

/**
 * What a mailbox is called among one's others: the name its person gave it, else its default
 * (`mailboxDefaultLabel`) – two of the same default by their addresses.
 */
export function mailboxLabels(
  accounts: readonly Pick<MailAccount, 'id' | 'address' | 'signIn' | 'label'>[],
): Map<string, string> {
  const named = accounts.map((account) => ({
    id: account.id,
    address: account.address,
    label: account.label,
    by: mailboxDefaultLabel(account),
  }));
  return new Map(
    named.map((one) => [
      one.id,
      one.label ||
        (named.filter((other) => !other.label && other.by === one.by).length > 1
          ? one.address
          : one.by),
    ]),
  );
}

export interface MailPerson {
  address: string;
  name: string;
  /** The workspace's person with that address – set on a conversation's `people` only. */
  userId?: string | null;
  /**
   * A mail here from this address was vouched for by its domain (`MailAuth` `pass`) – on a
   * conversation's `people` only; only then does its firm's logo stand for it.
   */
  vouched?: boolean;
}

export interface MailAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

/**
 * How the sender's domain vouched for a mail (the receiving server's `Authentication-Results`):
 * `pass` – DMARC, or DKIM of the sender's own domain; `fail` – it said no; `none` – nothing said.
 */
export type MailAuth = 'pass' | 'fail' | 'none';

export interface MailMessage {
  id: string;
  from: MailPerson;
  to: MailPerson[];
  cc: MailPerson[];
  subject: string;
  text: string;
  sentAt: string;
  /** Written here (a reply), not received. */
  outgoing: boolean;
  auth: MailAuth;
  attachments: MailAttachment[];
  /**
   * It has an HTML part: shown as the mail looks, a page of its own in a sandboxed frame
   * (`GET /mail/threads/:id/messages/:messageId/html`, `?bilder=1` with pictures from outside).
   */
  html?: boolean;
  /** Its blind copies – only on a mail written here. */
  bcc?: MailPerson[];
  /** Written here and not out yet (`MailOutbox`); none once sent. */
  outbox?: MailOutbox;
}

/**
 * A mail in the outbox: `queued` goes out at `at` and can be taken back until then; `sending`
 * goes out right now; `failed` did not go (`error` says why) – sent again or taken back.
 */
export interface MailOutbox {
  state: 'queued' | 'sending' | 'failed';
  at: string;
  error: string | null;
}

/** How long a mail waits in the outbox before it really goes – the longest one may set. */
export const MAX_MAIL_DELAY_SECONDS = 3600;

/** One file put on a mail at most, and all of a mail's together – as mail servers take them. */
export const MAX_MAIL_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_MAIL_ATTACHED_BYTES = 25 * 1024 * 1024;
export const MAX_MAIL_UPLOADS = 20;

/** A file put on a mail being written (`POST /mail/accounts/:id/uploads`), until it goes. */
export const mailUploadSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(300),
  type: z.string().max(200),
  size: z.number().int().min(0),
});
export type MailUpload = z.infer<typeof mailUploadSchema>;
const mailUploadIds = z.array(z.string().min(1).max(200)).max(MAX_MAIL_UPLOADS).default([]);

/**
 * „Aktualisieren“ (Einstellungen › Mail): how often one's mailboxes are read from their servers,
 * in minutes – 1 the clock's round (the default), 0 only when asked (the button over the list).
 */
export const MAIL_SYNC_MINUTES = [1, 5, 15, 60, 0] as const;
export type MailSyncMinutes = (typeof MAIL_SYNC_MINUTES)[number];
export const mailSyncSchema = z.object({
  minutes: z
    .number()
    .int()
    .refine((value) => (MAIL_SYNC_MINUTES as readonly number[]).includes(value)),
});
export interface MailSync {
  minutes: MailSyncMinutes;
}

/** A mail conversation in the side bar, beside the chats. */
export interface MailThreadSummary {
  id: string;
  accountId: string;
  subject: string;
  /** Who it is with – the other side of its latest mail. */
  person: MailPerson;
  /** Everyone on it but the mailbox itself, colleagues with their `userId`. */
  people: MailPerson[];
  /** Its latest words, short. */
  snippet: string;
  unread: number;
  spam: boolean;
  updatedAt: string;
  /** When its person pinned it („Anpinnen“, `senderPinSchema`): atop its list, the latest first. */
  pinnedAt?: string | null;
}

export const MAIL_VERDICTS = ['ok', 'spam', 'phishing'] as const;
export type MailVerdict = (typeof MAIL_VERDICTS)[number];

/** A file or presentation the AI found belonging to a mail conversation. */
export interface MailContextDocument {
  kind: 'file' | 'deck';
  id: string;
  name: string;
  /** Where it lies („Marketing / Messe“), or the presentation's folder. */
  place: string;
  why: string;
}

/** A page outside worth a look, named for what it is („Website acme.com“). */
export interface MailContextLink {
  label: string;
  url: string;
}

/** Where the AI would put an attachment: a folder of Cloud (an area's root when `parentId` null). */
export interface MailContextFiling {
  attachmentId: string;
  areaId: string | null;
  parentId: string | null;
  place: string;
  why: string;
  /** Put there already – its file in Cloud. */
  nodeId: string | null;
}

/** What the AI makes of a mail conversation, shown to its right. */
export interface MailContext {
  /** What it is about, 1–3 sentences. */
  summary: string;
  /** What kind of mail („Anfrage“, „Rechnung“, „Newsletter“ …). */
  kind: string;
  verdict: MailVerdict;
  /** Why it looks like spam or phishing; `null` when it does not. */
  warning: string | null;
  /** What the person should do, if anything. */
  todo: string | null;
  /**
   * Where the to-do is done – a link from the latest mail itself (the report to open), only from a
   * sender its domain vouched for and never on spam; absent on older looks.
   */
  todoLink?: MailContextLink | null;
  /**
   * Whether background helps here (a request, an offer, a customer, a meeting) – no for
   * newsletters, notifications, receipts. Only then the side column shows.
   */
  needsInfo: boolean;
  /** What to know about the sender and the matter, a few words each (from the web, where it searches). */
  facts: string[];
  /** Pages found on the web, each named for what it is. */
  links: MailContextLink[];
  documents: MailContextDocument[];
  filing: MailContextFiling[];
}

export type MailContextState = 'none' | 'working' | 'done' | 'failed';

export interface MailThread {
  id: string;
  account: { id: string; address: string };
  subject: string;
  /** Pinned atop the list by the one asking (`GET /mail/threads/:id`), as its row. */
  pinnedAt?: string | null;
  /** The workspace has an AI to write a reply (`POST /mail/threads/:id/draft`). */
  ai?: boolean;
  /** Everyone on it but the mailbox itself, colleagues with their `userId`. */
  people: MailPerson[];
  spam: boolean;
  messages: MailMessage[];
  context: MailContext | null;
  contextState: MailContextState;
}

/** Someone from outside on a mail conversation, as their mails name them. */
export interface MailPartyPerson {
  name: string;
  address: string;
}

/**
 * Who is on a conversation from outside: a firm by its domain (`acme.com`, its site at `url`),
 * with its people and the pages their signatures name – or one person at a mail provider's
 * address (`domain` null) – or a firm the mails only write about (no `people`, named by the AI).
 * `name`: the firm as the AI read it („Acme GmbH“), else its domain.
 */
export interface MailParty {
  name: string;
  domain: string | null;
  url: string | null;
  /**
   * Its firm's logo may stand for it (`/mail/logos/:domain`): a mail from it that its domain
   * vouched for, one the person wrote to it, or a firm written about whose site fits its name.
   */
  logo: boolean;
  people: MailPartyPerson[];
  links: MailContextLink[];
}

/** What the AI wrote about a conversation in the panel – kept for a while per latest mail. */
export interface MailSummary {
  /** 3–6 short bullets. */
  bullets: string[];
  /**
   * Firms from outside it names, with the domain of their site (as the mails give it or the AI
   * knows it) only where it is https, a firm's own and carries the name (`firmSite`).
   */
  organisations: { name: string; domain: string | null }[];
}

/**
 * The bullets beside a conversation: `ready`; `ask` – not made yet (made when the panel opens
 * where the mailbox lets the AI read, else on a click); `skip` – one short mail, or spam;
 * `off` – the workspace has no AI.
 */
export type MailSummaryState =
  | { state: 'ready'; bullets: string[] }
  | { state: 'ask'; auto: boolean }
  | { state: 'skip' }
  | { state: 'off' };

/**
 * The AI panel beside a mail conversation (`GET /mail/threads/:id/insights`): who is on it, the
 * workspace's files that fit, where its attachments could go – worked out on each request – and
 * the AI's bullets (`POST …/insights/summary` makes them).
 */
export interface MailInsights {
  /** The latest mail's id: the version the bullets are for. */
  version: string;
  summary: MailSummaryState;
  parties: MailParty[];
  documents: MailContextDocument[];
  filing: MailContextFiling[];
}

/**
 * How a mail conversation shows: colleagues only – as a group chat (a colleague's mail alone goes
 * into the direct chat with them); anyone from outside on it, with colleagues or not – as mail.
 */
export const mailThreadKind = (people: readonly MailPerson[]): 'group' | 'mail' =>
  people.length > 0 && people.every((person) => person.userId) ? 'group' : 'mail';

export const MAX_MAIL_TEXT = 100_000;

const host = z
  .string()
  .trim()
  .min(1, 'Gib den Server an.')
  .max(253)
  .regex(/^[a-z0-9.-]+$/i, 'Das ist kein Servername.');
const port = z.coerce.number().int().min(1).max(65535);

const mailAccountFields = {
  address: z.string().trim().email('Das ist keine E-Mail-Adresse.').max(320),
  name: z.string().trim().max(200),
  imapHost: host,
  imapPort: port,
  imapSecure: z.boolean(),
  smtpHost: host,
  smtpPort: port,
  smtpSecure: z.boolean(),
  username: z.string().trim().min(1, 'Gib den Benutzernamen an.').max(320),
  password: z.string().min(1, 'Gib das Passwort an.').max(1000),
  /** Absent: on (a new mailbox), unchanged (a change). */
  aiReads: z.boolean().optional(),
  /** Its own name; empty: its default. Absent: unchanged. */
  label: mailboxLabelSchema.optional(),
};

export const mailAccountInputSchema = z.object({
  ...mailAccountFields,
  name: mailAccountFields.name.default(''),
  imapPort: port.default(993),
  imapSecure: z.boolean().default(true),
  smtpPort: port.default(465),
  smtpSecure: z.boolean().default(true),
});
export type MailAccountInput = z.infer<typeof mailAccountInputSchema>;

/**
 * A change: only what is sent – no defaults (zod 4 fills a default in even where the field is
 * optional, so a rename set the name empty and the ports back to 993/465). The password only
 * when it changes.
 */
export const mailAccountPatchSchema = z.object(mailAccountFields).partial();

// An address has no space or line break in it (`email`): none can carry a header along.
const mailAddress = z.string().trim().max(320).email('Das ist keine E-Mail-Adresse.');
const mailAddresses = z.array(mailAddress).max(50);
/** Seconds in the outbox before it goes – taken back meanwhile, it never does. */
const mailDelay = z.number().int().min(0).max(MAX_MAIL_DELAY_SECONDS).default(0);

/** The AI's reply into the field: the person's notes there say what it is to say. */
export const mailDraftSchema = z.object({ notes: z.string().max(MAX_MAIL_TEXT).default('') });
export interface MailDraft {
  text: string;
}

export const mailReplySchema = z.object({
  text: z.string().trim().min(1, 'Schreib etwas.').max(MAX_MAIL_TEXT),
  /** To everyone on the last mail, not only its sender. */
  all: z.boolean().default(false),
  /**
   * Whom it goes to, as one set them – given, in place of who `all` would pick (at least one in
   * `to`).
   */
  to: mailAddresses.min(1, 'Gib an, an wen sie geht.').optional(),
  cc: mailAddresses.optional(),
  bcc: mailAddresses.optional(),
  /** Files put on it (`MailUpload`): its attachments. */
  uploads: mailUploadIds,
  delay: mailDelay,
});

/** A line break or other control sign: in a header it would start a header of its own. */
// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const CONTROL = /[\u0000-\u001f\u007f]/;

export const mailSendSchema = z.object({
  accountId: z.string().min(1).max(200),
  to: mailAddresses.min(1, 'Gib an, an wen sie geht.'),
  cc: mailAddresses.default([]),
  bcc: mailAddresses.default([]),
  /** Passed on: that mail's attachments go along (its words are in `text` already). */
  forward: z.object({ threadId: z.string().min(1), messageId: z.string().min(1) }).optional(),
  uploads: mailUploadIds,
  delay: mailDelay,
  subject: z
    .string()
    .trim()
    .max(500)
    .refine((subject) => !CONTROL.test(subject), 'Der Betreff hat nur eine Zeile.')
    .default(''),
  text: z.string().trim().min(1, 'Schreib etwas.').max(MAX_MAIL_TEXT),
});

/** Puts an attachment into Cloud – where the AI said, or where the person picked. */
export const mailFileSchema = z.object({
  attachmentId: z.string().min(1),
  areaId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const mailSpamSchema = z.object({ spam: z.boolean() });

/** A colleague's mail in a chat: its subject, so one sees it came as a mail. */
export interface SenderMessageMail {
  subject: string;
}

/**
 * Where checking a mailbox stopped, in order: its inbox server (IMAP) reached, the connection
 * encrypted, signed in – then the same for the outbox server (SMTP). The steps before it went
 * through.
 */
export const MAIL_CHECK_STEPS = [
  // Signed in through the provider only: access allowed there, the right account.
  'oauth-consent',
  'oauth-account',
  'imap-server',
  'imap-tls',
  'imap-login',
  'smtp-server',
  'smtp-tls',
  'smtp-login',
] as const;
export type MailCheckStep = (typeof MAIL_CHECK_STEPS)[number];

/** Why a mailbox was not let in, beside the sentence: the step, and the server's own words. */
export interface MailCheckFailure {
  step: MailCheckStep;
  /** What the server answered – never the password or the username; only to a sign-in. */
  serverSays?: string;
  /** Signed in through Microsoft or Google: its steps come first. */
  via?: MailOAuthProvider;
}

/**
 * „Mit Microsoft/Google anmelden“ for a mailbox: a new one (`accountId` absent – the address
 * comes from the provider) or one whose sign-in ended. `address`, typed into the form, only
 * pre-fills the provider's sign-in (`login_hint`) – the mailbox's address is the one the provider
 * names. The answer is the provider's page to go to; it comes back to `returnTo` with
 * `?anmeldung=<id>` (`MailOAuthResult`).
 */
export const mailOAuthStartSchema = z.object({
  provider: z.enum(MAIL_OAUTH_PROVIDERS),
  name: z.string().trim().max(200).default(''),
  /** A new mailbox's own name; empty: its default. */
  label: mailboxLabelSchema.default(''),
  aiReads: z.boolean().default(true),
  accountId: z.string().min(1).optional(),
  address: z.string().trim().email().max(320).optional(),
  returnTo: z.string().max(500),
  /**
   * Only the account's calendars, no mailbox („Google Kalender verbinden“, Google only): asks
   * for the calendar scopes and the address alone (`CalendarConnection`).
   */
  calendarOnly: z.boolean().default(false),
});
export type MailOAuthStart = z.input<typeof mailOAuthStartSchema>;

/**
 * A mailbox an agent got ready for its person (`prepare_mailbox`): everything but the password,
 * which the person types into the form on „Neues Postfach“ – it fills in from this. `GET
 * /workspaces/:id/mail/prepared`, the person's latest, kept in memory for half an hour.
 */
export interface MailPrepared {
  address: string;
  name: string;
  label: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  aiReads: boolean;
  /** The provider's own sign-in instead of a password (Outlook.com: only Microsoft's). */
  signIn: MailSignIn;
  /** When it was got ready – the form takes each one once. */
  at: string;
}

/** How a sign-in through the provider ended: the mailbox, or why not (the form shows it again). */
export type MailOAuthResult =
  | { ok: true; account: MailAccount; renewed: boolean }
  | {
      ok: false;
      provider: MailOAuthProvider;
      name: string;
      label: string;
      aiReads: boolean;
      accountId: string | null;
      error: string;
      mailCheck?: MailCheckFailure;
    };

/**
 * Presets for the big providers: one types the address and the password (an app password where
 * the provider wants one), the servers fill in. `hint` stands under the password before trying,
 * `refused` says what to try once the sign-in was refused; `noPassword`: the provider lets no
 * password in at all (only its own sign-in, OAuth) – said under the address at once.
 */
export const MAIL_PROVIDERS: readonly {
  name: string;
  domains: readonly string[];
  /** Further domains of the provider (its countries' ones). */
  match?: RegExp;
  imapHost: string;
  smtpHost: string;
  hint?: string;
  refused?: string;
  noPassword?: string;
  /** Signs in through the provider itself (OAuth) – „Mit Microsoft anmelden“. */
  oauth?: MailOAuthProvider;
}[] = [
  {
    name: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imapHost: 'imap.gmail.com',
    smtpHost: 'smtp.gmail.com',
    oauth: 'google',
    hint: 'Ein App-Passwort, nicht das normale – es gibt sie erst mit der Bestätigung in zwei Schritten (Google-Konto › Sicherheit › App-Passwörter).',
    refused:
      'Gmail nimmt nur ein App-Passwort an, nicht das normale Passwort – es gibt sie erst mit der Bestätigung in zwei Schritten (Google-Konto › Sicherheit › App-Passwörter).',
  },
  {
    name: 'Outlook',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.de', 'hotmail.de'],
    match: /^(outlook|hotmail|live|windowslive)\.[a-z]{2,3}(\.[a-z]{2})?$/,
    // Microsoft's settings for Outlook.com: IMAP 993 with TLS, SMTP 587 with STARTTLS.
    imapHost: 'outlook.office365.com',
    smtpHost: 'smtp-mail.outlook.com',
    noPassword:
      'Microsoft lässt Mail-Programme bei Outlook.com, Hotmail und Live nur über „Mit Microsoft anmelden“ herein – Passwort und App-Passwort gehen dort nicht, auch richtige nicht.',
    oauth: 'microsoft',
  },
  {
    name: 'iCloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imapHost: 'imap.mail.me.com',
    smtpHost: 'smtp.mail.me.com',
    hint: 'Ein app-spezifisches Passwort, nicht das des Apple Accounts (account.apple.com › Anmeldung und Sicherheit).',
    refused:
      'iCloud nimmt nur ein app-spezifisches Passwort an, nicht das des Apple Accounts (account.apple.com › Anmeldung und Sicherheit › App-spezifische Passwörter).',
  },
  {
    name: 'GMX',
    domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'],
    imapHost: 'imap.gmx.net',
    smtpHost: 'mail.gmx.net',
    hint: 'Vorher bei GMX unter Einstellungen › POP3/IMAP Abruf den Zugriff erlauben.',
    refused:
      'Ist bei GMX unter Einstellungen › POP3/IMAP Abruf der Zugriff erlaubt? Mit Zwei-Faktor-Anmeldung braucht es ein App-Passwort.',
  },
  {
    name: 'WEB.DE',
    domains: ['web.de'],
    imapHost: 'imap.web.de',
    smtpHost: 'smtp.web.de',
    hint: 'Vorher bei WEB.DE unter Einstellungen › POP3/IMAP Abruf den Zugriff erlauben.',
    refused:
      'Ist bei WEB.DE unter Einstellungen › POP3/IMAP Abruf der Zugriff erlaubt? Mit Zwei-Faktor-Anmeldung braucht es ein App-Passwort.',
  },
  { name: 'IONOS', domains: ['ionos.de'], imapHost: 'imap.ionos.de', smtpHost: 'smtp.ionos.de' },
  {
    name: 'Posteo',
    domains: ['posteo.de', 'posteo.net'],
    imapHost: 'posteo.de',
    smtpHost: 'posteo.de',
  },
  {
    name: 'mailbox.org',
    domains: ['mailbox.org'],
    imapHost: 'imap.mailbox.org',
    smtpHost: 'smtp.mailbox.org',
  },
];

/**
 * Whether a mail server is of the address's own domain (`imap.firma.de` for `info@firma.de` or
 * `info@mail.firma.de`). Servers elsewhere – a hoster's, or someone else's – the person checks
 * before typing a password: the form says so where an agent filled them in.
 */
export function mailHostOfDomain(address: string, host: string): boolean {
  const labels = (address.split('@')[1] ?? '').trim().toLowerCase().split('.').filter(Boolean);
  // `firma.co.uk`: three labels are the firm's, not two.
  const second = labels.length > 2 && labels.at(-1)!.length === 2 ? labels.at(-2)! : '';
  const base = labels.slice(/^(co|com|net|org|ac|gov|edu|or|ne)$/.test(second) ? -3 : -2).join('.');
  const name = host.trim().toLowerCase().replace(/\.$/, '');
  return base.includes('.') && (name === base || name.endsWith(`.${base}`));
}

/**
 * Of what an agent got ready, the servers the person checks before typing a password: those not
 * of the address's domain – none for a known provider (its own servers, always) nor for a
 * sign-in without a password.
 */
export function mailServersToCheck(
  prepared: Pick<MailPrepared, 'address' | 'imapHost' | 'smtpHost' | 'signIn'>,
): string[] {
  if (prepared.signIn !== 'password' || mailProviderOf(prepared.address)) return [];
  const hosts = [prepared.imapHost, prepared.smtpHost].map((host) => host.trim());
  return [...new Set(hosts.filter((host) => !mailHostOfDomain(prepared.address, host)))];
}

/** The preset for an address's domain, if it has one. */
export function mailProviderOf(address: string) {
  const domain = address.split('@')[1]?.trim().toLowerCase() ?? '';
  return (
    MAIL_PROVIDERS.find(
      (provider) => provider.domains.includes(domain) || !!provider.match?.test(domain),
    ) ?? null
  );
}
