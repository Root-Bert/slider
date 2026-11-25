import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cloudExtension } from '@slider/shared';
import { saveShowExtensions, useMe } from '@/lib/api';
import { readString, writeString } from '@/lib/storage';

/** Where this browser kept the choice before the account did – taken over once, then gone. */
const BROWSER_KEY = 'slider.cloud.extensions';
let tookOver = false;

/**
 * „Dateiendungen zeigen“ (`/einstellungen` › Dateien, set by `useSetShowExtensions`): whether a
 * file's name shows its ending – kept with the account, so it follows to every device. Off by
 * default: „Bericht“, not „Bericht.pdf“ (as on a Mac – the symbol beside it tells what it is).
 */
export function useShowExtensions(): boolean {
  const user = useMe().data?.user;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (tookOver || !user) return;
    tookOver = true;
    const before = readString(BROWSER_KEY);
    writeString(BROWSER_KEY, null);
    if (before === 'true' && !user.showExtensions) {
      // Not saved: kept for the next start.
      saveShowExtensions(queryClient, true).catch(() => writeString(BROWSER_KEY, before));
    }
  }, [user, queryClient]);
  return user?.showExtensions ?? false;
}

/**
 * How many characters of a file's name are its ending („.pdf“) – 0 for a folder, or where what
 * follows the last dot is part of the name: „Notizen 12.11.2026“, „Angebot v1.2“, „Dr. Müller“.
 */
function endingLength(node: { name: string; kind: string }): number {
  if (node.kind !== 'file') return 0;
  const ending = cloudExtension(node.name);
  return /^(?=.*\p{L})[\p{L}\d]{1,5}$/u.test(ending) ? ending.length + 1 : 0;
}

/** A file's name as the lists show it – without its ending unless that is asked for; folders as they are. */
export function shownName(node: { name: string; kind: string }, extensions: boolean): string {
  return extensions ? node.name : node.name.slice(0, node.name.length - endingLength(node));
}

/** Characters kept at the end when a long name is cut in the middle. */
const TAIL = 8;

/** How much of the end stays: a whole word near {@link TAIL} („-10-folien“, not „0-folien“), else TAIL. */
function tailLength(base: string[]): number {
  let best: number | null = null;
  for (let keep = TAIL - 3; keep <= TAIL + 4; keep++) {
    const startsWord = /[\s._-]/.test(base[base.length - keep - 1] ?? '');
    if (startsWord && (best === null || Math.abs(keep - TAIL) < Math.abs(best - TAIL))) best = keep;
  }
  // The mark before the word goes with it: a space ending the part that gives way would vanish.
  return best === null ? TAIL : best + 1;
}

/**
 * A shown name split for a cut in the middle: `head` gives way (…), `tail` – its last few
 * characters and the ending, when shown – always stays. Short names are not split.
 */
export function nameParts(
  node: { name: string; kind: string },
  extensions: boolean,
): { head: string; tail: string } {
  const name = shownName(node, extensions);
  const ending = extensions ? endingLength(node) : 0;
  const base = Array.from(name.slice(0, name.length - ending));
  const keep = base.length > TAIL * 2 ? tailLength(base) : 0;
  return {
    head: base.slice(0, base.length - keep).join(''),
    tail: base.slice(base.length - keep).join('') + name.slice(name.length - ending),
  };
}
