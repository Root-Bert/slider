import type { MailUnsubscribeRow } from '../db/schema';

/**
 * A mail's `List-Unsubscribe` (RFC 2369) and `List-Unsubscribe-Post` (RFC 8058) as far as Slider
 * can use them: the first https address, the first mail address, and whether a POST to the https
 * one leaves the list without a page (`oneClick`). `null`: nothing usable.
 */
export function unsubscribeOf(list: string, post: string): MailUnsubscribeRow | null {
  let http: string | null = null;
  let mailto: string | null = null;
  for (const [, inner] of list.matchAll(/<([^>]+)>/g)) {
    const value = inner?.trim() ?? '';
    try {
      const url = new URL(value);
      if (!http && url.protocol === 'https:') http = url.href;
      else if (!mailto && url.protocol === 'mailto:' && url.pathname.includes('@'))
        mailto = url.href;
    } catch {
      // Not an address.
    }
  }
  if (!http && !mailto) return null;
  return { http, mailto, oneClick: !!http && /list-unsubscribe\s*=\s*one-click/i.test(post) };
}
