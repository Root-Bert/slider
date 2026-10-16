/*
 * Finds raw colours in component source (design-system rule 1): white/black alpha classes,
 * arbitrary hex classes, `rgb()`/`rgba()` and `#hex` literals. Comments are ignored, string
 * contents are not (that is where the class names live).
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

/** Every raw colour in a `.tsx` source, with its 1-based line. */
export function findRawColors(source: string): RawColor[] {
  const code = stripComments(source);
  const found: RawColor[] = [];
  for (const pattern of PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push({ line, match: match[0] });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}
