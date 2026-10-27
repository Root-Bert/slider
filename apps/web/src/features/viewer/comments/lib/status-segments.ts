import type { Segment } from '@/ui';
import type { StatusCounts, StatusFilter } from './comment-selectors';

/**
 * The comment filter's segments. The comment states share the speech bubble: struck through
 * (Ausgeblendet: no comments, just the slides), two bubbles (Alle), empty (Offen). The two that
 * are past being a comment leave it: KI is the sparkles the AI wears everywhere else (threads the
 * AI edited), Erledigt the filled check circle. Ausgeblendet has no count; it shows none.
 */
export function statusSegments(counts?: StatusCounts): Segment<StatusFilter>[] {
  return [
    { value: 'hidden', label: 'Kommentare ausblenden', icon: 'commentsOff' },
    { value: 'all', label: 'Alle', icon: 'commentAll', count: counts?.all },
    { value: 'open', label: 'Offen', icon: 'commentOpen', count: counts?.open },
    { value: 'ai', label: 'KI', icon: 'autoAwesome', count: counts?.ai },
    { value: 'done', label: 'Erledigt', icon: 'checkCircle', count: counts?.done },
  ];
}
