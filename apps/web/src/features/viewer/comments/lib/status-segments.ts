import type { Segment } from '@/ui';
import type { StatusCounts, StatusFilter } from './comment-selectors';

/**
 * The comment filter's segments – toggles: none picked (`all`) shows every comment, so "Alle"
 * has no segment of its own. The comment states share the speech bubble: struck through
 * (Ausgeblendet: no comments, just the slides), empty (Offen). The two that are past being a
 * comment leave it: KI is the sparkles the AI wears everywhere else (threads the AI asks back in),
 * Erledigt the filled check circle. Ausgeblendet has no count; it shows none. K switches to it and
 * back (`commentsToggled`).
 */
export function statusSegments(counts?: StatusCounts): Segment<StatusFilter>[] {
  return [
    {
      value: 'hidden',
      label: 'Kommentare ausblenden',
      title: 'Kommentare ausblenden (K)',
      icon: 'commentsOff',
    },
    { value: 'open', label: 'Offen', icon: 'commentOpen', count: counts?.open },
    { value: 'ai', label: 'KI', icon: 'autoAwesome', count: counts?.ai },
    { value: 'done', label: 'Erledigt', icon: 'checkCircle', count: counts?.done },
  ];
}
