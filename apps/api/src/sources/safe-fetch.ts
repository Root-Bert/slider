import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError, fileTooLarge } from '../http/errors';
import { sourceNotFound, sourceUnreachable } from './errors';

/**
 * Fetching URLs that users paste is a server-side request on their behalf (SSRF). Every hop
 * goes through here: https only, public addresses only, few redirects, a deadline and a size cap.
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
/** Resolves a host name to all its addresses (`dns.lookup(host, { all: true })`). */
export type LookupAll = (host: string) => Promise<readonly { address: string }[]>;

export interface SafeFetchOptions {
  fetch: FetchLike;
  lookup: LookupAll;
  maxBytes: number;
}

export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 60_000;

export const dnsLookup: LookupAll = (host) => lookup(host, { all: true });

const blockedAddress = () =>
  new ApiError(
    400,
    'unsupported_link',
    'Dieser Link zeigt auf eine interne Adresse und kann nicht geöffnet werden.',
  );

/** Loopback, private, link-local, CGNAT, multicast and other non-public IPv4 ranges. */
function isPrivateIpv4(address: string): boolean {
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a dotted IPv4 tail split in two). */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0] ?? '';
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted[1].split('.').map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail, ...rest] = text.split('::');
  if (rest.length > 0) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right].map((g) =>
    parseInt(g, 16),
  );
  return groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? null : groups;
}

const embeddedIpv4 = (high: number, low: number) =>
  `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

/**
 * Non-public IPv6 ranges. Addresses that carry an IPv4 address (mapped `::ffff:a.b.c.d` in
 * either notation, IPv4-compatible, NAT64, 6to4) are judged by that IPv4 address, because the
 * URL parser turns `[::ffff:127.0.0.1]` into `[::ffff:7f00:1]`.
 */
function isPrivateIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const v4 = embeddedIpv4(g6, g7);
  const prefix80Zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::/96 (incl. :: and ::1), ::ffff:0:0/96 mapped, ::ffff:0:0:0/96 translated
  if (prefix80Zero && (g5 === 0 || g5 === 0xffff)) return g5 === 0 || isPrivateIpv4(v4);
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return isPrivateIpv4(v4);
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    // 64:ff9b::/96 well-known NAT64; 64:ff9b:1::/48 is local-use NAT64
    return g2 !== 0 || g3 !== 0 || g4 !== 0 || g5 !== 0 || isPrivateIpv4(v4);
  }
  if (g0 === 0x2002) return isPrivateIpv4(embeddedIpv4(g1, g2)); // 6to4
  return (
    (g0 === 0x2001 && g1 === 0) || // 2001::/32 Teredo (tunnels to arbitrary IPv4)
    (g0 === 0x2001 && g1 === 0xdb8) || // documentation
    (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) || // 100::/64 discard
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (g0 & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

/** Throws unless `url` is https and every address its host resolves to is public. */
export async function assertPublicHttpsUrl(url: URL, lookupAll: LookupAll): Promise<void> {
  if (url.protocol !== 'https:') throw blockedAddress();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw blockedAddress();
  let addresses: readonly { address: string }[];
  if (isIP(host)) addresses = [{ address: host }];
  else {
    try {
      addresses = await lookupAll(host);
    } catch {
      throw sourceNotFound();
    }
  }
  if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
    throw blockedAddress();
  }
}

const isRedirect = (status: number) => status >= 300 && status < 400 && status !== 304;

/** One request without following redirects, after checking the target address. */
export async function fetchHop(
  url: URL,
  { fetch, lookup: lookupAll }: SafeFetchOptions,
  init: RequestInit = {},
): Promise<Response> {
  await assertPublicHttpsUrl(url, lookupAll);
  try {
    return await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw sourceUnreachable('Der Server hinter dem Link antwortet nicht.');
    }
    throw sourceUnreachable();
  }
}

/** The redirect target of `response`, or `null` when it is not a redirect. */
export function redirectTarget(response: Response, from: URL): URL | null {
  if (!isRedirect(response.status)) return null;
  const location = response.headers.get('location');
  if (!location) return null;
  try {
    return new URL(location, from);
  } catch {
    return null;
  }
}

/** Follows up to {@link MAX_REDIRECTS} redirects by hand, re-checking every hop. */
export async function safeFetch(
  url: URL,
  options: SafeFetchOptions,
  init: RequestInit = {},
): Promise<{ response: Response; url: URL }> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await fetchHop(current, options, { ...init, signal });
    const next = redirectTarget(response, current);
    if (!next) return { response, url: current };
    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw sourceUnreachable('Der Link leitet zu oft weiter.');
    current = next;
  }
}

/** Reads the body, aborting as soon as it grows past `maxBytes`. */
export async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw fileTooLarge(maxBytes);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw fileTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw sourceUnreachable('Die Datei konnte nicht vollständig geladen werden.');
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A PPTX is a ZIP archive: it starts with the local file header `PK\x03\x04`. */
export const isPptxBytes = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

export const isHtmlResponse = (response: Response): boolean =>
  (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');

/** `filename*` (RFC 5987, UTF-8) wins over `filename`; `null` when the header names no file. */
export function parseContentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended?.[2]) {
    try {
      return decodeURIComponent(extended[2].trim().replace(/^"|"$/g, ''));
    } catch {
      // Fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i.exec(header);
  const value = plain?.[2] ?? plain?.[1];
  if (!value) return null;
  const name = value.replace(/\\(.)/g, '$1').trim();
  return name || null;
}

/** File name for a downloaded deck: header, then last path segment, always ending in `.pptx`. */
export function fileNameFor(response: Response, url: URL): string {
  const fromHeader = parseContentDispositionFileName(response.headers.get('content-disposition'));
  let fromPath = url.pathname.split('/').pop() ?? '';
  try {
    fromPath = decodeURIComponent(fromPath);
  } catch {
    // Keep the raw segment.
  }
  const name = (fromHeader ?? fromPath).replace(/[\\/]/g, '').trim() || 'Präsentation.pptx';
  return /\.pptx$/i.test(name) ? name : `${name.replace(/\.[^.]*$/, '')}.pptx`;
}
