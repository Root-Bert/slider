import sanitizeHtml, { type Attributes, type IOptions } from 'sanitize-html';
import type { AppDeps } from '../deps';
import { dnsLookup, readBodyCapped, safeFetch } from '../sources/safe-fetch';

/**
 * A mail's HTML as good mail programs show it (Apple Mail, Gmail, Proton, Fastmail): sanitized on
 * the way in and again on the way out against an allowlist (sanitize-html) – no scripts, event
 * handlers, forms, frames, plug-ins, `<base>`, `<meta>` refresh, outside style sheets or fonts;
 * links only to the web, mail and phone, each opening a tab of its own. It is shown as a page of its
 * own in a sandboxed frame without scripts and with a strict CSP ({@link MAIL_HTML_CSP}). Pictures
 * from outside (and tracking pixels with them) come only when asked for, and then through Slider's
 * server ({@link fetchMailImage}) – the sender never sees the reader's address; 1×1 pixels never
 * come at all. Pictures the mail carries itself (`cid:`) show at once.
 */

/** What is kept of a mail's HTML at most (sanitized); a larger one shows as its text. */
export const MAX_MAIL_HTML = 1024 * 1024;
/** HTML larger than this is not even sanitized (a mail of pictures inlined as `data:`). */
const MAX_SOURCE_HTML = 4 * 1024 * 1024;
/** A picture from outside, or one the mail carries, at most. */
export const MAX_MAIL_IMAGE_BYTES = 5 * 1024 * 1024;
/** One picture from outside: what takes longer counts as none. */
const IMAGE_TIMEOUT_MS = 15_000;
/** The pictures a mail's HTML shows from itself – kept only in these formats. */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * The frame's page: nothing runs, nothing is sent; pictures only from Slider (the proxy, the
 * mail's own) or inside the mail (`data:`); its own `<style>` and `style` attributes. The frame's
 * `sandbox` says the same again in the web app.
 */
export const MAIL_HTML_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox',
].join('; ');

/** Where a picture comes from as it is shown – `null`: not at all. */
type ImageSource = (src: string) => string | null;

const TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'big',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
  'wbr',
];

const ATTRIBUTES: IOptions['allowedAttributes'] = {
  '*': [
    'style',
    'class',
    'id',
    'dir',
    'lang',
    'title',
    'align',
    'valign',
    'width',
    'height',
    'bgcolor',
    'background',
    'border',
    'role',
    'aria-*',
  ],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'hspace', 'vspace'],
  table: ['cellpadding', 'cellspacing', 'summary', 'frame', 'rules'],
  td: ['colspan', 'rowspan', 'nowrap', 'headers', 'scope'],
  th: ['colspan', 'rowspan', 'nowrap', 'headers', 'scope'],
  col: ['span'],
  colgroup: ['span'],
  font: ['color', 'face', 'size'],
  hr: ['color', 'noshade', 'size'],
  ol: ['start', 'type', 'reversed'],
  ul: ['type'],
  li: ['value', 'type'],
  blockquote: ['cite'],
  q: ['cite'],
  del: ['cite', 'datetime'],
  ins: ['cite', 'datetime'],
  time: ['datetime'],
  details: ['open'],
  style: ['media', 'type'],
};

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** A web address as it is fetched (`//cdn…` → `https://cdn…`), or `null`. */
function webUrl(src: string): string | null {
  const trimmed = src.trim();
  const full = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(full)) return null;
  try {
    return new URL(full).href;
  } catch {
    return null;
  }
}

/** As kept: the mail's own pictures, pictures inside it, web addresses – nothing else. */
const keptSource: ImageSource = (src) => {
  const trimmed = src.trim();
  if (/^cid:\S+$/i.test(trimmed)) return trimmed;
  if (DATA_IMAGE.test(trimmed)) return trimmed.replace(/\s+/g, '');
  return webUrl(trimmed);
};

/** `width`/`height` of a picture in px, from its attribute or its style. */
function sideOf(attribs: Attributes, side: 'width' | 'height'): number | null {
  const own = attribs[side]?.trim();
  const styled = new RegExp(`(?:^|;)\\s*${side}\\s*:\\s*([\\d.]+)px`, 'i').exec(
    attribs.style ?? '',
  )?.[1];
  const value = Number.parseFloat(own || styled || '');
  return Number.isFinite(value) ? value : null;
}

