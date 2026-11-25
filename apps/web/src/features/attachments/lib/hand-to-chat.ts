import { useEffect } from 'react';
import type { Attachment } from '@slider/shared';
import type { Attachments } from '../useAttachments';

/**
 * Files dropped on a chat where its page is not open – its row in Cloud's side bar: held here by
 * the chat (`channel:<id>`, `agent:<id>`) until its page takes them onto its field
 * (`useHandedToChat`) – at once if it is open already, else as it opens. Taken once.
 */
interface Handed {
  refs: Attachment[];
  files: File[];
}
const handed = new Map<string, Handed>();
const HANDED_EVENT = 'chat:handed';

export function handToChat(chat: string, given: Partial<Handed>): void {
  const now = handed.get(chat) ?? { refs: [], files: [] };
  handed.set(chat, {
    refs: [...now.refs, ...(given.refs ?? [])],
    files: [...now.files, ...(given.files ?? [])],
  });
  window.dispatchEvent(new Event(HANDED_EVENT));
}

/** What was handed to `chat` goes on `files` – Cloud files pointed to, the computer's up. */
export function useHandedToChat(
  chat: string,
  files: Attachments | undefined,
  onTaken?: () => void,
) {
  useEffect(() => {
    if (!files?.enabled) return;
    const take = () => {
      const got = handed.get(chat);
      if (!got) return;
      handed.delete(chat);
      if (got.refs.length > 0) files.point(got.refs);
      if (got.files.length > 0) files.add(got.files);
      onTaken?.();
    };
    take();
    window.addEventListener(HANDED_EVENT, take);
    return () => window.removeEventListener(HANDED_EVENT, take);
  }, [chat, files, onTaken]);
}
