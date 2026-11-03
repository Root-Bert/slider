/** Work that must not overlap waits for the work before it under the same key, in order. */
const locks = new Map<string, Promise<unknown>>();

/** Runs `work` once the work queued under `key` before it is done – failed work too. */
async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

/** Editing waits for the deck's other edits: one at a time per deck, in the order they came. */
export const withDeckLock = <T>(deckId: string, work: () => Promise<T>): Promise<T> =>
  withLock(`deck:${deckId}`, work);

/**
 * Taking an AI proposal back, applying it again, swapping its photo: one at a time per proposal,
 * so its status read inside is still its status when the change goes in. Not the deck's lock –
 * the work takes that itself for each step (it is not re-entrant), and a proposal's steps are
 * steps like any other there.
 */
export const withProposalLock = <T>(proposalId: string, work: () => Promise<T>): Promise<T> =>
  withLock(`ai-proposal:${proposalId}`, work);
