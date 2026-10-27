/**
 * What the AI is busy with while it works on a comment (BER-183): a question gets an answer,
 * anything else a change to the slide. The proposal's prompt is its thread as the AI reads it –
 * "Name: text" per message, the asking one last.
 */

/** "Kannst du …?", "Bitte …?" ask for a change, even with a question mark. */
const REQUEST =
  /^(bitte\b|kannst du|könntest du|würdest du|magst du|kann man|could you|can you|would you|please\b)/i;

/** The asking message's text, without its author. */
export function askText(prompt: string): string {
  const last = prompt.split('\n\n').at(-1)?.trim() ?? '';
  const colon = last.indexOf(': ');
  return colon === -1 ? last : last.slice(colon + 2).trim();
}

export function isQuestion(prompt: string): boolean {
  const ask = askText(prompt);
  if (REQUEST.test(ask) || /\bbitte\b/i.test(ask)) return false;
  return ask.includes('?');
}

/** The line next to the spinner. */
export const workingLabel = (prompt: string) =>
  isQuestion(prompt) ? 'Denkt nach …' : 'Ändert die Folie …';
