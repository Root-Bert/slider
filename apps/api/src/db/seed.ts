import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import type { Anchor, Author } from '@slider/shared';
import { externalAuthor, ownerAuthor } from '../authors';
import type { Clock } from '../clock';
import { dataPaths, loadConfig } from '../config';
import { newReviewToken } from '../services/review-links';
import { upsertUser } from '../services/users';
import { ensurePersonalWorkspace } from '../services/workspaces';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { FsBlobStorage } from '../storage/fs-blob-storage';
import { openDatabase, type Database, type Transaction } from './client';
import {
  comments,
  decks,
  revisions,
  reviewLinks,
  slides,
  slideVersions,
  type UserRow,
} from './schema';
import {
  demoDecks,
  PEOPLE,
  SLIDE_TEMPLATES,
  type CommentSeed,
  type DeckSeed,
  type PersonKey,
  type SeedAnchor,
  type SlideImage,
} from './seed-data';

const ASSETS_DIR = fileURLToPath(new URL('../../seed/assets', import.meta.url));
const ASPECT_16_9 = 16 / 9;

export interface SeedDeps {
  db: Database;
  storage: BlobStorage;
  clock: Clock;
  owner: { name: string; email: string };
}

interface SeedContext extends SeedDeps {
  now: Date;
  authors: Record<PersonKey, Author>;
  slideImageKeys: Record<SlideImage, string>;
  ownerId: string;
  workspaceId: string;
}

/** Fills an empty database with the demo decks from the design. Returns the owner. */
export async function seedDemoData(deps: SeedDeps): Promise<UserRow> {
  const now = deps.clock.now();
  const slideImageKeys = {
    1: await copyAsset(deps.storage, 'slide-1.png'),
    2: await copyAsset(deps.storage, 'slide-2.png'),
    3: await copyAsset(deps.storage, 'slide-3.png'),
    4: await copyAsset(deps.storage, 'slide-4.png'),
  };

  const robert = await upsertUser(deps.db, {
    ...deps.owner,
    color: PEOPLE.robert.color,
    avatarKey: await copyAsset(deps.storage, PEOPLE.robert.avatar),
  });
  const reviewer = async (key: Exclude<PersonKey, 'robert'>): Promise<Author> => {
    const person = PEOPLE[key];
    const user = await upsertUser(deps.db, {
      ...person,
      avatarKey: await copyAsset(deps.storage, person.avatar),
    });
    // Reviewers join through review links, so they comment as guests.
    return { ...ownerAuthor(user), type: 'guest' };
  };
  const authors: Record<PersonKey, Author> = {
    robert: ownerAuthor(robert),
    lena: await reviewer('lena'),
    max: await reviewer('max'),
    anna: await reviewer('anna'),
  };

  const context: SeedContext = {
    ...deps,
    now,
    authors,
    slideImageKeys,
    ownerId: robert.id,
    workspaceId: await ensurePersonalWorkspace(deps.db, robert.id, now),
  };
  for (const deck of demoDecks(now)) await seedDeck(context, deck);
  return robert;
}

async function seedDeck(ctx: SeedContext, seed: DeckSeed): Promise<void> {
  const { db, now } = ctx;
  const deckId = crypto.randomUUID();
  const updatedAt = new Date(now.getTime() - seed.updatedAgo);
  const createdAt = new Date(updatedAt.getTime() - 14 * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.insert(decks).values({
      id: deckId,
      ownerId: ctx.ownerId,
      workspaceId: ctx.workspaceId,
      title: seed.title,
      fileName: `${seed.title}.pptx`,
      source: seed.source,
      createdAt,
      updatedAt,
      importState: seed.importState,
    });

    // Older revisions are recorded but not materialised; the demo only shows the current one.
    const revisionRows = Array.from({ length: seed.revisionNumber }, (_, i) => ({
      id: crypto.randomUUID(),
      deckId,
      number: i + 1,
      createdAt: new Date(createdAt.getTime() + i * 60 * 60 * 1000),
      slideWidthEmu: 12_192_000,
      slideHeightEmu: 6_858_000,
    }));
    await tx.insert(revisions).values(revisionRows);
    const current = revisionRows.at(-1);
    if (!current) throw new Error(`Deck ${seed.title} needs at least one revision`);
    await tx.update(decks).set({ currentRevisionId: current.id }).where(eq(decks.id, deckId));

    const slideIds = seed.slides.map(() => crypto.randomUUID());
    await tx.insert(slides).values(slideIds.map((id) => ({ id, deckId, createdAt })));
    await tx.insert(slideVersions).values(
      seed.slides.map((image, position) => {
        const template = SLIDE_TEMPLATES[image];
        const imageKey = ctx.slideImageKeys[image];
        return {
          id: crypto.randomUUID(),
          slideId: slideIds[position] ?? '',
          revisionId: current.id,
          position,
          pptxSldId: 256 + position,
          title: template.title,
          layoutName: null,
          imageKey,
          thumbnailKey: imageKey,
          aspectRatio: ASPECT_16_9,
          shapes: template.shapes,
        };
      }),
    );

    const slideAt = (position: number) => {
      const id = slideIds[position - 1];
      if (!id) throw new Error(`Deck ${seed.title} has no slide ${position}`);
      return id;
    };
    for (const comment of seed.comments) await seedComment(ctx, tx, deckId, comment, slideAt);

    if (seed.withReviewLink) {
      await tx.insert(reviewLinks).values({
        id: crypto.randomUUID(),
        deckId,
        token: newReviewToken(),
        role: 'comment',
        createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      });
    }
  });
}

