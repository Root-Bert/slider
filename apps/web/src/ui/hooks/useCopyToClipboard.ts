import { useEffect, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 2000;

/** Copies text and reports the outcome for two seconds ("Kopiert ✓"). */
export function useCopyToClipboard() {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // Wrapped in a promise: `navigator.clipboard` is undefined outside secure contexts.
  const copy = (text: string) =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setState('copied'),
        () => setState('failed'),
      );

  return { state, copy };
}
