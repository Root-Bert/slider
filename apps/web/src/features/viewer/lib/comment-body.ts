/**
 * "Markdown-light" for comment bodies: @mentions, **bold** and bare http(s) links.
 * Produces tokens that the UI renders as React nodes – never HTML strings, so bodies are XSS-safe.
 */

export type BodyToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'mention'; text: string }
  | { type: 'link'; text: string; href: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Trailing punctuation usually belongs to the sentence, not the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

function buildPattern(knownNames: readonly string[]): RegExp {
  // Longest names first so "@Anna Becker" wins over "@Anna".
  const names = [...knownNames].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const mention =
    names.length > 0 ? `@(?:${names.join('|')})|@[\\p{L}\\p{N}_.-]+` : '@[\\p{L}\\p{N}_.-]+';
  return new RegExp(`(\\*\\*[^*\\n]+\\*\\*)|(https?:\\/\\/[^\\s<>"]+)|(${mention})`, 'gu');
}

export function tokenizeBody(body: string, knownNames: readonly string[] = []): BodyToken[] {
  const tokens: BodyToken[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const previous = tokens.at(-1);
    if (previous?.type === 'text') previous.text += text;
    else tokens.push({ type: 'text', text });
  };

  let cursor = 0;
  for (const match of body.matchAll(buildPattern(knownNames))) {
    const index = match.index;
    const [whole, bold, url, mention] = match;
    // A mention must start a word ("mail@host" is no mention).
    if (mention && index > 0 && /[\p{L}\p{N}]/u.test(body[index - 1] ?? '')) continue;

    pushText(body.slice(cursor, index));
    cursor = index + whole.length;

    if (bold) tokens.push({ type: 'bold', text: bold.slice(2, -2) });
    else if (mention) tokens.push({ type: 'mention', text: mention });
    else if (url) {
      const trailing = url.match(TRAILING_PUNCTUATION)?.[0] ?? '';
      const href = trailing ? url.slice(0, -trailing.length) : url;
      tokens.push({ type: 'link', text: href, href });
      pushText(trailing);
    }
  }
  pushText(body.slice(cursor));
  return tokens;
}
