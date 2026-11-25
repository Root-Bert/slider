import type { SenderMessage, SenderReplyQuote } from '@slider/shared';
import { markupPlain } from './markup';

/** The quote of a message one answers, as the server would give it. */
export const quoteOf = (message: SenderMessage): SenderReplyQuote => {
  const text = markupPlain(message.text).replace(/\s+/g, ' ').trim();
  return {
    id: message.id,
    name: message.agent?.title ?? message.author?.name ?? null,
    text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
    deleted: message.deleted,
  };
};
