import { useEffect, useEffectEvent, useRef } from 'react';
import { useVoice } from '../voice-context';
import { joinHeard } from '../lib/heard-words';

/**
 * A field that takes what is said while speaking to the AI: the live words heard from its mount
 * on are put into it as they come (`set` gets the field's text joined with them), typing and
 * correcting meanwhile stays. The box for the AI (`AiBoxComposer`, claimed by the provider for
 * its draft) and Folie 1's prompt (`claim: 'strict'` – nothing said goes to the session while it
 * is open) both use it.
 */
export function useHeardWords(
  set: (update: (now: string) => string) => void,
  { claim }: { claim?: 'strict' } = {},
) {
  const voice = useVoice();
  const taken = useRef(voice.heard().length);
  const heard = voice.live?.text ?? '';
  // The field as the last words left it: words that follow go on right there.
  const lastTaken = useRef<string | null>(null);
  const take = useEffectEvent((words: string) => {
    // Read once, outside the update: React may run it twice (strict mode), alike both times.
    const before = lastTaken.current;
    set((now) => {
      const next = joinHeard(now, words, before);
      lastTaken.current = next;
      return next;
    });
  });
  useEffect(() => {
    if (heard.length < taken.current) taken.current = heard.length;
    if (heard.length === taken.current) return;
    const words = heard.slice(taken.current);
    taken.current = heard.length;
    take(words);
  }, [heard]);
  const { claim: claimWords } = voice;
  useEffect(() => {
    if (!claim) return;
    // From here on: words said before belong to what was being said then.
    taken.current = voice.heard().length;
    return claimWords({ strict: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim, claimWords]);
  const listening = voice.status === 'listening';
  return {
    voice,
    listening,
    /** Words coming in: the AI's light runs round the field. */
    lit: listening && voice.speaking && voice.live !== null,
  };
}
