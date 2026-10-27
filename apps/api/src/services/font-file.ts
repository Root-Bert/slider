/*
 * Reads what Slider needs of an uploaded font file – TrueType or OpenType (CFF), one font each:
 * the family a deck names it by, which face of it it is, and the vertical metrics LibreOffice
 * lays out with. Only the tables for that are read, each bounds-checked; anything else is not a
 * font Slider takes.
 */

export interface FontFace {
  format: 'ttf' | 'otf';
  /**
   * The family as Office names it (name 1): a "Montserrat SemiBold" file is a family of its own
   * there, with up to four faces – regular, bold, italic, bold italic.
   */
  family: string;
  /** 700 for the family's bold faces, else 400. */
  weight: 400 | 700;
  italic: boolean;
  upm: number;
  ascent: number;
  descent: number;
}

export class FontFileError extends Error {}

/**
 * A variable font: every weight in one file. LibreOffice draws only its default instance from
 * it, so Slider takes the single faces (static files) instead.
 */
export class VariableFontError extends FontFileError {
  constructor() {
    super(
      'Variable Schriften gehen nicht – bitte die einzelnen Schnitte (bei Google Fonts im Ordner „static“).',
    );
  }
}

const tag = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

const MAX_NAME_RECORDS = 1024;
const MAX_NAME_BYTES = 1024;
const MAX_DECODED_NAME_BYTES = 16 * 1024;

/** UTF-16BE (Windows names) or Mac Roman's ASCII part (Mac names). */
function decodeName(bytes: Uint8Array, utf16: boolean): string {
  if (!utf16) return String.fromCharCode(...bytes.filter((byte) => byte < 0x80));
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return text;
}

/** The face a font file holds; a {@link FontFileError} naming the fault if it is none Slider takes. */
export function readFontFace(bytes: Uint8Array): FontFace {
  if (bytes.length < 12) throw new FontFileError('Die Datei ist keine Schrift.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = tag(view, 0);
  const format =
    version === 'OTTO' ? 'otf' : version === 'true' || view.getUint32(0) === 0x10000 ? 'ttf' : null;
  if (!format) {
    if (version === 'ttcf') {
      throw new FontFileError('Schriftsammlungen (.ttc) gehen nicht – bitte einzelne Schriften.');
    }
    if (version === 'wOFF' || version === 'wOF2') {
      throw new FontFileError('Web-Schriften (.woff) gehen nicht – bitte TTF oder OTF.');
    }
    throw new FontFileError('Die Datei ist keine TTF- oder OTF-Schrift.');
  }
  const count = view.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    if (at + 16 > bytes.length) throw new FontFileError('Die Schrift ist beschädigt.');
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > bytes.length) throw new FontFileError('Die Schrift ist beschädigt.');
    tables.set(tag(view, at), { offset, length });
  }
  if (tables.has('fvar')) throw new VariableFontError();
  const table = (name: string, min: number) => {
    const found = tables.get(name);
    if (!found || found.length < min) {
      throw new FontFileError(`Der Schrift fehlt die Tabelle ${name.trim()}.`);
    }
    return found.offset;
  };

  const head = table('head', 54);
  const upm = view.getUint16(head + 18);
  const macStyle = view.getUint16(head + 44);
  const hhea = table('hhea', 36);
  const ascent = view.getInt16(hhea + 4);
  const descent = -view.getInt16(hhea + 6);
  const os2 = tables.get('OS/2');
  const fsSelection = os2 && os2.length >= 64 ? view.getUint16(os2.offset + 62) : null;
  const bold = fsSelection === null ? (macStyle & 1) !== 0 : (fsSelection & 0x20) !== 0;
  const italic = fsSelection === null ? (macStyle & 2) !== 0 : (fsSelection & 0x01) !== 0;

  const name = table('name', 6);
  const nameEnd = name + tables.get('name')!.length;
  const records = view.getUint16(name + 2);
  const strings = name + view.getUint16(name + 4);
  if (
    records > MAX_NAME_RECORDS ||
    name + 6 + records * 12 > nameEnd ||
    strings < name + 6 + records * 12 ||
    strings > nameEnd
  ) {
    throw new FontFileError('Die Namenstabelle der Schrift ist beschädigt oder zu groß.');
  }
  // Rank references first; never decode every duplicate name into a separate string.
  const names: { rank: number; offset: number; length: number; windows: boolean }[] = [];
  for (let i = 0; i < records; i += 1) {
    const at = name + 6 + i * 12;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const language = view.getUint16(at + 4);
    const id = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const offset = strings + view.getUint16(at + 10);
    if (id !== 1) continue;
    if (length > MAX_NAME_BYTES || offset + length > nameEnd) {
      throw new FontFileError('Ein Schriftname ist beschädigt oder zu lang.');
    }
    const windows = platform === 3 && (encoding === 1 || encoding === 0);
    if (!windows && platform !== 1) continue;
    // Windows English first, any Windows name next, a Mac name last.
    const rank = windows ? (language === 0x409 ? 0 : 1) : 2;
    names.push({ rank, offset, length, windows });
  }
  let family = '';
  let decodedBytes = 0;
  for (const entry of names.sort((a, b) => a.rank - b.rank)) {
    decodedBytes += entry.length;
    if (decodedBytes > MAX_DECODED_NAME_BYTES) {
      throw new FontFileError('Die Namenstabelle der Schrift ist zu groß.');
    }
    family = decodeName(bytes.subarray(entry.offset, entry.offset + entry.length), entry.windows)
      .replace(/\p{Cc}/gu, '')
      .trim();
    if (family) break;
  }
  if (!family) throw new FontFileError('Die Schrift nennt keinen Namen.');
  if (upm < 16 || upm > 16384 || ascent <= 0)
    throw new FontFileError('Die Schrift ist beschädigt.');
  return {
    format,
    family: family.slice(0, 100),
    weight: bold ? 700 : 400,
    italic,
    upm,
    ascent,
    descent: Math.max(0, descent),
  };
}

