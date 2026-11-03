import type { VoiceSegmentResult } from '@slider/shared';

/** What the live stream heard, and where in it each piece of speech ended (`seq` → length). */
export interface LiveCaption {
  text: string;
  marks: Readonly<Record<number, number>>;
}

/**
 * The caption while speaking: word for word from the live stream, each piece replaced by the
 * accurate text speech to text made of it once that is there (after its pause). The pieces are
 * replaced in order – one still being heard keeps the live words from its start on; one that
 * failed keeps its live words. Pieces older than the segments the session still shows keep theirs.
 */
export function liveCaption(live: LiveCaption, segments: readonly VoiceSegmentResult[]): string {
  const settled = new Map<number, { text: string | null }>();
  for (const segment of segments) {
    if (!segment.heard) continue;
    const last = Math.max(...segment.seqs);
    for (const seq of segment.seqs) {
      // Heard together: the group's text stands at its last piece, the others give none.
      const text = segment.status === 'failed' ? null : seq === last ? segment.text.trim() : '';
      settled.set(seq, { text });
    }
  }
  const oldest = Math.min(...segments.flatMap((segment) => segment.seqs));
  const parts: string[] = [];
  let from = 0;
  for (const seq of Object.keys(live.marks)
    .map(Number)
    .sort((a, b) => a - b)) {
    const entry = settled.get(seq);
    if (!entry && seq >= oldest) break;
    const to = wordEnd(live.text, Math.max(from, live.marks[seq]!));
    parts.push(entry && entry.text !== null ? entry.text : live.text.slice(from, to).trim());
    from = to;
  }
  parts.push(live.text.slice(from).trim());
  return parts.filter(Boolean).join(' ');
}

/** A mark inside a word (its rest came after the pause was heard) moves to the word's end. */
/**
 * What the live stream heard of piece `seq`: its words from where the piece before ended to its
 * own mark – what the router decides on before the piece's accurate text is there.
 */
export function pieceWords(text: string, marks: Readonly<Record<number, number>>, seq: number) {
  const end = marks[seq];
  if (end === undefined) return '';
  const before = Object.keys(marks)
    .map(Number)
    .filter((each) => each < seq)
    .sort((a, b) => b - a)[0];
  const from = before === undefined ? 0 : wordEnd(text, marks[before]!);
  return text.slice(from, wordEnd(text, Math.max(from, end))).trim();
}

function wordEnd(text: string, at: number): number {
  let index = Math.min(at, text.length);
  while (
    index > 0 &&
    index < text.length &&
    !/\s/.test(text[index - 1]!) &&
    !/\s/.test(text[index]!)
  ) {
    index += 1;
  }
  return index;
}
