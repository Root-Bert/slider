import { useSyncExternalStore } from 'react';
import { useVoice } from '../voice-context';

/** The microphone's level while `active` (0 else) – re-rendering the component that asks alone. */
export function useVoiceLevel(active: boolean): number {
  const voice = useVoice();
  const level = useSyncExternalStore(voice.subscribeLevel, voice.level, () => 0);
  return active ? level : 0;
}
