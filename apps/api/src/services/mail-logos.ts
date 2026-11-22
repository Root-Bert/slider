import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { createCanvas } from '@napi-rs/canvas';
import { emailDomain } from '@slider/shared';
import { eq } from 'drizzle-orm';
import { mailAccounts, users, workspaceMembers, workspaces } from '../db/schema';
import type { AppDeps } from '../deps';
import { loadImage } from '../import/load-image';
import {
  dnsLookup,
  readBodyCapped,
  safeFetch,
  type FetchLike,
  type LookupAll,
} from '../sources/safe-fetch';
import { orgDomain } from './mail-insights';
import { DAY_MS } from './retention-rules';
import { isCompanyMailDomain } from './workspaces/domains';
import { requireRole } from './workspaces/roles';

/**
 * A firm's own picture beside its mails: the logo its domain publishes for mail (BIMI – the TXT
 * record `default._bimi.<domain>` names an SVG), else its website's icon (apple-touch-icon,
 * `<link rel="icon">`, `/favicon.ico`). Looked up by Slider's server alone, with the domain alone
 * – no address, no name, never from the browser; never for a mail provider's domain (gmail.com …)
 * or the workspace's own. Every hop through `safeFetch` (https, public addresses, capped), and
 * whatever comes is drawn anew as a PNG – an SVG never reaches the page as it came. Kept per
 * domain in the blob store: found for {@link LOGO_FOUND_DAYS}, none for {@link LOGO_MISSING_DAYS}.
 */

export const LOGO_FOUND_DAYS = 7;
export const LOGO_MISSING_DAYS = 1;
/** The picture's side: sharp in a 32px avatar on a 3× screen. */
export const LOGO_PX = 128;
/** A site icon smaller than this looks worse than the pattern it replaces. */
const MIN_ICON_PX = 32;
/** BIMI asks for at most 32 KB; some are larger. */
const MAX_SVG_BYTES = 64 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const DNS_TIMEOUT_MS = 5_000;
/** One lookup at most (DNS, the page, an icon or two); what takes longer counts as none. */
const LOOKUP_TIMEOUT_MS = 10_000;
/** Icons a page names that are tried before `/favicon.ico`. */
const MAX_ICON_TRIES = 3;

/** How the lookups reach DNS and the web; the real ones when absent (tests inject fakes). */
export interface SenderLogoNetwork {
  fetch?: FetchLike;
  lookup?: LookupAll;
  resolveTxt?: (name: string) => Promise<string[][]>;
}

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

/**
 * The firm's domain a logo is looked up for (`mail.acme.com` → `acme.com`), or `null`: not a
 * domain, an address, or a mail provider's.
 */
export function logoDomain(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/\.$/, '');
  if (!raw || raw.length > 253 || !/^[\p{L}\p{N}.-]+$/u.test(raw)) return null;
  let host: string;
  try {
    host = new URL(`https://${raw}/`).hostname;
  } catch {
    return null;
  }
  if (!DOMAIN.test(host)) return null;
  const org = orgDomain(host);
  return isCompanyMailDomain(host) && isCompanyMailDomain(org) ? org : null;
}

/** The workspace's own firms: its members', its company domain, the person's mailboxes'. */
async function ownDomains(deps: AppDeps, workspaceId: string, userId: string) {
  const [members, [workspace], boxes] = await Promise.all([
    deps.db
      .select({ email: users.email })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    deps.db
      .select({ joinDomain: workspaces.joinDomain })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)),
    deps.db
      .select({ address: mailAccounts.address })
      .from(mailAccounts)
      .where(eq(mailAccounts.userId, userId)),
  ]);
  const own = new Set<string>();
  for (const email of [...members.map((one) => one.email), ...boxes.map((one) => one.address)]) {
    own.add(orgDomain(emailDomain(email)));
  }
  if (workspace?.joinDomain) own.add(orgDomain(workspace.joinDomain));
  return own;
}

/**
 * `GET /workspaces/:id/mail/logos/:domain`: the firm's picture as a PNG, or `null` (none, not a
 * firm's domain, the workspace's own). `mayLookUp` is asked only before a lookup that is not kept
 * yet – false: `null`, nothing kept, so a later request looks again.
 */
export async function mailLogo(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  input: string,
  mayLookUp: () => boolean,
): Promise<Uint8Array | null> {
  await requireRole(deps.db, workspaceId, userId);
  const domain = logoDomain(input);
  if (!domain || (await ownDomains(deps, workspaceId, userId)).has(domain)) return null;
  return senderLogo(deps, domain, mayLookUp);
}

const keyOf = (domain: string) => `mail-logos/${domain}.png`;
/** A kept answer: when it was looked up (8 bytes, ms) and the PNG – empty when there was none. */
const STAMP = 8;

/**
 * A domain's picture nobody asked for in this long goes (`sweepMailLogos`, the retention job). Use
 * marks nothing; asked for, it is looked up anew after {@link LOGO_FOUND_DAYS} – so a firm still
 * written with is never this old.
 */
