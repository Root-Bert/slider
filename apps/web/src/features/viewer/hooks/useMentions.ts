import type { Author } from '@slider/shared';
import {
  useId,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { insertMention, mentionQueryAt, suggestPeople } from '../lib/mentions';
import { useViewerData } from '../state/viewer-data';

export interface Mentions {
  /** People to suggest for the `@…` before the caret; empty = no menu. */
  people: Author[];
  activeIndex: number;
  listId: string;
  optionId: (index: number) => string;
  pick: (person: Author) => void;
  /** Spread onto the textarea: owns `onChange`, tracks the caret, wires up the listbox. */
  fieldProps: {
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
    onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
    'aria-autocomplete': 'list';
    'aria-controls': string | undefined;
    'aria-activedescendant': string | undefined;
  };
  /**
   * Call first in the field's `onKeyDown`: ↑/↓ choose, Enter/Tab pick, Esc closes the menu.
   * `true` = the key was the menu's, the field must not act on it (send, cancel the draft …).
   */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/** `@` suggestions for a comment field (BER-105). `setValue` is the field's own state setter. */
export function useMentions(
  value: string,
  setValue: (value: string) => void,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
): Mentions {
  const { mentionable } = useViewerData();
  const [caret, setCaret] = useState<number | null>(null);
  // Esc closes the menu for this `@` only; the next one opens it again.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [selection, setSelection] = useState({ key: '', index: 0 });
  const listId = useId();

  // A caret past the end belongs to text that was replaced from outside (sent, restored).
  const query = caret === null || caret > value.length ? null : mentionQueryAt(value, caret);
  const people =
    query && query.start !== dismissedAt ? suggestPeople(mentionable, query.query) : [];
  const key = query ? `${query.start}:${query.query}` : '';
  const activeIndex = selection.key === key ? Math.min(selection.index, people.length - 1) : 0;
  const optionId = (index: number) => `${listId}-${index}`;

  const pick = (person: Author) => {
    if (!query || caret === null) return;
    const next = insertMention(value, query, caret, person.name);
    setValue(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (people.length === 0 || event.nativeEvent.isComposing) return false;
    const move = (step: number) =>
      setSelection({ key, index: (activeIndex + step + people.length) % people.length });
    switch (event.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Enter':
      case 'Tab':
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        pick(people[activeIndex] ?? people[0]!);
        break;
      case 'Escape':
        setDismissedAt(query?.start ?? null);
        break;
      default:
        return false;
    }
    // `preventDefault` also tells the viewer's shortcuts (Esc cancels the draft) to stay out.
    event.preventDefault();
    return true;
  };

  const open = people.length > 0;
  return {
    people,
    activeIndex,
    listId,
    optionId,
    pick,
    fieldProps: {
      onChange: (event) => {
        setValue(event.target.value);
        setCaret(event.target.selectionEnd);
      },
      onSelect: (event) => setCaret(event.currentTarget.selectionEnd),
      'aria-autocomplete': 'list',
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? optionId(activeIndex) : undefined,
    },
    onKeyDown,
  };
}
