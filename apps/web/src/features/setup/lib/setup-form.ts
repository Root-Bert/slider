import {
  SECRET_SETUP_KEYS,
  SETUP_KEYS,
  type SaveSetupInput,
  type SetupField,
  type SetupKey,
} from '@slider/shared';

/** Text fields of the form; secrets start empty ("leave empty to keep"). */
export type SetupDraft = Record<SetupKey, string>;

export const isSecretKey = (key: SetupKey) => SECRET_SETUP_KEYS.includes(key);

export function initialDraft(fields: Record<SetupKey, SetupField>): SetupDraft {
  return Object.fromEntries(
    SETUP_KEYS.map((key) => [key, isSecretKey(key) ? '' : (fields[key].value ?? '')]),
  ) as SetupDraft;
}

/**
 * Only what changed: edited plain values (empty → `null` = remove), typed secrets, and the keys of
 * sections the admin removed. Values from the environment are never sent.
 */
export function collectChanges(
  fields: Record<SetupKey, SetupField>,
  draft: SetupDraft,
  removed: ReadonlySet<SetupKey>,
): SaveSetupInput['values'] {
  const values: SaveSetupInput['values'] = {};
  for (const key of SETUP_KEYS) {
    if (fields[key].source === 'env') continue;
    if (removed.has(key)) {
      if (fields[key].source === 'stored') values[key] = null;
      continue;
    }
    const next = draft[key].trim();
    if (isSecretKey(key)) {
      if (next) values[key] = next;
    } else if (next !== (fields[key].value ?? '')) {
      values[key] = next || null;
    }
  }
  return values;
}

export interface SmtpParts {
  host: string;
  port: string;
  user: string;
  password: string;
}

export const EMPTY_SMTP: SmtpParts = { host: '', port: '465', user: '', password: '' };

/**
 * `SMTP_URL` from the form fields: port 465 speaks TLS from the start (`smtps://`), the others
 * upgrade with STARTTLS (`smtp://`). User and password are URL-encoded. Empty host → nothing.
 */
export function smtpUrl({ host, port, user, password }: SmtpParts): string {
  const server = host
    .trim()
    .replace(/^smtps?:\/\//, '')
    .replace(/\/+$/, '');
  if (!server) return '';
  const portNumber = port.trim() || '465';
  const scheme = portNumber === '465' ? 'smtps' : 'smtp';
  const auth = user.trim()
    ? `${encodeURIComponent(user.trim())}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  return `${scheme}://${auth}${server}:${portNumber}`;
}

/**
 * Server, port and user of an `SMTP_URL` as the API shows it (without the password), to fill the
 * form with what is saved. Unreadable or empty → the empty form.
 */
export function smtpParts(url: string | null): SmtpParts {
  if (!url) return EMPTY_SMTP;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'smtp:' ? '587' : '465'),
      user: decodeURIComponent(parsed.username),
      password: '',
    };
  } catch {
    return EMPTY_SMTP;
  }
}

/**
 * Where a card's values come from: `env` when every value that is set comes from the environment
 * (nothing to change here), `stored` when at least one is saved on this page, `null` when none is
 * set.
 */
export function sourceOf(
  fields: Record<SetupKey, SetupField>,
  keys: readonly SetupKey[],
): 'env' | 'stored' | null {
  const set = keys.filter((key) => fields[key].set);
  if (set.length === 0) return null;
  return set.every((key) => fields[key].source === 'env') ? 'env' : 'stored';
}

/** The setup page; the login returns here. */
export const SETUP_PATH = '/einrichtung';

const TOKEN_STORAGE_KEY = 'slider-setup-token';

/**
 * The setup token typed in on the page, kept for this tab: the server restarts after saving and
 * the page reloads, and after signing in it is still there to claim the instance with. It never
 * goes into the address bar.
 */
export function storedSetupToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeSetupToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Private mode without storage: the token lasts as long as the page.
  }
}

/** As pasted from the log: without the surrounding spaces or a leading `Setup token:`. */
export const cleanSetupToken = (input: string) =>
  input
    .trim()
    .replace(/^setup token:\s*/i, '')
    .trim();