export const LOGO_KEEP_DAYS = 30;

/** Drops the kept pictures (and „none“ answers) looked up more than {@link LOGO_KEEP_DAYS} ago. */
export async function sweepMailLogos(deps: AppDeps): Promise<void> {
  const before = deps.clock.now().getTime() - LOGO_KEEP_DAYS * DAY_MS;
  for (const key of await deps.storage.list('mail-logos/')) {
    const kept = await deps.storage.get(key);
    const at =
      kept && kept.byteLength >= STAMP
        ? new DataView(kept.buffer, kept.byteOffset, STAMP).getFloat64(0)
        : 0;
    if (!(at >= before)) await deps.storage.delete(key);
  }
}
const running = new Map<string, Promise<Uint8Array | null>>();

/** The picture of a firm's domain (see {@link logoDomain}), kept or looked up once at a time. */
export async function senderLogo(
  deps: AppDeps,
  domain: string,
  mayLookUp: () => boolean = () => true,
): Promise<Uint8Array | null> {
  const kept = await deps.storage.get(keyOf(domain));
  if (kept && kept.byteLength >= STAMP) {
    const at = new DataView(kept.buffer, kept.byteOffset, STAMP).getFloat64(0);
    const png = kept.subarray(STAMP);
    const keep = (png.byteLength > 0 ? LOGO_FOUND_DAYS : LOGO_MISSING_DAYS) * DAY_MS;
    if (deps.clock.now().getTime() - at < keep) return png.byteLength > 0 ? png : null;
  }
  const already = running.get(domain);
  if (already) return already;
  if (!mayLookUp()) return null;
  const run = (async () => {
    const logo = await withTimeout(findLogo(deps, domain), LOOKUP_TIMEOUT_MS).catch(() => null);
    const stamped = new Uint8Array(STAMP + (logo?.byteLength ?? 0));
    new DataView(stamped.buffer).setFloat64(0, deps.clock.now().getTime());
    if (logo) stamped.set(logo, STAMP);
    await deps.storage.put(keyOf(domain), stamped);
    return logo;
  })().finally(() => running.delete(domain));
  running.set(domain, run);
  return run;
}

