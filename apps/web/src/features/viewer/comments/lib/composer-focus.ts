/** The new comment's text field in the composer popover. */
const COMMENT_FIELD = 'form[data-composer] textarea[aria-label="Kommentar"]';

/** Moves focus into the composer's comment field; false when there is none. */
export function focusCommentField(): boolean {
  const field = document.querySelector<HTMLTextAreaElement>(COMMENT_FIELD);
  if (!field) return false;
  field.focus();
  return true;
}

/**
 * Dispatched on the composer's form by ⌘↵ in a field outside its own – the sticker on the slide:
 * sends the comment and asks the AI, as ⌘↵ in the comment field does.
 */
export const SEND_TO_AI = 'slider:send-to-ai';
