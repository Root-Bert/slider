import type { Author, WriterPresence } from '@slider/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { sendDocumentPresence } from '@/lib/api';
import type { EngineState } from './engine';

/** Someone else's caret and selection in the document. */
export interface RemoteCursor {
  author: Author;
  sel: NonNullable<WriterPresence['sel']>;
}

const SEND_EVERY_MS = 200;

/**
 * Tells the others where my caret stands while I type (`POST …/presence`), at most every 200 ms,
 * and `null` once the text is let go of – again whenever someone new comes in, so they see it.
 */
export function useSendPresence(documentId: string, state: EngineState, people: number) {
  const editing = state.mode === 'edit' && state.focused;
  const sel = editing ? state.sel : null;
  const key = sel
    ? `${sel.anchor.id}:${sel.anchor.offset}:${sel.focus.id}:${sel.focus.offset}`
    : '';
  // What the others were told last; '' – nothing, or nowhere.
  const last = useRef('');
  const pending = useRef(0);
  const latest = useEffectEvent(() => sel);
  useEffect(() => {
    if (key === last.current) return;
    if (pending.current) return;
    pending.current = window.setTimeout(() => {
      pending.current = 0;
      const now = latest();
      const nowKey = now
        ? `${now.anchor.id}:${now.anchor.offset}:${now.focus.id}:${now.focus.offset}`
        : '';
      if (nowKey === last.current) return;
      last.current = nowKey;
      sendDocumentPresence(
        documentId,
        now ? { anchor: { ...now.anchor }, focus: { ...now.focus } } : null,
      ).catch(() => {});
    }, SEND_EVERY_MS);
  }, [documentId, key]);
  // Someone came in: told again, they have nothing of it yet.
  const seen = useRef(people);
  useEffect(() => {
    if (people > seen.current && last.current) {
      const now = latest();
      if (now)
        sendDocumentPresence(documentId, { anchor: now.anchor, focus: now.focus }).catch(() => {});
    }
    seen.current = people;
  }, [documentId, people]);
  useEffect(
    () => () => {
      window.clearTimeout(pending.current);
      pending.current = 0;
      if (last.current) void sendDocumentPresence(documentId, null).catch(() => {});
    },
    [documentId],
  );
}

/** The others' carets as the stream tells them; one who leaves takes theirs along. */
export function useRemoteCursors(meId: string) {
  const [cursors, setCursors] = useState<ReadonlyMap<string, RemoteCursor>>(new Map());
  return {
    cursors,
    onCursor(author: Author, sel: WriterPresence['sel']) {
      if (author.id === meId) return;
      setCursors((now) => {
        const next = new Map(now);
        if (sel) next.set(author.id, { author, sel });
        else next.delete(author.id);
        return next;
      });
    },
    keep(people: readonly Author[]) {
      const here = new Set(people.map((each) => each.id));
      setCursors((now) => {
        if ([...now.keys()].every((id) => here.has(id))) return now;
        return new Map([...now].filter(([id]) => here.has(id)));
      });
    },
  };
}
