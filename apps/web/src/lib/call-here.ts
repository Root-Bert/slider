import { useEffect } from 'react';
import { MAX_CALL_HERE } from '@slider/shared';

/**
 * What the person has in front of them, told to the agent with each turn they speak in a call
 * (`call-client` reads it as the turn goes out): the app and its pages set lines under a key
 * (`useCallHere`) – the file or folder, the slide, what is picked, marked or being written. Kept
 * outside React, as `CallProvider` stands above the router. Only the agent hears it, never the
 * call's notes.
 *
 * The call lives in one window, the person may work in another (installed: Cloud's window while
 * the call went on in Slider's): the window last focused tells its lines to the others, and a
 * window without the focus tells those.
 */
const parts = new Map<string, string>();

/** Another window's lines, while it was the one last focused. */
interface Elsewhere {
  from: string;
  lines: string;
  at: number;
}

const CHANNEL = 'slider-call-here';
const self = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
let focused = false;
let focusedAt = 0;
let elsewhere: Elsewhere | null = null;

/** This window's own lines, the parts by key – a page's (`slider`) before its parts'. */
const own = () =>
  [...parts.keys()]
    .sort()
    .map((key) => parts.get(key))
    .join('\n')
    .slice(0, MAX_CALL_HERE);

function tell(message: { lines: string; at: number } | { gone: true }) {
  channel?.postMessage({ from: self, ...message });
}

const toldFocus = () => {
  if (focused) tell({ lines: own(), at: focusedAt });
};

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (typeof data !== 'object' || data === null) return;
    const { from, lines, at, gone } = data as Partial<Elsewhere> & { gone?: true };
    if (typeof from !== 'string') return;
    if (gone) {
      if (elsewhere?.from === from) elsewhere = null;
    } else if (typeof lines === 'string' && typeof at === 'number') {
      elsewhere = { from, lines: lines.slice(0, MAX_CALL_HERE), at };
    }
  };
  focused = document.hasFocus();
  focusedAt = focused ? Date.now() : 0;
  window.addEventListener('focus', () => {
    focused = true;
    focusedAt = Date.now();
    toldFocus();
  });
  window.addEventListener('blur', () => {
    focused = false;
  });
  window.addEventListener('pagehide', () => tell({ gone: true }));
}

export function setCallHere(key: string, lines: string | null): void {
  if (lines) parts.set(key, lines);
  else parts.delete(key);
  toldFocus();
}

/** What the person has in front of them: this window's lines – or, focused since, another's. */
export function callHere(): string {
  if (!focused && elsewhere && elsewhere.at > focusedAt) return elsewhere.lines;
  return own();
}

/** Sets this part while mounted and its lines stand; `null`/empty: nothing to tell. */
export function useCallHere(key: string, lines: string | null): void {
  useEffect(() => {
    if (!lines) return;
    setCallHere(key, lines);
    return () => setCallHere(key, null);
  }, [key, lines]);
}

/** A thing an agent sent off can open by its id – as the Cloud agents link (`[[kind:ID|Name]]`). */
export const hereLink = (
  kind: 'presentation' | 'file' | 'folder' | 'area' | 'conversation',
  id: string,
  name: string,
) => `[[${kind}:${id}|${name.replace(/[[\]|\n]/g, ' ').trim()}]]`;

/** Text in quotes, on one line, cut to `max` characters. */
export function hereQuote(text: string, max = 300): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return `„${line.length > max ? `${line.slice(0, max - 1)}…` : line}“`;
}