/** A tracking pixel: 2×2 px or smaller, or a picture hidden by its style. */
function isPixel(attribs: Attributes): boolean {
  const width = sideOf(attribs, 'width');
  const height = sideOf(attribs, 'height');
  if (width !== null && height !== null && width <= 2 && height <= 2) return true;
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attribs.style ?? '');
}

const GENERIC_FONT =
  /\b(?:sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-\w+|inherit|initial|unset|revert|var\()/i;

/**
 * A list of fonts that ends in a kind of font: the fonts a mail brings are not loaded, and a list
 * of only those fell to the browser's default (Times) – now to the nearest kind of what it names.
 */
export function withFallbackFont(families: string): string {
  if (GENERIC_FONT.test(families)) return families;
  const kind = /mono|courier|consolas|menlo|monaco/i.test(families)
    ? 'monospace'
    : /times|georgia|garamond|palatino|cambria|baskerville|didot|bodoni|serif/i.test(families)
      ? 'serif'
      : 'sans-serif';
  return families.replace(
    /\s*(!\s*important)?\s*$/i,
    (_, important?: string) => `, ${kind}${important ? ` ${important}` : ''}`,
  );
}

/**
 * CSS as shown: no outside style sheets or fonts, nothing old browsers ran, each `url()` where its
 * picture may come from (else none), each list of fonts ending in a kind of font. The CSP stops
 * what slips through anyway.
 */
function cleanCss(css: string, image: ImageSource): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/expression\s*\(|behaviou?r\s*:|-moz-binding\s*:|javascript\s*:/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_, _quote: string, src: string) => {
      const to = image(src);
      return to ? `url("${to.replace(/["\\\n\r]/g, encodeURIComponent)}")` : 'none';
    })
    .replace(
      /((?:^|[;{\s])font-family\s*:\s*)([^;}]+)/gi,
      (_, name: string, families: string) => `${name}${withFallbackFont(families)}`,
    );
}

/** A tag's own `style` cleaned as a `<style>`'s text is (`cleanCss`); gone when nothing is left. */
function cleanStyle(attribs: Attributes, image: ImageSource): Attributes {
  const { style, ...rest } = attribs;
  const css = style ? cleanCss(style, image) : '';
  return css.trim() ? { ...rest, style: css } : rest;
}

/** A link opens a tab of its own, without telling where it came from; only web, mail, phone. */
function link(attribs: Attributes): Attributes {
  const { href, ...rest } = attribs;
  const raw = href?.trim() ?? '';
  const to = /^(?:mailto|tel):/i.test(raw) ? raw : webUrl(raw);
  return { ...rest, ...(to ? { href: to } : {}), target: '_blank', rel: 'noopener noreferrer' };
}

function sanitize(html: string, image: ImageSource): string {
  const out = sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'background'],
    allowProtocolRelative: true,
    // `<style>` is kept (newsletters are laid out by it); its text is cleaned below.
    allowVulnerableTags: true,
    // Each `style` is cleaned below, not parsed: hundreds per newsletter.
    parseStyleAttributes: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'template', 'xml'],
    transformTags: {
      // The body's colour and padding stay: as a block of its own (a div knows no `bgcolor`),
      // out to the sheet's edges over the page's room around a mail (`mailHtmlDocument`).
      body: (_tag, { bgcolor, ...attribs }) => {
        const colour = bgcolor && /^#?\w+$/.test(bgcolor) ? `background-color:${bgcolor};` : '';
        const own = cleanStyle(attribs, image).style ?? '';
        return {
          tagName: 'div',
          attribs: {
            ...attribs,
            style: `padding:12px 16px;${colour}${own};margin:-12px -16px`,
          },
        };
      },
      a: (_tag, attribs) => ({ tagName: 'a', attribs: link(cleanStyle(attribs, image)) }),
      img: (_tag, attribs) => {
        // A pixel goes as a whole (an empty `<img />`, dropped below; renaming a void tag would
        // rename the next closing one); a picture not shown keeps its box and words.
        if (isPixel(attribs)) return { tagName: 'img', attribs: {} };
        const { src, ...rest } = cleanStyle(attribs, image);
        const to = src ? image(src) : null;
        return { tagName: 'img', attribs: to ? { ...rest, src: to } : rest };
      },
      '*': (tag, attribs) => {
        const { background, face, ...rest } = cleanStyle(attribs, image);
        const backdrop = background ? image(background) : null;
        return {
          tagName: tag,
          attribs: {
            ...rest,
            ...(backdrop ? { background: backdrop } : {}),
            // `<font face>`: its fonts end in a kind of font, as in CSS.
            ...(face ? { face: withFallbackFont(face) } : {}),
          },
        };
      },
    },
  });
  // A `<style>`'s text comes as it was: cleaned, and no `<` that could close it in a browser.
  // A picture left with nothing (a pixel, an address not allowed) goes.
  return out
    .replace(/<img \/>/g, '')
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_, open: string, css: string, close: string) =>
        `${open}${cleanCss(css, image).replace(/</g, '\\3c ')}${close}`,
    );
}

