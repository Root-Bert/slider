import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MenuAction } from '@/ui';

/*
 * What a page lends the command panel (⌘K): its own actions – the same `MenuAction`s its menus
 * show, so label, icon, confirm and who may are one – and the workspace it is in where the
 * address does not say it (a presentation, a document, a PDF open).
 */

export interface PageCommands {
  /** The heading they stand under in the panel: „Neu“, „Präsentation“, „Dokument“ … */
  group: string;
  actions: readonly MenuAction[];
  workspaceId?: string | null;
}

const registered = new Map<symbol, () => PageCommands>();

/** Lends the panel this page's commands while it is mounted (`enabled`). */
export function usePageCommands(commands: PageCommands, enabled = true) {
  const latest = useRef(commands);
  useLayoutEffect(() => {
    latest.current = commands;
  });
  useEffect(() => {
    if (!enabled) return;
    const id = Symbol('page-commands');
    registered.set(id, () => latest.current);
    return () => {
      registered.delete(id);
    };
  }, [enabled]);
}

/** What the pages lend, the innermost (registered last) first. */
export const pageCommands = (): PageCommands[] =>
  [...registered.values()].reverse().map((get) => get());

const claims: { current: () => void }[] = [];

/**
 * ⌘K means something else here for now – the Writer's link while text is picked, nothing while
 * presenting: `run` takes the key instead of the panel (`null`: not now).
 */
export function useCommandKeyClaim(run: (() => void) | null) {
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  const active = run !== null;
  useEffect(() => {
    if (!active) return;
    const claim = { current: () => latest.current?.() };
    claims.push(claim);
    return () => {
      claims.splice(claims.indexOf(claim), 1);
    };
  }, [active]);
}

/** Who takes ⌘K instead of the panel, the latest claim first. */
export const commandKeyClaim = (): (() => void) | null => claims.at(-1)?.current ?? null;
