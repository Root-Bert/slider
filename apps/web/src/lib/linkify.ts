import { find } from 'linkifyjs';
import { findNumbers } from 'libphonenumber-js/min';

/** A piece of written text: plain words, or something to open – a web address, a mail, a phone. */
export type LinkPart =
  { kind: 'text'; text: string } | { kind: 'url' | 'email' | 'phone'; text: string; href: string };

/** Only these open from text – never `javascript:`, `data:` or any other scheme. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:\+)/i;

/**
 * Phones as Gmail and Apple Mail find them, with Google's numbering plan (`libphonenumber`):
 * valid numbers only, without a country code as German ones. A candidate must start as one is
 * written – `+`, `0` or `(` – else a date („20.11.2026“) or a sum would pass as a number in some
 * area code.
 */
function phonesIn(text: string): { start: number; end: number; href: string }[] {
  if (!/\d{3}/.test(text)) return [];
  return (
    findNumbers(text, { defaultCountry: 'DE', v2: true })
      .filter(({ startsAt }) => /[+0(]/.test(text[startsAt] ?? ''))
      // A real line has its area code: no short code („01234“) passes as one.
      .filter(({ number }) => number.isValid() && number.nationalNumber.length >= 6)
      .map(({ number, startsAt, endsAt }) => ({
        start: startsAt,
        end: endsAt,
        href: number.getURI(),
      }))
  );
}

/**
 * Plain text cut into its words and what can be opened from it: web addresses (with or without
 * `https://`, `www.` or a known top-level domain, trailing punctuation and unmatched brackets
 * left out – `linkifyjs`), mail addresses and phone numbers. Mentions and the like are the
 * caller's: this sees only text.
 */
export function linkify(text: string): LinkPart[] {
  const links = find(text)
    .filter((one) => one.type === 'url' || one.type === 'email')
    .map((one) => ({
      kind: one.type === 'email' ? ('email' as const) : ('url' as const),
      start: one.start,
      end: one.end,
      // Written without a scheme („www.slider.de“): opened over https, as browsers do now.
      href:
        one.type === 'url' && !/^[a-z][\w+.-]*:/i.test(one.value)
          ? `https://${one.value}`
          : one.href,
    }));
  // Phones in what is left between the links (a number in an address stays the address's).
  const found: { kind: 'url' | 'email' | 'phone'; start: number; end: number; href: string }[] = [
    ...links,
  ];
  let at = 0;
  for (const gap of [...links, { start: text.length, end: text.length }]) {
    const piece = text.slice(at, gap.start);
    for (const phone of phonesIn(piece)) {
      found.push({ kind: 'phone', start: at + phone.start, end: at + phone.end, href: phone.href });
    }
    at = gap.end;
  }
  found.sort((a, b) => a.start - b.start);

  const parts: LinkPart[] = [];
  let last = 0;
  for (const one of found) {
    if (one.start < last || !SAFE_HREF.test(one.href)) continue;
    if (one.start > last) parts.push({ kind: 'text', text: text.slice(last, one.start) });
    parts.push({ kind: one.kind, text: text.slice(one.start, one.end), href: one.href });
    last = one.end;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/**
 * How a long address shows (a newsletter's tracking link runs over lines): its host and the
 * start of its path, then „…“ – the host, what tells where it leads, always whole. The full
 * address is the link's and its tooltip's.
 */
export function shortUrl(text: string, max = 48): string {
  if (text.length <= max) return text;
  const bare = text.replace(/^https?:\/\//i, '');
  const host = bare.split(/[/?#]/)[0] ?? bare;
  if (bare.length <= max) return bare;
  return `${bare.slice(0, Math.max(host.length + 12, max - 1))}…`;
}
