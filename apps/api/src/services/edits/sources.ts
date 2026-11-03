import { desc, eq } from 'drizzle-orm';
import type { OdpDocument, OdpElementSource } from '@slider/odp';
import type { SlideOperation } from '@slider/shared';
import { deckEdits } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { openFile, type EditTarget } from './target';

/** How far back a step that deleted an element copied is looked for. */
const STEPS_LOOKED_AT = 500;

/**
 * The elements `operations` copy (`copyElement`) that `document` – the deck's file now – no longer
 * has, as the file just before the step that deleted them had them: an element cut (⌘X), or
 * deleted after it was copied, is put in again as it was then. One whose deleting step is not
 * found (too long ago, gone with its slide) is not among them: its copy does not fit.
 */
export async function loadSources(
  deps: AppDeps,
  target: EditTarget,
  document: OdpDocument,
  operations: readonly SlideOperation[],
): Promise<Map<string, OdpElementSource>> {
  const sources = new Map<string, OdpElementSource>();
  const wanted = new Set(
    operations.flatMap((operation) =>
      operation.type === 'copyElement' && document.slideOf(operation.elementId) === null
        ? [operation.elementId]
        : [],
    ),
  );
  if (wanted.size === 0) return sources;
  const steps = await deps.db
    .select({ seq: deckEdits.seq, fileKey: deckEdits.fileKey, operations: deckEdits.operations })
    .from(deckEdits)
    .where(eq(deckEdits.revisionId, target.revision.id))
    .orderBy(desc(deckEdits.seq))
    .limit(STEPS_LOOKED_AT);
  const fileBefore = new Map<string, string>();
  for (const [index, step] of steps.entries()) {
    const before = steps[index + 1];
    if (!before || before.seq !== step.seq - 1) continue;
    for (const operation of step.operations) {
      if (operation.type !== 'deleteElement' || !wanted.has(operation.elementId)) continue;
      if (!fileBefore.has(operation.elementId)) fileBefore.set(operation.elementId, before.fileKey);
    }
  }
  const files = new Map<string, OdpDocument | null>();
  for (const [elementId, key] of fileBefore) {
    if (!files.has(key)) {
      const bytes = await deps.storage.get(key);
      const file = bytes ? await openFile(bytes) : null;
      // Read as the step's own reading of it named them (`applyToFile`).
      file?.ensureIds();
      files.set(key, file);
    }
    const source = await files.get(key)?.elementSource(elementId);
    if (source) sources.set(elementId, source);
  }
  return sources;
}