/** The tables of a TrueType or OpenType file, bounds-checked; empty for anything else. */
function tablesOf(bytes: Uint8Array): Map<string, { offset: number; length: number }> {
  const tables = new Map<string, { offset: number; length: number }>();
  if (bytes.length < 12) return tables;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    if (at + 16 > bytes.length) return new Map();
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > bytes.length) continue;
    tables.set(tag(view, at), { offset, length });
  }
  return tables;
}

/**
 * What a font's licence lets a document that carries it do (OS/2 `fsType`, the least
 * restrictive bit counts): `installable` – used like any font on the computer; `editable` – only
 * in the document it came with, also to edit it; `preview` – only to show and print that
 * document; `restricted` – not embedded at all. A font that says nothing (no OS/2) counts as
 * `restricted`.
 */
export type FontEmbedding = 'installable' | 'editable' | 'preview' | 'restricted';

export function fontEmbedding(bytes: Uint8Array): FontEmbedding {
  const os2 = tablesOf(bytes).get('OS/2');
  if (!os2 || os2.length < 10) return 'restricted';
  const fsType = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    os2.offset + 8,
  );
  if ((fsType & 0x000f) === 0) return 'installable';
  if (fsType & 0x0008) return 'editable';
  if (fsType & 0x0004) return 'preview';
  return 'restricted';
}

/**
 * Whether the font has a glyph for every character of `text` (its Unicode cmap: format 4 or
 * 12). Tells a whole font from a subset – one carrying only the characters a document used.
 */
export function fontCovers(bytes: Uint8Array, text: string): boolean {
  const cmap = tablesOf(bytes).get('cmap');
  if (!cmap || cmap.length < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = cmap.offset + cmap.length;
  const count = view.getUint16(cmap.offset + 2);
  // Unicode subtables: Windows full (3,10) and BMP (3,1), then Unicode platform (0,*).
  let best: { rank: number; at: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const record = cmap.offset + 4 + i * 8;
    if (record + 8 > end) return false;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const at = cmap.offset + view.getUint32(record + 4);
    const rank =
      platform === 3 && encoding === 10
        ? 0
        : platform === 0
          ? 1
          : platform === 3 && encoding === 1
            ? 2
            : null;
    if (rank === null || at + 4 > end) continue;
    const format = view.getUint16(at);
    if (format !== 4 && format !== 12) continue;
    if (!best || rank < best.rank) best = { rank, at };
  }
  if (!best) return false;
  const at = best.at;
  const glyph = (code: number): number => {
    if (view.getUint16(at) === 12) {
      if (at + 16 > end) return 0;
      const groups = view.getUint32(at + 12);
      for (let i = 0; i < groups; i += 1) {
        const group = at + 16 + i * 12;
        if (group + 12 > end) return 0;
        const start = view.getUint32(group);
        if (code >= start && code <= view.getUint32(group + 4)) {
          return view.getUint32(group + 8) + code - start;
        }
      }
      return 0;
    }
    if (code > 0xffff || at + 14 > end) return 0;
    const segments = view.getUint16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    if (ranges + segments * 2 > end) return 0;
    for (let i = 0; i < segments; i += 1) {
      if (code > view.getUint16(ends + i * 2)) continue;
      const start = view.getUint16(starts + i * 2);
      if (code < start) return 0;
      const delta = view.getUint16(deltas + i * 2);
      const range = view.getUint16(ranges + i * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const index = ranges + i * 2 + range + (code - start) * 2;
      if (index + 2 > end) return 0;
      const id = view.getUint16(index);
      return id === 0 ? 0 : (id + delta) & 0xffff;
    }
    return 0;
  };
  return [...text].every((char) => glyph(char.codePointAt(0) as number) !== 0);
}
