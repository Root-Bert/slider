import type { Diagram } from '@slider/shared';
import { createContext, useContext, type ReactNode } from 'react';
import type { LiveKind, PageLinkKind } from '../lib/nodes';

/**
 * What a page needs from where it is shown (Cloud): where a named file, folder, area or
 * presentation opens, what a live block shows now, a page made under this one, the toast for
 * a refusal, and the AI that rewrites a diagram. The editor itself knows none of them.
 */
export interface PageHost {
  linkTo: (kind: PageLinkKind, id: string, name: string) => string;
  live: (kind: LiveKind) => ReactNode;
  /**
   * A new page beside this one („Seite“ in the slash menu), with where it opens to be written;
   * null when it could not be made.
   */
  createPage?: (title: string) => Promise<{ id: string; name: string; href: string } | null>;
  /** A file's name as it is now, when it lies beside the page – a page renamed since it was linked. */
  nameOf?: (id: string) => string | null;
  /** A diagram made beside the page (empty, or with what it starts with); null when it failed (said). */
  createDiagram?: (
    title: string,
    diagram?: Diagram,
  ) => Promise<{ id: string; name: string } | null>;
  notify: (text: string, tone?: 'neutral' | 'danger') => void;
}

const PageHostContext = createContext<PageHost>({
  linkTo: () => '#',
  live: () => null,
  notify: () => undefined,
});

export const PageHostProvider = PageHostContext.Provider;
export const usePageHost = () => useContext(PageHostContext);
