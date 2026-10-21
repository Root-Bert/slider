/*
 * Finds raw values in component source: raw colours (design-system rule 1: white/black alpha
 * classes, arbitrary hex classes, `rgb()`/`rgba()` and `#hex` literals) and literal type sizes,
 * radii, z-indices and easings (rules 3, 5–7). Comments are ignored, string contents are not
 * (that is where the class names live).
 */

export interface RawColor {
  line: number;
  match: string;
}

const PATTERNS: readonly RegExp[] = [
  // bg-white/10, hover:bg-black/60, border-white/[0.06], ring-offset-black/40, text-white/80 …
  /\b(?:white|black)\/(?:\d+(?:\.\d+)?|\[[^\]\s]+\])/g,
  // Opaque white/black classes: bg-black, text-white, hover:bg-white, outline-white …
  /\b(?:bg|text|border|ring|ring-offset|inset-ring|outline|fill|stroke|decoration|divide|placeholder|caret|from|via|to)-(?:white|black)\b(?!\/)/g,
  // Named paint in markup or style values: fill="white", isLight ? 'black' : 'white'
  /(["'`])(?:white|black)\1/g,
  // bg-[#141414], text-[#fff] …
  /\[#[0-9a-fA-F]{3,8}\]/g,
  // rgb(…) / rgba(…), also inside arbitrary classes (shadow-[…_rgb(255_255_255/0.35)])
  /(?<![a-zA-Z-])rgba?\(/g,
  // '#141414', fill="#fff" – a hex literal on its own, not part of a word or URL fragment
  /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
];

/**
 * Replaces comments with spaces (newlines kept, so line numbers stay right). Understands
 * strings, template literals with `${…}` and JSX `{/* … *\/}` – enough for our own source.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  // Each entry is the closing quote of an open string, or '}' for code inside `${ … }`.
  const stack: string[] = [];
  let braces: number[] = [];
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];
    const top = stack[stack.length - 1];
    const inString = top === "'" || top === '"' || top === '`';
    if (inString) {
      if (char === '\\') {
        out += char + (next ?? '');
        i += 2;
        continue;
      }
      if (top === '`' && char === '$' && next === '{') {
        stack.push('}');
        braces.push(0);
        out += '${';
        i += 2;
        continue;
      }
      if (char === top) stack.pop();
      // An unterminated '…' or "…" ends at the line (JSX text with an apostrophe).
      else if (char === '\n' && top !== '`') stack.pop();
      out += char;
      i++;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      // (An apostrophe in JSX text opens a "string" too; it is closed at the end of the line.)
      stack.push(char);
    } else if (top === '}' && char === '{') {
      braces[braces.length - 1]!++;
    } else if (top === '}' && char === '}') {
      if (braces[braces.length - 1] === 0) {
        stack.pop();
        braces = braces.slice(0, -1);
      } else braces[braces.length - 1]!--;
    }
    out += char;
    i++;
  }
  return out;
}

/** Every raw colour in a `.tsx`/`.ts` source, with its 1-based line. */
export function findRawColors(source: string): RawColor[] {
  return scan(source, PATTERNS);
}

const LITERAL_PATTERNS: readonly RegExp[] = [
  // text-[13px] – use the type scale (text-body, text-caption, …)
  /\btext-\[\d+(?:\.\d+)?px\]/g,
  // rounded-[4px], rounded-t-[0.25em] … – use a radius token; `rounded-[inherit]` is fine
  /\brounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-\[(?!inherit\])[^\]\s]+\]/g,
  // z-10, hover:z-[60], -z-1 – use a layer variable z-(--z-…)
  /(?<![\w[-])-?z-(?:\d+|\[[^\]\s]+\])(?![\w-])/g,
  // cubic-bezier(…) – use an ease-* token
  /cubic-bezier\(/g,
];

/** Literal type sizes, radii, z-indices and easings in a source (rules 3 and 5–7). */
export function findRawLiterals(source: string): RawColor[] {
  return scan(source, LITERAL_PATTERNS);
}

function scan(source: string, patterns: readonly RegExp[]): RawColor[] {
  const code = stripComments(source);
  const found: RawColor[] = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push({ line, match: match[0] });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}
