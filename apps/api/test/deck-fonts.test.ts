import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { workspaceFonts, type DeckRow, type RevisionRow } from '../src/db/schema';
import { renderSlidePages } from '../src/import/office-pages';
import { adoptDeckFonts } from '../src/services/deck-fonts';
import { fontCovers, fontEmbedding } from '../src/services/font-file';
import { uploadWorkspaceFonts } from '../src/services/workspace-fonts';
import { createTestContext } from './helpers';

const read = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)));
const lato = () => read('../../../fonts/google/Lato-Regular.ttf');
const demoOdp = () => read('../../../packages/odp/test/fixtures/demo.odp');

/** Lato under a name of its own ("Lota" – Lato itself is one of Slider's fonts). */
function lota(): Uint8Array {
  const bytes = lato();
  const from = [0, 76, 0, 97, 0, 116, 0, 111]; // "Lato", UTF-16BE
  for (let i = 0; i + from.length <= bytes.length; i += 1) {
    if (from.every((byte, j) => bytes[i + j] === byte)) {
      bytes[i + 3] = 111; // o
      bytes[i + 7] = 97; // a
    }
  }
  return bytes;
}

/** The font's OS/2 table offset. */
function os2(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.getUint16(4); i += 1) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === 'OS/2')
      return view.getUint32(at + 8);
  }
  throw new Error('no OS/2');
}

/** Licence bits (`fsType`) set to `value`. */
function withFsType(bytes: Uint8Array, value: number): Uint8Array {
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(os2(bytes) + 8, value);
  return bytes;
}

/** A font whose character map maps no Unicode at all – like a subset made for one document. */
function withoutUnicode(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.getUint16(4); i += 1) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== 'cmap') continue;
    const cmap = view.getUint32(at + 8);
    for (let r = 0; r < view.getUint16(cmap + 2); r += 1) {
      view.setUint16(cmap + 4 + r * 8, 1); // Macintosh
      view.setUint16(cmap + 4 + r * 8 + 2, 0); // Roman
    }
  }
  return bytes;
}

/**
 * The demo ODP bringing `fonts` along, as LibreOffice embeds them (content.xml, `Fonts/`), each
 * set for Latin text by a style – or, `script: 'asian'`, only for Asian text.
 */
