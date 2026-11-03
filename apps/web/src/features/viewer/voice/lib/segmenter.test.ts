import { describe, expect, it } from 'vitest';
import { liveCaption, pieceWords } from './caption';
import { Segmenter, type SpeechPiece } from './segmenter';

/** 32 ms frames whose samples carry their number, so pieces can be read back. */
function feed(segmenter: Segmenter, probabilities: number[], from = 0) {
  probabilities.forEach((probability, index) => {
    const frame = new Float32Array(512).fill((from + index + 1) / 10_000);
    segmenter.push(frame, probability, (from + index + 1) * 32);
  });
  return from + probabilities.length;
}
const framesOf = (piece: SpeechPiece) =>
  Array.from({ length: piece.audio.length / 512 }, (_, i) =>
    Math.round(piece.audio[i * 512]! * 10_000),
  );

describe('Segmenter', () => {
  it("cuts speech at pauses with a pad before and a little silence after, drops clicks, and cuts a piece that runs too long at its quietest moment – and the caption swaps each piece's live words for its accurate text", () => {
    // The caption (lib/caption): live words, each piece replaced in order once heard.
    const live = {
      text: 'Den Titl hier bitte fett. Und die Quele fehlt. Nächste',
      marks: { 0: 21, 1: 46 }, // piece 0 ended inside „fett.“ (its rest came after)
    };
    const segment = (seq: number, text: string, heard = true, status = 'done' as const) => ({
      seq,
      text,
      status,
      error: null,
      seqs: [seq],
      heard,
    });
    expect(
      liveCaption(live, [segment(0, 'Den Titel hier bitte fett.'), segment(1, '', false)]),
    ).toBe('Den Titel hier bitte fett. Und die Quele fehlt. Nächste');
    expect(liveCaption(live, [segment(0, '', false), segment(1, 'Und die Quelle fehlt.')])).toBe(
      live.text,
    ); // piece 0 still being heard: nothing after it is swapped either
    expect(
      liveCaption(live, [
        { ...segment(0, 'Den Titel hier bitte fett. Und die Quelle fehlt.'), seqs: [0, 1] },
      ]),
    ).toBe('Den Titel hier bitte fett. Und die Quelle fehlt. Nächste'); // heard together
    // Each piece's live words – what the router decides on before its accurate text is there.
    expect(pieceWords(live.text, live.marks, 0)).toBe('Den Titl hier bitte fett.');
    expect(pieceWords(live.text, live.marks, 1)).toBe('Und die Quele fehlt.');
    expect(pieceWords(live.text, live.marks, 2)).toBe('');

    const pieces: SpeechPiece[] = [];
    const speaking: boolean[] = [];
    const segmenter = new Segmenter(
      (piece) => pieces.push(piece),
      (now) => speaking.push(now),
      { preSpeechPadMs: 64, postSpeechPadMs: 64, redemptionMs: 320, minSpeechMs: 96 },
    );
    // Silence, 20 frames of speech, a pause of 10 frames: one piece with 2 frames before, 2 after.
    let at = feed(segmenter, [
      0,
      0,
      0,
      0,
      ...Array<number>(20).fill(0.9),
      ...Array<number>(10).fill(0.05),
    ]);
    expect(pieces).toHaveLength(1);
    expect(framesOf(pieces[0]!)).toEqual(Array.from({ length: 24 }, (_, i) => i + 3));
    expect(pieces[0]!.startMs).toBe(64);
    expect(speaking).toEqual([true, false]);
    // A click (2 frames) is no piece.
    at = feed(segmenter, [0.9, 0.9, ...Array<number>(12).fill(0)], at);
    expect(pieces).toHaveLength(1);
    // A short dip under the threshold does not end it.
    feed(segmenter, [0.9, 0.9, 0.9, 0.1, 0.1, 0.9, 0.9, 0.9, ...Array<number>(10).fill(0)], at);
    expect(pieces).toHaveLength(2);
    // Speaking on and on: cut at the quietest frame, the rest goes on as the next piece.
    const long = new Segmenter((piece) => pieces.push(piece), undefined, { maxSegmentMs: 640 });
    const probabilities = Array<number>(30).fill(0.9);
    probabilities[15] = 0.4;
    feed(long, probabilities);
    long.flush();
    const [first, rest] = pieces.slice(2);
    expect(framesOf(first!).at(-1)).toBe(16);
    expect(framesOf(rest!)[0]).toBe(17);
  });
});
