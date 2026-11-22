import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';

/*
 * DKIM (RFC 6376), checked here instead of believed from a header: `Authentication-Results`
 * can be written by anyone where the provider adds none, so a mail counts as its sender's
 * domain's only with a signature this server verified against the key in that domain's DNS.
 * rsa-sha256 only; a signature over part of the body (`l=`) is refused – what follows the
 * signed part could say anything.
 */

/** TXT records of a name (`dns.resolveTxt`); tests hand in their own. */
export type DkimDns = (name: string) => Promise<string[][]>;

const DNS_TIMEOUT_MS = 5_000;
/** Signatures looked at per mail – a mail with many cannot make the server ask DNS endlessly. */
const MAX_SIGNATURES = 5;
const MIN_KEY_BITS = 1024;

interface Field {
  name: string;
  /** As in the mail: name, colon, value with its folding. */
  raw: string;
}

/** The mail's header fields (in order) and its body, with CRLF line ends throughout. */
function split(raw: Uint8Array): { fields: Field[]; body: string } {
  const text = Buffer.from(raw).toString('latin1').replace(/\r?\n/g, '\r\n');
  const end = text.indexOf('\r\n\r\n');
  const head = end < 0 ? text : text.slice(0, end);
  const body = end < 0 ? '' : text.slice(end + 4);
  const fields = head
    .split(/\r\n(?![ \t])/)
    .filter((line) => line.includes(':'))
    .map((line) => ({ name: line.slice(0, line.indexOf(':')).trim().toLowerCase(), raw: line }));
  return { fields, body };
}

function tags(value: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of value.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).replace(/\s+/g, '').toLowerCase();
    if (key && !map.has(key)) map.set(key, part.slice(at + 1).replace(/\s+/g, ''));
  }
  return map;
}

const valueOf = (field: Field) => field.raw.slice(field.raw.indexOf(':') + 1);

function headerCanon(field: Field, relaxed: boolean): string {
  if (!relaxed) return field.raw;
  const value = valueOf(field)
    .replace(/\r\n/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return `${field.name}:${value}`;
}

function bodyCanon(body: string, relaxed: boolean): string {
  if (!relaxed) return `${body.replace(/(\r\n)+$/, '')}\r\n`;
  const text = body
    .split('\r\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''))
    .join('\r\n')
    .replace(/(\r\n)+$/, '');
  return text ? `${text}\r\n` : '';
}

async function keyOf(dns: DkimDns, selector: string, domain: string): Promise<KeyObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      dns(`${selector}._domainkey.${domain}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), DNS_TIMEOUT_MS);
      }),
    ]);
    for (const record of records) {
      const key = tags(record.join(''));
      if ((key.get('k') ?? 'rsa') !== 'rsa') continue;
      const p = key.get('p');
      if (!p) continue; // empty: revoked
      const der = Buffer.from(p, 'base64');
      for (const type of ['spki', 'pkcs1'] as const) {
        try {
          const made = createPublicKey({ key: der, format: 'der', type });
          if ((made.asymmetricKeyDetails?.modulusLength ?? 0) >= MIN_KEY_BITS) return made;
        } catch {
          // the other encoding
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether one `DKIM-Signature` field holds; its `d=` if so. */
async function check(
  signature: Field,
  fields: readonly Field[],
  body: string,
  dns: DkimDns,
  now: Date,
): Promise<string | null> {
  const tag = tags(valueOf(signature));
  const domain = (tag.get('d') ?? '').toLowerCase();
  const selector = tag.get('s') ?? '';
  const signed = (tag.get('h') ?? '').toLowerCase().split(':').filter(Boolean);
  const b = tag.get('b') ?? '';
  const bh = tag.get('bh') ?? '';
  if (tag.get('v') !== '1' || tag.get('a')?.toLowerCase() !== 'rsa-sha256') return null;
  if (!domain.includes('.') || !/^[a-z0-9._-]+$/.test(selector) || !b || !bh) return null;
  if (tag.has('l') || !signed.includes('from')) return null;
  const expires = Number(tag.get('x'));
  if (tag.has('x') && (!Number.isFinite(expires) || expires * 1000 < now.getTime())) return null;
  const [headerMode = 'simple', bodyMode = 'simple'] = (tag.get('c') ?? 'simple/simple')
    .toLowerCase()
    .split('/');
  const relaxedHeader = headerMode === 'relaxed';
  const relaxedBody = bodyMode === 'relaxed';

  const hash = createHash('sha256').update(bodyCanon(body, relaxedBody), 'latin1').digest('base64');
  if (hash !== bh) return null;

  // Each name takes its last field not taken yet, from the bottom up; a missing one adds nothing.
  const taken = new Set<Field>();
  const lines: string[] = [];
  for (const name of signed) {
    const field = fields.findLast((each) => each.name === name && !taken.has(each));
    if (!field) continue;
    taken.add(field);
    lines.push(`${headerCanon(field, relaxedHeader)}\r\n`);
  }
  const colon = signature.raw.indexOf(':') + 1;
  const unsigned = {
    name: signature.name,
    raw: `${signature.raw.slice(0, colon)}${signature.raw.slice(colon).replace(/((?:^|;)\s*b\s*=)[^;]*/i, '$1')}`,
  };
  lines.push(headerCanon(unsigned, relaxedHeader));

  const key = await keyOf(dns, selector, domain);
  if (!key) return null;
  try {
    const ok = verify(
      'sha256',
      Buffer.from(lines.join(''), 'latin1'),
      key,
      Buffer.from(b, 'base64'),
    );
    return ok ? domain : null;
  } catch {
    return null;
  }
}

/**
 * The domains whose DKIM signature on the mail holds. Empty where there is none, where one does
 * not hold, or where the mail has more or fewer than one `From` (then which one was signed and
 * which one is shown could differ).
 */
export async function dkimDomains(
  raw: Uint8Array,
  dns: DkimDns = dnsResolveTxt,
  now: Date = new Date(),
): Promise<string[]> {
  const { fields, body } = split(raw);
  if (fields.filter((field) => field.name === 'from').length !== 1) return [];
  const signatures = fields
    .filter((field) => field.name === 'dkim-signature')
    .slice(0, MAX_SIGNATURES);
  const domains = await Promise.all(
    signatures.map((signature) => check(signature, fields, body, dns, now)),
  );
  return [...new Set(domains.filter((domain): domain is string => !!domain))];
}

/** Whether a signing domain stands for the address's: the same, or one it is under. */
export const alignedWith = (address: string, domain: string) => {
  const own = address.split('@')[1]?.toLowerCase() ?? '';
  return !!own && (own === domain || own.endsWith(`.${domain}`));
};

/** The topmost field of a name, unfolded – where a receiving server writes its own on top. */
export function topField(raw: Uint8Array, name: string): string {
  const field = split(raw).fields.find((one) => one.name === name.toLowerCase());
  return field ? valueOf(field).replace(/\r\n/g, '').trim() : '';
}