async function findLogo(deps: AppDeps, domain: string): Promise<Uint8Array | null> {
  return (await bimiLogo(deps, domain).catch(() => null)) ?? (await siteIcon(deps, domain));
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** `GET url` through `safeFetch`: the body up to `maxBytes`, or `null` (not 2xx, refused). */
async function fetchCapped(
  deps: AppDeps,
  url: URL,
  maxBytes: number,
  accept: string,
): Promise<{ bytes: Uint8Array; url: URL; type: string } | null> {
  const network = deps.senderLogos ?? {};
  try {
    const { response, url: final } = await safeFetch(
      url,
      { fetch: network.fetch ?? globalThis.fetch, lookup: network.lookup ?? dnsLookup, maxBytes },
      { headers: { Accept: accept, 'User-Agent': 'Slider (sender logos)' } },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    return { bytes: await readBodyCapped(response, maxBytes), url: final, type };
  } catch {
    return null;
  }
}

/** `k=v; k=v` of a BIMI record, keys in lower case. */
const tags = (record: string) =>
  new Map(
    record.split(';').flatMap((part) => {
      const at = part.indexOf('=');
      return at > 0 ? [[part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()]] : [];
    }),
  );

/** BIMI: `v=BIMI1; l=https://…/logo.svg` at `default._bimi.<domain>`. */
async function bimiLogo(deps: AppDeps, domain: string): Promise<Uint8Array | null> {
  const resolveTxt = deps.senderLogos?.resolveTxt ?? deps.mailDns ?? dnsResolveTxt;
  const records = await withTimeout(resolveTxt(`default._bimi.${domain}`), DNS_TIMEOUT_MS);
  const record = records
    .map((parts) => parts.join('').trim())
    .find((one) => /^v=BIMI1\b/i.test(one));
  const location = record ? tags(record).get('l') : undefined;
  if (!location) return null;
  const url = new URL(location);
  if (url.protocol !== 'https:') return null;
  const found = await fetchCapped(deps, url, MAX_SVG_BYTES, 'image/svg+xml');
  return found ? drawLogo(found.bytes) : null;
}

/** The icons a page names, the likeliest best first: touch icons, then the largest others. */
export function pageIcons(html: string, base: URL): URL[] {
  const head = html.slice(0, MAX_PAGE_BYTES);
  const found: { url: URL; rank: number }[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const attr = (name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
        .exec(tag)
        ?.slice(1)
        .find((value) => value !== undefined);
    const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr('href')?.replace(/&amp;/g, '&').trim();
    if (!href) continue;
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !rel.includes('icon')) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    const sizes = attr('sizes') ?? '';
    const vector = /svg/i.test(attr('type') ?? '') || /\.svg(\?|$)/i.test(url.pathname);
    const side = vector || sizes === 'any' ? 512 : Number(/(\d+)x\d+/i.exec(sizes)?.[1] ?? 0);
    found.push({ url, rank: (touch ? 1000 : 0) + (side || (touch ? 180 : 16)) });
  }
  return found
    .sort((a, b) => b.rank - a.rank)
    .map((one) => one.url)
    .filter((url, index, all) => all.findIndex((other) => other.href === url.href) === index);
}

/** The site's icon: what its start page names, else `/apple-touch-icon.png`, `/favicon.ico`. */
async function siteIcon(deps: AppDeps, domain: string): Promise<Uint8Array | null> {
  const page =
    (await fetchCapped(deps, new URL(`https://${domain}/`), MAX_PAGE_BYTES, 'text/html')) ??
    (await fetchCapped(deps, new URL(`https://www.${domain}/`), MAX_PAGE_BYTES, 'text/html'));
  const base = page?.url ?? new URL(`https://${domain}/`);
  const named =
    page && page.type.startsWith('text/html')
      ? pageIcons(new TextDecoder().decode(page.bytes), base).slice(0, MAX_ICON_TRIES)
      : [];
  const tries = [
    ...named,
    new URL('/apple-touch-icon.png', base),
    new URL('/favicon.ico', base),
  ].filter((url, index, all) => all.findIndex((other) => other.href === url.href) === index);
  for (const url of tries) {
    const icon = await fetchCapped(deps, url, MAX_ICON_BYTES, 'image/*');
    if (!icon || icon.type.startsWith('text/html')) continue;
    const drawn = await drawLogo(icon.bytes);
    if (drawn) return drawn;
  }
  return null;
}

const looksLikeSvg = (bytes: Uint8Array) =>
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
    new TextDecoder().decode(bytes.subarray(0, 2048)),
  );

/**
 * An SVG fit to be drawn: nothing that runs, loads or reaches outside the file (scripts, event
 * handlers, embedded pages or pictures, entities, references not starting with `#`), its root
 * sized to {@link LOGO_PX} keeping its view box. `null` when it holds any of that.
 */
export function safeSvg(text: string): string | null {
  if (
    /<!DOCTYPE|<!ENTITY|<script|<foreignObject|<image|<iframe|<object|<embed|<use\b[^>]*href\s*=\s*["']?\s*[^#"'\s]|@import|\bon[a-z]+\s*=/i.test(
      text,
    )
  )
    return null;
  for (const match of text.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (!(match[1] ?? match[2] ?? '').trim().startsWith('#')) return null;
  }
  if (/url\(\s*["']?\s*(?!#)/i.test(text)) return null;
  const root = /<svg\b[^>]*>/i.exec(text);
  if (!root) return null;
  const tag = root[0];
  const number = (name: string) =>
    Number.parseFloat(new RegExp(`\\s${name}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(tag)?.[1] ?? '');
  const viewBox = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
  const width = number('width');
  const height = number('height');
  const box = viewBox ?? (width > 0 && height > 0 ? `0 0 ${width} ${height}` : null);
  if (!box) return null;
  const sized = tag
    .replace(/\s(width|height|viewBox)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/^<svg\b/i, `<svg width="${LOGO_PX}" height="${LOGO_PX}" viewBox="${box}"`);
  return text.slice(0, root.index) + sized + text.slice(root.index + tag.length);
}

/**
 * Any logo or icon drawn anew as a {@link LOGO_PX} PNG on white: as it is where it fills its square
 * (a touch icon, most BIMI logos), with room around it where its corners are clear, so the round
 * avatar never cuts into it. `null` when it cannot be read or is too small.
 */
export async function drawLogo(bytes: Uint8Array): Promise<Uint8Array | null> {
  let source = bytes;
  if (looksLikeSvg(bytes)) {
    const svg = safeSvg(new TextDecoder().decode(bytes));
    if (!svg) return null;
    source = new TextEncoder().encode(svg);
  }
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(source);
  } catch {
    return null;
  }
  if (image.width < MIN_ICON_PX || image.height < MIN_ICON_PX) return null;
  const canvas = createCanvas(LOGO_PX, LOGO_PX);
  const context = canvas.getContext('2d');
  const draw = (inset: number) => {
    const room = LOGO_PX - inset * 2;
    const scale = Math.min(room / image.width, room / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (LOGO_PX - w) / 2, (LOGO_PX - h) / 2, w, h);
  };
  draw(0);
  const edge = LOGO_PX - 2;
  const filled = [
    [1, 1],
    [edge, 1],
    [1, edge],
    [edge, edge],
  ].every(([x = 0, y = 0]) => (context.getImageData(x, y, 1, 1).data[3] ?? 0) >= 250);
  context.clearRect(0, 0, LOGO_PX, LOGO_PX);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, LOGO_PX, LOGO_PX);
  draw(filled ? 0 : Math.round(LOGO_PX * 0.16));
  return new Uint8Array(canvas.toBuffer('image/png'));
}
