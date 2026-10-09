import { asc, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import {
  PptxError,
  textHash,
  type ParsedComment,
  type ParsedPresentation,
  type ParsedSlide,
} from '@slider/pptx';
import type { ParsedShareLink } from '@slider/shared';
import { comments, decks, revisions } from '../src/db/schema';
import type { OpenPptx } from '../src/import/pptx';
import { createDeckFromFile } from '../src/services/decks';
import type { RemoteFile, SourceAdapter } from '../src/sources/source-adapter';
import type { TestContext } from './helpers';

const HEADER = [0x50, 0x4b, 0x03, 0x04];

/** Fake PPTX bytes: the ZIP header plus a version name the versioned parser stub looks up. */
export const pptxBytes = (version: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array([...HEADER, ...new TextEncoder().encode(version)]);

const versionOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(HEADER.length));

export interface SlideDef {
  sldId: number;
  title: string;
  /** Body text; defaults to a sentence derived from the title. */
  body?: string;
  layout?: string;
}

export function slide(def: SlideDef, index: number): ParsedSlide {
  const body = def.body ?? `Inhalt zu ${def.title} mit Details und Zahlen`;
  const shapes = [
    { id: '2', text: def.title, placeholder: 'title', y: 0.05 },
    { id: '3', text: body, placeholder: 'body', y: 0.3 },
  ].map((shape) => ({
    id: shape.id,
    name: shape.placeholder,
    kind: 'text' as const,
    bbox: { x: 0.1, y: shape.y, w: 0.8, h: 0.2 },
    text: shape.text,
    paragraphs: [],
    imagePath: null,
    fill: null,
    placeholder: shape.placeholder,
  }));
  return {
    sldId: def.sldId,
    index,
    path: `ppt/slides/slide${index + 1}.xml`,
    hidden: false,
    guides: [],
    title: def.title,
    layoutName: def.layout ?? 'Titel und Inhalt',
    textHash: textHash(shapes.map((shape) => shape.text).join('\n')),
    shapes,
    background: null,
  };
}

export const presentation = (
  slides: SlideDef[],
  pptComments: ParsedComment[] = [],
): ParsedPresentation => ({
  size: { cx: 12_192_000, cy: 6_858_000 },
  slides: slides.map(slide),
  sections: [],
  comments: pptComments,
});

/** Six slides with sldIds 256…261. */
export const BASE_SLIDES: SlideDef[] = [
  { sldId: 256, title: 'Q4 Strategie', body: 'Vertriebsplanung Führungskreis' },
  { sldId: 257, title: 'Agenda', body: 'Rückblick Umsatz Roadmap nächste Schritte' },
  { sldId: 258, title: 'Umsatz nach Region', body: 'DACH Nordeuropa Südeuropa Gesamt' },
  { sldId: 259, title: 'Produkt-Roadmap', body: 'Beta Rollout Verfügbarkeit Meilensteine' },
  { sldId: 260, title: 'Risiken', body: 'Budget Personal Lieferketten Wettbewerb' },
  { sldId: 261, title: 'Vielen Dank', body: 'Fragen und Diskussion' },
];

/**
 * A parser stub that serves a different presentation per {@link pptxBytes} version. Versions
 * starting with `corrupt` throw like a broken file. `gate` lets a test hold an import.
 */
export function versionedPptx(versions: Record<string, ParsedPresentation>) {
  const gates = new Map<string, Promise<void>>();
  const open: OpenPptx = async (bytes) => {
    const version = versionOf(bytes);
    await gates.get(version);
    if (version.startsWith('corrupt')) throw new PptxError('corrupt', 'broken');
    const parsed = versions[version];
    if (!parsed) throw new Error(`Unknown test version ${version}`);
    return {
      presentation: parsed,
      renderSlideSvg: async (s: ParsedSlide) =>
        `<svg xmlns="http://www.w3.org/2000/svg"><text>${s.shapes.map((sh) => sh.text).join('|')}</text></svg>`,
    };
  };
  return {
    open,
    versions,
    /** Holds imports of `version` until the returned function is called. */
    gate(version: string): () => void {
      let release = () => {};
      gates.set(
        version,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        gates.delete(version);
        release();
      };
    },
  };
}

/** A OneDrive stand-in: token and bytes are set by the test; calls are recorded. */
export class FakeSource implements SourceAdapter {
  token = 'c1';
  bytes: Uint8Array = pptxBytes('v1');
  error: Error | null = null;

  readonly resolve = vi.fn(async (link: ParsedShareLink): Promise<RemoteFile> => {
    throw new Error(`resolve not expected in sync tests (${link.url.href})`);
  });

  readonly getChangeToken = vi.fn(async (): Promise<string> => {
    if (this.error) throw this.error;
    return this.token;
  });

  readonly download = vi.fn(async (): Promise<Uint8Array> => {
    if (this.error) throw this.error;
    return this.bytes;
  });
}

/** A ready OneDrive deck made through the real import pipeline from `source`'s current state. */
export async function createLinkDeck(ctx: TestContext, source: FakeSource): Promise<string> {
  const deck = await createDeckFromFile(ctx.deps, ctx, {
    fileName: 'Q4 Strategie.pptx',
    bytes: source.bytes,
    source: 'onedrive',
    sourceUrl: 'https://1drv.ms/p/s!test',
    sourceRef: 'drives/d1/items/i1',
    changeToken: source.token,
  });
  await ctx.deps.queue.idle();
  return deck.id;
}

export async function revisionRows(ctx: TestContext, deckId: string) {
  return ctx.deps.db
    .select()
    .from(revisions)
    .where(eq(revisions.deckId, deckId))
    .orderBy(asc(revisions.number));
}

export async function deckRow(ctx: TestContext, deckId: string) {
  const [row] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
  if (!row) throw new Error(`Deck ${deckId} missing`);
  return row;
}

export async function commentRows(ctx: TestContext, deckId: string) {
  return ctx.deps.db
    .select()
    .from(comments)
    .where(eq(comments.deckId, deckId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

export function pptComment(
  externalId: string,
  sldId: number,
  text: string,
  options: { status?: 'open' | 'done'; replies?: ParsedComment['replies'] } = {},
): ParsedComment {
  return {
    externalId,
    format: 'modern',
    sldId,
    author: { name: 'Lena Hoffmann', initials: 'LH' },
    createdAt: '2026-09-28T08:12:00.000Z',
    text,
    status: options.status ?? 'open',
    anchor: { type: 'slide' },
    replies: options.replies ?? [],
  };
}
