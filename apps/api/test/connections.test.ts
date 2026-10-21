import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Executor } from '../src/db/client';
import { decks } from '../src/db/schema';
import { microsoftLoginRequiredAt, sourceForbidden } from '../src/sources/errors';
import {
  withConnections,
  withDeckConnection,
  type ConnectionLookup,
} from '../src/sources/connections';
import type { SourceContext } from '../src/sources/source-adapter';
import { createReadyDeck, createTestContext, type TestContext } from './helpers';

const deck = { id: 'd1', ownerId: 'u1', microsoftConnectionId: 'own' };

function lookup(ids: string[]): ConnectionLookup & { used: string[] } {
  const used: string[] = [];
  return { used, connectionIds: async () => ids, markUsed: async (id) => void used.push(id) };
}

/** A db stand-in that records `update(decks).set(...)` calls. */
function fakeDb() {
  const sets: unknown[] = [];
  const db = {
    update: () => ({ set: (values: unknown) => ({ where: async () => void sets.push(values) }) }),
    // The "connection still exists" guard of the update.
    select: () => ({ from: () => ({ where: () => ({}) }) }),
  } as unknown as Executor;
  return { db, sets };
}

/** Graph stand-in: only the listed connections can read the file. */
const readableBy =
  (allowed: string[], failure = () => sourceForbidden('Kein Zugriff')) =>
  async (context: SourceContext) => {
    context.connectionUsed = true;
    if (!context.connectionId || !allowed.includes(context.connectionId)) throw failure();
    return `read via ${context.connectionId}`;
  };

describe('withDeckConnection', () => {
  it("uses the deck's own connection while it has access", async () => {
    const connections = lookup(['own', 'other']);
    const { db, sets } = fakeDb();
    const result = await withDeckConnection(
      { db, connections },
      deck,
      readableBy(['own', 'other']),
    );
    expect(result).toMatchObject({ value: 'read via own', connectionId: 'own' });
    expect(sets).toEqual([]);
  });

  it('switches to another of the owner’s accounts when its own loses access', async () => {
    const connections = lookup(['own', 'other']);
    const { db, sets } = fakeDb();
    const result = await withDeckConnection({ db, connections }, deck, readableBy(['other']));
    expect(result).toMatchObject({ value: 'read via other', connectionId: 'other' });
    expect(sets).toEqual([{ microsoftConnectionId: 'other' }]);
    expect(connections.used).toEqual(['other']);
  });

  it("also switches when the own account's sign-in expired", async () => {
    const connections = lookup(['own', 'other']);
    const expired = () => microsoftLoginRequiredAt('/d/d1');
    const run = vi.fn(async (context: SourceContext) => {
      context.connectionUsed = true;
      if (context.connectionId === 'own') throw expired();
      return 'ok';
    });
    const result = await withDeckConnection({ connections }, deck, run);
    expect(result.connectionId).toBe('other');
  });

  it("keeps the own connection's error when no other account can read the file", async () => {
    const connections = lookup(['own', 'other']);
    const { db, sets } = fakeDb();
    const expired = microsoftLoginRequiredAt('/d/d1');
    const run = async (context: SourceContext) => {
      context.connectionUsed = true;
      throw context.connectionId === 'own' ? expired : sourceForbidden('Kein Zugriff');
    };
    await expect(withDeckConnection({ db, connections }, deck, run)).rejects.toBe(expired);
    expect(sets).toEqual([]);
  });

  it('does not try other accounts for failures unrelated to the account', async () => {
    const connections = lookup(['own', 'other']);
    const outage = new Error('Graph is down');
    const run = vi.fn(async (context: SourceContext) => {
      context.connectionUsed = true;
      throw outage;
    });
    await expect(withDeckConnection({ connections }, deck, run)).rejects.toBe(outage);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('withDeckConnection against the database', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.cleanup();
    ctx = undefined;
  });

  it('remembers nothing when the connection was disconnected during the check', async () => {
    ctx = await createTestContext();
    const { deckId } = await createReadyDeck(ctx);
    const row = { id: deckId, ownerId: ctx.ownerId, microsoftConnectionId: null };
    // `gone` read the file, but no longer exists: the foreign key must not fail the check.
    const result = await withDeckConnection(
      { db: ctx.deps.db, connections: lookup(['gone']) },
      row,
      readableBy(['gone']),
    );
    expect(result.connectionId).toBe('gone');
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck?.microsoftConnectionId).toBeNull();
  });
});

describe('withConnections', () => {
  it('marks the connection that worked as used', async () => {
    const connections = lookup(['a', 'b']);
    const result = await withConnections(connections, 'u1', readableBy(['b']));
    expect(result).toMatchObject({ value: 'read via b', connectionId: 'b' });
    expect(connections.used).toEqual(['b']);
  });
});
