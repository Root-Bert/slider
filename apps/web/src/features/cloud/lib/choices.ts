import { CLOUD_AGENT_CHOICE } from '@slider/shared';

/** The answers an agent offers in a message (`[[choice:…]]`), in its order. */
export const choicesIn = (text: string): string[] => [
  ...new Set([...text.matchAll(CLOUD_AGENT_CHOICE)].flatMap((match) => match[1]?.trim() || [])),
];

/** The message as it reads: without the answers it offers – they stand under it as buttons. */
export const withoutChoices = (text: string): string =>
  text
    .replace(CLOUD_AGENT_CHOICE, '')
    // One being written right now: not shown half.
    .replace(/\[\[?(c(h(o(i(c(e(:[^\]\n]*\]?)?)?)?)?)?)?)?$/, '')
    .trimEnd();
