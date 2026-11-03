import type { VoiceSession } from '@slider/shared';
import { createContext, useContext } from 'react';
import type { LiveCaption } from './lib/caption';

/** Where speaking to the AI is: off, starting the microphone, listening, held, ending. */
export type VoiceStatus = 'off' | 'starting' | 'listening' | 'paused' | 'ending' | 'ended';

export interface VoiceState {
  status: VoiceStatus;
  /** The person speaks right now (a piece is being heard). */
  speaking: boolean;
  /** Pieces sent and not yet decided on. */
  sending: number;
  session: VoiceSession | null;
  /** Why it could not start or stopped. */
  error: string | null;
  /**
   * All the live stream heard so far and where each piece ended in it – `null` without one (no
   * `live` key): then the caption is the pieces' text, after each pause.
   */
  live: LiveCaption | null;
  /** Starts listening – or ends it when it listens. */
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Closes the panel of an ended session. */
  dismiss: () => void;
  /** All the live stream heard so far ('' without one) – a box for the AI takes what follows. */
  heard: () => string;
  /** The microphone's level, 0…1 – read by the meter alone (`subscribeLevel`). */
  level: () => number;
  subscribeLevel: (listener: () => void) => () => void;
}

export const VoiceContext = createContext<VoiceState | null>(null);

export function useVoice(): VoiceState {
  const voice = useContext(VoiceContext);
  if (!voice) throw new Error('useVoice must be used inside <VoiceProvider>');
  return voice;
}
