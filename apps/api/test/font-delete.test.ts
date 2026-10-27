import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { decks, revisions, workspaceFonts, workspaceMembers } from '../src/db/schema';
import { deleteWorkspaceFonts, uploadWorkspaceFonts } from '../src/services/workspace-fonts';
import { createReadyDeck, createTestContext, signedInUser } from './helpers';

/** Lato under a name of its own ("Lota" – Lato itself is one of Slider's fonts). */
function lota(): Uint8Array {
  const bytes = new Uint8Array(
    readFileSync(new URL('../../../fonts/google/Lato-Regular.ttf', import.meta.url)),
  );
  const from = [0, 76, 0, 97, 0, 116, 0, 111]; // "Lato", UTF-16BE
  for (let i = 0; i + from.length <= bytes.length; i += 1) {
    if (from.every((byte, j) => bytes[i + j] === byte)) {
      bytes[i + 3] = 111; // o
      bytes[i + 7] = 97; // a
    }
  }
  return bytes;
}

/** A deck file whose text is set in `family`. */
async function fileNaming(family: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'content.xml',
    `<office:document-content><style:style><style:text-properties fo:font-family="${family}"/></style:style></office:document-content>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

it('keeps a font while a review uses it, and removes it once none does', async () => {
  const ctx = await createTestContext();
  try {
    await uploadWorkspaceFonts(ctx.deps, ctx.ownerId, ctx.workspaceId, [
      { name: 'Lota-Regular.ttf', bytes: lota() },
    ]);
    // A review that does not name it, and one that does.
    const ids: string[] = [];
    for (const [title, family] of [
      ['Ohne', 'Arial'],
      ['Quartalsbericht', 'Lota'],
    ] as const) {
      const deck = await createReadyDeck(ctx, { title });
      ids.push(deck.deckId);
      const key = `test/${deck.deckId}.odp`;
      await ctx.deps.storage.put(key, await fileNaming(family));
      await ctx.deps.db
        .update(revisions)
        .set({ pptxKey: key })
        .where(eq(revisions.id, deck.revisionId));
    }

    await expect(
      deleteWorkspaceFonts(ctx.deps, ctx.ownerId, ctx.workspaceId, { family: 'Lota' }),
    ).rejects.toThrow('nutzt noch die Review „Quartalsbericht“');

    await ctx.deps.db.delete(decks).where(eq(decks.id, ids[1]!));
    expect(
      await deleteWorkspaceFonts(ctx.deps, ctx.ownerId, ctx.workspaceId, { family: 'Lota' }),
    ).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

it('replaces a face the workspace has only for admins – members add new ones', async () => {
  const ctx = await createTestContext();
  try {
    const member = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: member.user.id, role: 'member' });
    const upload = (userId: string) =>
      uploadWorkspaceFonts(ctx.deps, userId, ctx.workspaceId, [
        { name: 'Lota-Regular.ttf', bytes: lota() },
      ]);
    await upload(member.user.id);
    await expect(upload(member.user.id)).rejects.toThrow('nur Admins');
    const [face] = await ctx.deps.db.select().from(workspaceFonts);
    expect(face?.uploadedById).toBe(member.user.id);

    await upload(ctx.ownerId);
    const [replaced] = await ctx.deps.db.select().from(workspaceFonts);
    expect(replaced?.uploadedById).toBe(ctx.ownerId);
  } finally {
    await ctx.cleanup();
  }
});
