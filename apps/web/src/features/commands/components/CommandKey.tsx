import { useEffect, useRef, useState } from 'react';
import { useMe } from '@/lib/api';
import { isModKey } from '@/lib/keyboard';
import { commandKeyClaim } from '../lib/registry';
import type { CommandPanel } from './CommandPanel';

type Panel = typeof CommandPanel;

/*
 * The panel's own chunk, kept once loaded – not `React.lazy`, which waits a tick on its first
 * render even when the chunk is there: the field would come after the first letters typed.
 */
let loadedPanel: Panel | null = null;
const loadPanel = () =>
  import('./CommandPanel').then((module) => (loadedPanel = module.CommandPanel));

/** ⌘K / Strg K – not with ⇧ or ⌥, which other keys take. */
const isCommandKey = (event: KeyboardEvent) =>
  event.key.toLowerCase() === 'k' && isModKey(event) && !event.altKey && !event.shiftKey;

/**
 * ⌘K opens the command panel on every page of a signed-in account, and closes it again. Where
 * ⌘K means something else for now (`useCommandKeyClaim`) that runs instead; over another dialog
 * nothing opens – a question there is answered first. Presenting, ⌘K does nothing (the show
 * claims it).
 */
export function CommandKey() {
  const signedIn = Boolean(useMe().data?.user);
  const [open, setOpen] = useState(false);
  // What the keys see at once: a second ⌘K right after the first comes before the render and
  // would toggle from what was – closed and opened again, it stayed closed.
  const shown = useRef(false);
  const show = (next: boolean) => {
    shown.current = next;
    setOpen(next);
  };
  const [Panel, setPanel] = useState<Panel | null>(() => loadedPanel);

  useEffect(() => {
    if (!signedIn) return;
    // Loaded while nothing else happens, so the first ⌘K opens at once.
    const idle =
      window.requestIdleCallback?.(() => void loadPanel().then((panel) => setPanel(() => panel))) ??
      null;
    return () => {
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isCommandKey(event)) return;
      const claim = commandKeyClaim();
      if (claim) {
        event.preventDefault();
        claim();
        return;
      }
      // Its own dialog does not count: closed by ⌘K, it is still open until the effect has run.
      if (!shown.current && document.querySelector('dialog[open]:not([aria-label="Befehle"])'))
        return;
      event.preventDefault();
      if (!Panel) void loadPanel().then((panel) => setPanel(() => panel));
      show(!shown.current);
    };
    // Capture on the window: before any field, also one that keeps every key to itself (a chat's,
    // a sticker's) – ⌘K works in every state.
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [signedIn, Panel]);

  if (!signedIn || !Panel) return null;
  return <Panel open={open} onClose={() => show(false)} />;
}
