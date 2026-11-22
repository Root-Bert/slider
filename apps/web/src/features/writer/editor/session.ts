import { createContext, use, useSyncExternalStore } from 'react';
import type { Author, WriterDocument } from '@slider/shared';
import type { ShowToast } from '@/ui';
import type { MarkdownView } from '../lib/markdown';
import type { WriterEngine } from './engine';

/**
 * The sheets' colour, chosen in the view's tools and remembered: white paper, dark paper, or as
 * the app's „Darstellung“ (`theme`, the default).
 */
export const WRITER_PAGES = ['light', 'theme', 'dark'] as const;
export type WriterPages = (typeof WRITER_PAGES)[number];

/** The open document, as every part of its page reaches it. */
export interface WriterSession {
  engine: WriterEngine;
  document: WriterDocument;
  me: Author;
  notify: ShowToast;
  /** A Markdown file: shown as written or rendered (`null`: a text document). */
  markdown: MarkdownView | null;
  /** Shows the Markdown file the other way. */
  setMarkdown: (view: MarkdownView) => void;
  pages: WriterPages;
  setPages: (pages: WriterPages) => void;
}

export const WriterContext = createContext<WriterSession | null>(null);

export function useWriter(): WriterSession {
  const session = use(WriterContext);
  if (!session) throw new Error('useWriter outside of an open document');
  return session;
}

/** What the document holds right now; the part drawing it follows every change. */
export function useWriterState() {
  const { engine } = useWriter();
  return useSyncExternalStore(engine.subscribe, engine.getState);
}