/**
 * A mail's HTML as kept: sanitized, its pictures' addresses as they were (`cid:`, the web, `data:`);
 * `null` when it shows nothing or is too large (the mail shows as its text).
 */
export function keptMailHtml(html: string): string | null {
  if (html.length > MAX_SOURCE_HTML) return null;
  const clean = sanitize(html, keptSource).trim();
  if (clean.length > MAX_MAIL_HTML) return null;
  const words = clean
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|\s/g, '');
  return words || /<img\b/i.test(clean) ? clean : null;
}

/**
 * Kept HTML sanitized anew for showing: the mail's own pictures from `inline`, pictures from
 * outside through `proxy` – without it not at all. `remote`: the outside pictures it shows.
 */
export function mailHtmlView(
  kept: string,
  inline: (cid: string) => string | null,
  proxy: ((url: string) => string) | null,
): { body: string; remote: string[] } {
  const remote = new Set<string>();
  const body = sanitize(kept, (src) => {
    const trimmed = src.trim();
    if (/^cid:/i.test(trimmed)) return inline(trimmed.slice(4).replace(/^<|>$/g, ''));
    if (DATA_IMAGE.test(trimmed)) return trimmed;
    const url = webUrl(trimmed);
    if (!url) return null;
    remote.add(url);
    return proxy ? proxy(url) : null;
  });
  return { body, remote: [...remote] };
}

/**
 * The frame's page: a white sheet as mail is designed for, light also in dark mode. How many
 * pictures from outside it leaves out is read by the web app from `slider-remote-images`.
 */
export function mailHtmlDocument(body: string, remoteImages: number): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer">',
    `<meta name="slider-remote-images" content="${remoteImages}">`,
    '<base target="_blank">',
    '<style>html{background:#fff;color:#1f1f1f;color-scheme:light}',
    'body{margin:0;padding:12px 16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;overflow-wrap:break-word}',
    'img[src]{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>',
    `</head><body>${body}</body></html>`,
  ].join('');
}

/** The picture's format by its first bytes – never by what the server says; `null`: none we show. */
export function imageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

/**
 * A picture from outside, fetched by Slider's server for the reader: https only (`http:` is asked
 * for as `https:`), public addresses only, ≤ {@link MAX_MAIL_IMAGE_BYTES}, no cookies, no referrer,
 * no address of the reader. `null` when it does not come or is no picture.
 */
export async function fetchMailImage(
  deps: AppDeps,
  src: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bytes = await Promise.race([
    fetchPicture(deps, url),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const type = bytes ? imageType(bytes) : null;
  return bytes && type ? { bytes, type } : null;
}

/**
 * `GET url` through `safeFetch` (the network of `mail-logos`, faked in tests): only `Accept` and a
 * generic agent – no cookies, no referrer. Not through `mail-logos` itself: it leads back to
 * `mail.ts` (via `mail-insights`), an import cycle.
 */
async function fetchPicture(deps: AppDeps, url: URL): Promise<Uint8Array | null> {
  const network = deps.senderLogos ?? {};
  try {
    const { response } = await safeFetch(
      url,
      {
        fetch: network.fetch ?? globalThis.fetch,
        lookup: network.lookup ?? dnsLookup,
        maxBytes: MAX_MAIL_IMAGE_BYTES,
      },
      {
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; Slider)',
        },
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await readBodyCapped(response, MAX_MAIL_IMAGE_BYTES);
  } catch {
    return null;
  }
}
