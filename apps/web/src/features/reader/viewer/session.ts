import { createContext, use, useSyncExternalStore } from 'react';
import type { Author, ReaderPdf } from '@slider/shared';
import type { ShowToast } from '@/ui';
import type { MarkStore } from './marks';

/** The open PDF, as every part of its page reaches it. */
export interface ReaderSession {
  pdf: ReaderPdf;
  me: Author;
  notify: ShowToast;
  marks: MarkStore;
}

export const ReaderContext = createContext<ReaderSession | null>(null);

export function useReader(): ReaderSession {
  const session = use(ReaderContext);
  if (!session) throw new Error('useReader outside of an open PDF');
  return session;
}

/** What is filled in right now; the part drawing it follows every change. */
export function useMarks() {
  const { marks } = useReader();
  return useSyncExternalStore(marks.subscribe, marks.getState);
}
