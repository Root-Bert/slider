import { useState } from 'react';
import type { LegalTexts } from '@slider/shared';
import { useLegalTexts, useSaveLegalTexts } from '@/lib/api';

export type LegalKind = 'imprint' | 'privacy';
const KINDS: LegalKind[] = ['imprint', 'privacy'];
export const LEGAL_LABELS: Record<LegalKind, string> = {
  imprint: 'Impressum',
  privacy: 'Datenschutzerklärung',
};

const NO_TEXTS: LegalTexts = { imprint: null, privacy: null };

/**
 * The texts as edited on `/einrichtung`, saved with the page's one „Speichern“: what was typed
 * and which of the two differ from the saved ones. `commit` saves them – no restart needed.
 */
export function useLegalTextsDraft() {
  const stored = useLegalTexts();
  const save = useSaveLegalTexts();
  const [edited, setEdited] = useState<LegalTexts | null>(null);
  const base = stored.data ?? NO_TEXTS;
  const draft = edited ?? base;
  const changedKinds = KINDS.filter((kind) => (draft[kind] ?? '') !== (base[kind] ?? ''));
  return {
    stored,
    draft,
    update: (patch: Partial<LegalTexts>) =>
      setEdited((current) => ({ ...(current ?? base), ...patch })),
    changedKinds,
    /** Back to the saved texts. */
    reset: () => setEdited(null),
    saving: save.isPending,
    error: save.error,
    commit: async () => {
      await save.mutateAsync(draft);
      setEdited(null);
    },
  };
}
export type LegalTextsDraft = ReturnType<typeof useLegalTextsDraft>;
