import type { CloudAgentChat } from '@slider/shared';
import { withoutChoices } from './choices';
import { plainNamed } from './named';

/** What a chat's search looks through in a message: its words as they read (names, no choices). */
export const messageWords = (message: CloudAgentChat['messages'][number]) =>
  message.role === 'user' ? message.text : plainNamed(withoutChoices(message.text));