async function odpWith(
  fonts: { family: string; bytes: Uint8Array }[],
  { script = 'latin' }: { script?: 'latin' | 'asian' } = {},
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(demoOdp());
  let content = await zip.file('content.xml')!.async('string');
  const decls = fonts
    .map((font, i) => {
      zip.file(`Fonts/Font_${i}.ttf`, font.bytes);
      return (
        `<style:font-face style:name="${font.family}" svg:font-family="${font.family}"><svg:font-face-src>` +
        `<svg:font-face-uri xlink:href="Fonts/Font_${i}.ttf" xlink:type="simple"><svg:font-face-format svg:string="truetype"/></svg:font-face-uri>` +
        `</svg:font-face-src></style:font-face>`
      );
    })
    .join('');
  content = content.replace('<office:font-face-decls>', `<office:font-face-decls>${decls}`);
  const attribute = script === 'latin' ? 'fo:font-family' : 'style:font-family-asian';
  const styles = fonts
    .map(
      (font, i) =>
        `<style:style style:name="test-${i}" style:family="text"><style:text-properties ${attribute}="${font.family}"/></style:style>`,
    )
    .join('');
  content = content.replace('<office:automatic-styles>', `<office:automatic-styles>${styles}`);
  zip.file('content.xml', content);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('font licence and coverage', () => {
  it('reads what a font may be used for', () => {
    expect(fontEmbedding(lato())).toBe('installable');
    expect(fontEmbedding(withFsType(lato(), 0x0008))).toBe('editable');
    expect(fontEmbedding(withFsType(lato(), 0x0004))).toBe('preview');
    expect(fontEmbedding(withFsType(lato(), 0x0002))).toBe('restricted');
    // The least restrictive bit counts.
    expect(fontEmbedding(withFsType(lato(), 0x000c))).toBe('editable');
    expect(fontEmbedding(new Uint8Array(8))).toBe('restricted');
  });

  it('tells a whole font from one without the characters', () => {
    expect(fontCovers(lato(), 'Aaßä€0')).toBe(true);
    expect(fontCovers(lato(), '中')).toBe(false);
    expect(fontCovers(withoutUnicode(lato()), 'A')).toBe(false);
    expect(fontCovers(new Uint8Array(8), 'A')).toBe(false);
  });
});

describe('adoptDeckFonts', () => {
  const deckOf = (ctx: { workspaceId: string; ownerId: string }) => ({
    workspaceId: ctx.workspaceId,
    ownerId: ctx.ownerId,
    title: 'Quartalsbericht',
  });

  it('takes a whole, freely usable font an ODP brings along into the workspace', async () => {
    const ctx = await createTestContext();
    try {
      const bytes = await odpWith([{ family: 'Lota', bytes: lota() }]);
      expect(await adoptDeckFonts(ctx.deps, deckOf(ctx), bytes)).toEqual(['Lota']);
      const rows = await ctx.deps.db
        .select()
        .from(workspaceFonts)
        .where(eq(workspaceFonts.workspaceId, ctx.workspaceId));
      expect(rows).toEqual([
        expect.objectContaining({
          family: 'Lota',
          weight: 400,
          italic: false,
          sourceFile: 'Quartalsbericht',
          uploadedById: ctx.ownerId,
        }),
      ]);
      expect(await ctx.deps.storage.get(rows[0]!.storageKey)).toEqual(lota());
      // Imported again: the family is the workspace's already.
      expect(await adoptDeckFonts(ctx.deps, deckOf(ctx), bytes)).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('leaves fonts the file may not share, subsets, Slider’s own, misnamed and unused ones', async () => {
    const ctx = await createTestContext();
    try {
      const bytes = await odpWith([
        { family: 'Lota', bytes: withFsType(lota(), 0x0008) },
        { family: 'Lota', bytes: withoutUnicode(lota()) },
        { family: 'Lato', bytes: lato() },
        { family: 'Nicht Lota', bytes: lota() },
      ]);
      expect(await adoptDeckFonts(ctx.deps, deckOf(ctx), bytes)).toEqual([]);
      expect(await adoptDeckFonts(ctx.deps, deckOf(ctx), lato())).toEqual([]);
      const asian = await odpWith([{ family: 'Lota', bytes: lota() }], { script: 'asian' });
      expect(await adoptDeckFonts(ctx.deps, deckOf(ctx), asian)).toEqual([]);
      expect(await ctx.deps.db.select().from(workspaceFonts)).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('never replaces a family the workspace has', async () => {
    const ctx = await createTestContext();
    try {
      const uploaded = await uploadWorkspaceFonts(ctx.deps, ctx.ownerId, ctx.workspaceId, [
        { name: 'Lota-Bold.ttf', bytes: lota() },
      ]);
      const bytes = await odpWith([{ family: 'Lota', bytes: lota() }]);
      expect(await adoptDeckFonts(ctx.deps, deckOf(ctx), bytes)).toEqual([]);
      const rows = await ctx.deps.db.select().from(workspaceFonts);
      expect(rows.map((row) => row.id)).toEqual(uploaded.fonts.map((font) => font.id));
      expect(rows[0]?.sourceFile).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('renderSlidePages', () => {
  it('takes the fonts an ODP brings along before LibreOffice draws it – a PPTX not', async () => {
    const ctx = await createTestContext();
    try {
      const order: string[] = [];
      const deps = {
        storage: ctx.deps.storage,
        log: ctx.deps.log,
        libreOfficePdf: vi.fn(async () => {
          order.push('draw');
          throw new Error('no LibreOffice here');
        }),
        adoptFonts: vi.fn(async () => {
          order.push('adopt');
        }),
      };
      const deck = { id: 'deck', workspaceId: ctx.workspaceId } as DeckRow;
      const revision = { id: 'revision' } as RevisionRow;
      await renderSlidePages(deps, deck, revision, demoOdp(), []);
      expect(order).toEqual(['adopt', 'draw']);
      const pptx = read('../../../packages/pptx/samples/slider-demo.pptx');
      await renderSlidePages(deps, deck, revision, pptx, []);
      expect(deps.adoptFonts).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['adopt', 'draw', 'draw']);
    } finally {
      await ctx.cleanup();
    }
  });
});