async function seedComment(
  ctx: SeedContext,
  tx: Transaction,
  deckId: string,
  seed: CommentSeed,
  slideAt: (position: number) => string,
): Promise<void> {
  const at = (ago: number | Date) =>
    ago instanceof Date ? ago : new Date(ctx.now.getTime() - ago);
  const rootId = crypto.randomUUID();
  const slideId = seed.slide === null ? null : slideAt(seed.slide);
  const createdAt = at(seed.ago);
  const author = seed.pptxId
    ? {
        ...ctx.authors[seed.author],
        id: externalAuthor(ctx.authors[seed.author].name).id,
        type: 'external' as const,
      }
    : ctx.authors[seed.author];

  await tx.insert(comments).values({
    id: rootId,
    deckId,
    slideId,
    parentId: null,
    author,
    body: seed.body,
    anchor: toAnchor(seed.anchor, slideAt),
    strokes: seed.strokes ?? [],
    status: seed.resolvedBy ? 'done' : 'open',
    resolvedBy: seed.resolvedBy ? ctx.authors[seed.resolvedBy].id : null,
    resolvedAt: seed.resolvedBy ? new Date(createdAt.getTime() + 20 * 60 * 1000) : null,
    source: seed.pptxId ? 'pptx' : 'app',
    externalId: seed.pptxId ?? null,
    createdAt,
    updatedAt: createdAt,
  });

  for (const reply of seed.replies ?? []) {
    const replyAt = at(reply.ago);
    await tx.insert(comments).values({
      id: crypto.randomUUID(),
      deckId,
      slideId,
      parentId: rootId,
      author: ctx.authors[reply.author],
      body: reply.body,
      anchor: { type: 'slide' },
      source: 'app',
      createdAt: replyAt,
      updatedAt: replyAt,
    });
  }
}

function toAnchor(anchor: SeedAnchor, slideAt: (position: number) => string): Anchor {
  if (anchor.type !== 'gap') return anchor;
  return {
    type: 'gap',
    afterSlideId: slideAt(anchor.after),
    beforeSlideId: slideAt(anchor.before),
  };
}

async function copyAsset(storage: BlobStorage, fileName: string): Promise<string> {
  const key = fileName.startsWith('avatar-')
    ? blobKeys.avatar('png')
    : blobKeys.demoAsset(fileName);
  await storage.put(key, await readFile(path.join(ASSETS_DIR, fileName)));
  return key;
}

/** `bun run seed`: wipes the local database and files, then seeds fresh demo data. */
async function main(): Promise<void> {
  const config = loadConfig();
  const { dbDir, blobsDir } = dataPaths(config);
  await rm(dbDir, { recursive: true, force: true });
  await rm(blobsDir, { recursive: true, force: true });
  // Only Slider's own subfolder – MEDIA_DIR may be a folder with other things in it.
  await rm(path.join(config.media.dir, 'decks'), { recursive: true, force: true });

  const { db, close } = await openDatabase(dbDir);
  try {
    await seedDemoData({
      db,
      storage: new FsBlobStorage(blobsDir),
      clock: { now: () => new Date() },
      owner: config.devOwner,
    });
    console.info(`Seeded demo data into ${config.dataDir}`);
  } finally {
    await close();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
