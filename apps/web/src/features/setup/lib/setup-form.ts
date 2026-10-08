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

const TOKEN_STORAGE_KEY = 'slider-setup-token';

/**
 * The one-time token from `#token=…` in the setup link. Kept for this tab (the server restarts
 * after saving and the page reloads), and taken out of the address bar.
 */
export function takeSetupToken(): string | null {
  const match = /(?:^#|&)token=([\w-]+)/.exec(window.location.hash);
  try {
    if (match?.[1]) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, match[1]);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return match[1];
    }
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return match?.[1] ?? null;
  }
}
