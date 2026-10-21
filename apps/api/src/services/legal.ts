import { eq, inArray } from 'drizzle-orm';
import type { LegalTexts } from '@slider/shared';
import type { Executor } from '../db/client';
import { instanceSettings } from '../db/schema';

/**
 * Privacy policy and imprint (BER-141), kept in `instance_settings` next to the setup values –
 * under their own keys, which the setup page doesn't know and the environment can't override.
 */
const KEYS = { privacy: 'LEGAL_PRIVACY', imprint: 'LEGAL_IMPRINT' } as const;

export async function getLegalTexts(db: Executor): Promise<LegalTexts> {
  const rows = await db
    .select()
    .from(instanceSettings)
    .where(inArray(instanceSettings.key, Object.values(KEYS)));
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  return { privacy: value(KEYS.privacy), imprint: value(KEYS.imprint) };
}

export async function saveLegalTexts(db: Executor, texts: LegalTexts, now: Date): Promise<void> {
  for (const [field, key] of Object.entries(KEYS) as [keyof LegalTexts, string][]) {
    const value = texts[field];
    if (value === null) {
      await db.delete(instanceSettings).where(eq(instanceSettings.key, key));
      continue;
    }
    await db
      .insert(instanceSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: now } });
  }
}
