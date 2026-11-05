import { describe, expect, it } from 'vitest';
import type { Slide } from '@slider/shared';
import { audienceUrl } from './audience-window';
import { presenterRoom } from './presenter-room';
import { recordingFileName } from './show-recorder';
import { parseShowRun, showRunOf } from './show-runs';
import {
  BOX_FADE_MS,
  boxOpacity,
  DEFAULT_BOX_STAY,
  parseBoxStay,
  showSummaryRows,
  slideDurations,
} from './show-times';
import { presentationKey } from './presentation';
import {
  atIndex,
  atMessage,
  formatElapsed,
  parseShowMessage,
  stopwatchElapsed,
  stopwatchReset,
  stopwatchStarted,
  stopwatchToggled,
} from './show-sync';

const slides = ['a', 'b', 'c'].map((id) => ({ id }) as Slide);

describe('presenter view and audience window', () => {
  it('meet on the same step, time the talk and open the audience on the slide shown', () => {
    // A step there is the same step here – by slide, the end screen too; others' slides ignored.
    const at = atMessage(slides, 1, true);
    expect(at).toEqual({ type: 'at', slideId: 'b', ended: false, black: true });
    expect(atIndex(slides, at as Extract<typeof at, { type: 'at' }>)).toBe(1);
    const end = atMessage(slides, 3, false);
    expect(end).toEqual({ type: 'at', slideId: null, ended: true, black: false });
    expect(atIndex(slides, end as Extract<typeof end, { type: 'at' }>)).toBe(3);
    expect(atIndex(slides, { type: 'at', slideId: 'x', ended: false, black: false })).toBeNull();

    // Only the show's own messages are heard.
    expect(parseShowMessage(JSON.parse(JSON.stringify(at)))).toEqual(at);
    expect(parseShowMessage({ type: 'hello' })).toEqual({ type: 'hello' });
    expect(parseShowMessage({ type: 'gone' })).toEqual({ type: 'gone' });
    expect(parseShowMessage({ type: 'end', extra: 1 })).toEqual({ type: 'end' });
    expect(parseShowMessage({ type: 'at', slideId: 3, ended: false, black: false })).toBeNull();
    expect(parseShowMessage('slider-show:fullscreen')).toBeNull();
    expect(parseShowMessage(null)).toBeNull();
    // Boxes drawn while presenting: shares of the slide, checked.
    const box = { id: 'k', slideId: 'b', x: 0.1, y: 0.2, w: 0.3, h: 0.4, until: 5_000 };
    expect(parseShowMessage({ type: 'box', box })).toEqual({ type: 'box', box });
    expect(parseShowMessage({ type: 'box', box: { ...box, w: 2 } })).toBeNull();
    expect(parseShowMessage({ type: 'clear' })).toEqual({ type: 'clear' });
    // They stay, fade over their last moments, then are gone; „until the next slide“: stay.
    expect(boxOpacity(box, 1_000)).toBe(1);
    expect(boxOpacity(box, 5_000 - BOX_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(boxOpacity(box, 6_000)).toBe(0);
    expect(boxOpacity({ ...box, until: null }, 1e12)).toBe(1);
    expect(parseBoxStay(30)).toBe(30);
    expect(parseBoxStay('slide')).toBe('slide');
    expect(parseBoxStay(2)).toBe(2);
    expect(parseBoxStay(7)).toBe(DEFAULT_BOX_STAY);
    expect(DEFAULT_BOX_STAY).toBe(5);

    // The stopwatch: runs from the start, pauses where it stands, resets keeping its state.
    let watch = stopwatchStarted(1_000);
    expect(stopwatchElapsed(watch, 6_000)).toBe(5_000);
    watch = stopwatchToggled(watch, 6_000);
    expect(stopwatchElapsed(watch, 60_000)).toBe(5_000);
    watch = stopwatchToggled(watch, 60_000);
    expect(stopwatchElapsed(watch, 62_000)).toBe(7_000);
    expect(stopwatchElapsed(stopwatchReset(watch, 62_000), 63_000)).toBe(1_000);
    expect(stopwatchReset(stopwatchToggled(watch, 62_000), 70_000)).toEqual({
      gathered: 0,
      since: null,
    });
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(245_900)).toBe('4:05');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');

    // Each slide's time: summed over its visits, only stopwatch time, the end screen not counted.
    const marks = [
      { slideId: 'a', at: 0 },
      { slideId: 'b', at: 4_000 },
      { slideId: 'a', at: 9_000 },
      { slideId: null, at: 10_000 },
    ];
    expect([...slideDurations(marks, 12_000)]).toEqual([
      ['a', 5_000],
      ['b', 5_000],
    ]);
    expect(
      showSummaryRows(slides, marks.slice(0, 2), 6_000).map(({ number, ms, skipped }) => [
        number,
        ms,
        skipped,
      ]),
    ).toEqual([
      [1, 4_000, false],
      [2, 2_000, false],
      [3, 0, true],
    ]);
    // The last run kept per deck: the rows the menu's „Letzter Durchgang“ shows, checked back.
    const run = showRunOf(
      slides.map((slide, i) => ({
        ...slide,
        title: i === 0 ? 'Start' : null,
        thumbnailUrl: `/t/${slide.id}`,
        aspectRatio: 16 / 9,
      })),
      marks.slice(0, 2),
      6_000,
      new Date('2026-11-04T10:00:00Z'),
    );
    expect(run.rows.map((row) => [row.title, row.ms, row.skipped])).toEqual([
      ['Start', 4_000, false],
      [null, 2_000, false],
      [null, 0, true],
    ]);
    expect(parseShowRun(JSON.stringify(run))).toEqual(run);
    expect(parseShowRun(JSON.stringify({ ...run, rows: [{ slideId: 'a' }] }))).toBeNull();
    expect(parseShowRun('{')).toBeNull();
    expect(recordingFileName('Q4: Plan/2026', 'video/mp4;codecs=avc1')).toBe(
      'Q4 Plan 2026 Aufnahme.mp4',
    );
    expect(recordingFileName('', 'video/webm')).toBe('Präsentation Aufnahme.webm');

    // The audience's window: the deck's address, as the audience, on the slide shown.
    const url = new URL(audienceUrl('https://slider.test/d/deck1?slide=a&x=1', 'b'));
    expect(url.pathname).toBe('/d/deck1');
    expect(url.searchParams.get('present')).toBe('audience');
    expect(url.searchParams.get('slide')).toBe('b');
    expect(url.searchParams.get('x')).toBe('1');
    expect(new URL(audienceUrl('https://slider.test/d/deck1?slide=a', null)).search).toBe(
      '?present=audience',
    );

    // The presenter view's room: a wide one puts the notes beside the slide, a taller one under
    // the slides; never wider than two thirds, never taller than the room.
    expect(presenterRoom(1952, 1210, 16 / 9).kind).toBe('below');
    const wide = presenterRoom(1900, 700, 16 / 9);
    expect(wide.kind).toBe('side');
    expect(wide.current).toBeLessThanOrEqual(((700 - 40) * 16) / 9);
    expect(presenterRoom(700, 900, 16 / 9).kind).toBe('narrow');

    // The presenter view steps with the slide show's keys.
    expect(presentationKey('ArrowRight')).toEqual({ type: 'next' });
    expect(presentationKey(' ')).toEqual({ type: 'next' });
    expect(presentationKey('ArrowLeft')).toEqual({ type: 'previous' });
    expect(presentationKey('Escape')).toEqual({ type: 'exit' });
  });
});
