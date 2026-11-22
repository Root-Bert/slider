import { eq, inArray } from 'drizzle-orm';
import { legalTemplateSchema, type LegalTexts, type UpdateLegalTextsInput } from '@slider/shared';
import type { Executor } from '../db/client';
import { instanceSettings } from '../db/schema';

/**
 * Privacy policy and imprint (BER-141), kept in `instance_settings` next to the setup values –
 * under their own keys, which the setup page doesn't know and the environment can't override.
 */
const KEYS = { privacy: 'LEGAL_PRIVACY', imprint: 'LEGAL_IMPRINT' } as const;
/** What the templates were filled with, as JSON. */
const TEMPLATE_KEY = 'LEGAL_TEMPLATE';

export async function getLegalTexts(db: Executor): Promise<LegalTexts> {
  const rows = await db
    .select()
    .from(instanceSettings)
    .where(inArray(instanceSettings.key, [...Object.values(KEYS), TEMPLATE_KEY]));
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  return {
    privacy: value(KEYS.privacy),
    imprint: value(KEYS.imprint),
    template: parseTemplate(value(TEMPLATE_KEY)),
  };
}

function parseTemplate(json: string | null): LegalTexts['template'] {
  if (!json) return null;
  try {
    const parsed = legalTemplateSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveLegalTexts(
  db: Executor,
  texts: UpdateLegalTextsInput,
  now: Date,
): Promise<void> {
  const values: [string, string | null | undefined][] = [
    [KEYS.privacy, texts.privacy],
    [KEYS.imprint, texts.imprint],
    [
      TEMPLATE_KEY,
      texts.template === undefined ? undefined : texts.template && JSON.stringify(texts.template),
    ],
  ];
  for (const [key, value] of values) {
    if (value === undefined) continue;
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
