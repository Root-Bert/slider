/*
 * Reads the token values out of `index.css` for the token tests (palette mirror, namespace
 * snapshot). Plain text parsing – good enough for the one stylesheet we write ourselves.
 */

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The text of `styles/index.css`, read from disk (tests only – Vitest turns `?raw` css imports
 * into empty modules). `node:fs` is imported by name so the web tsconfig needs no Node types.
 */
export async function readIndexCss(): Promise<string> {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    readFileSync(path: URL, encoding: 'utf8'): string;
  };
  return fs.readFileSync(new URL('./index.css', import.meta.url), 'utf8');
}

/** The custom properties declared at the top level of the first `@theme { … }` block, in order. */
export function themeTokens(css: string): Map<string, string> {
  const source = stripComments(css);
  const start = source.indexOf('@theme');
  if (start === -1) throw new Error('no @theme block');
  const open = source.indexOf('{', start);
  const tokens = new Map<string, string>();
  let depth = 0;
  let statement = '';
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      depth++;
      if (depth > 1) statement = '';
      continue;
    }
    if (char === '}') {
      depth--;
      statement = '';
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (char === ';') {
      const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(statement);
      if (match) tokens.set(match[1]!, match[2]!.replace(/\s+/g, ' '));
      statement = '';
      continue;
    }
    statement += char;
  }
  return tokens;
}

/** `rgb(255 255 255 / 0.16)` → `{ rgb: [255, 255, 255], alpha: 0.16 }`; hex too. */
export function parseColor(value: string): { rgb: [number, number, number]; alpha: number } {
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+))?\s*\)/.exec(value);
  if (rgb) {
    return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: Number(rgb[4] ?? 1) };
  }
  const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!;
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
    return { rgb: [r, g, b], alpha: 1 };
  }
  throw new Error(`not a colour: ${value}`);
}
