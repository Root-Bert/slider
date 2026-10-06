import { describe, expect, it } from 'vitest';
import { EMU_PER_LEGACY_POSITION_UNIT } from '../src/comments/legacy';
import { SLIDE_SIZE_16_9 } from './fixtures/build-pptx';
import { defined, openDeck } from './helpers';

const { cx, cy } = SLIDE_SIZE_16_9;

describe('modern comments (BER-112)', () => {
  it('reads threads with replies, authors and status', async () => {
    const { presentation } = await openDeck({
      slides: [
        { title: 'Ohne Kommentare' },
        {
          title: 'Agenda',
          body: ['Punkt 1'],
          comments: [
            {
              author: 'Lena Hoffmann',
              text: 'Reihenfolge prüfen?',
              created: '2026-09-28T08:12:00.000Z',
              replies: [
                {
                  author: 'Jonas Weber',
                  text: 'Erledige ich.',
                  created: '2026-09-28T09:40:00.000Z',
                },
              ],
            },
            { author: 'Jonas Weber', text: 'Typo behoben', status: 'resolved' },
            { author: 'Jonas Weber', text: 'Alt', status: 'closed' },
          ],
        },
      ],
    });
    const [thread, resolved, closed] = presentation.comments;

    expect(presentation.comments).toHaveLength(3);
    expect(thread).toMatchObject({
      format: 'modern',
      sldId: 257,
      author: { name: 'Lena Hoffmann', initials: 'LH' },
      createdAt: '2026-09-28T08:12:00.000Z',
      text: 'Reihenfolge prüfen?',
      status: 'open',
      anchor: { type: 'slide' },
    });
    expect(thread?.externalId).toMatch(/^\{[0-9a-f-]{36}\}$/);
    expect(thread?.replies).toEqual([
      {
        externalId: expect.stringMatching(/^\{[0-9a-f-]{36}\}$/) as string,
        author: { name: 'Jonas Weber', initials: 'JW' },
        createdAt: '2026-09-28T09:40:00.000Z',
        text: 'Erledige ich.',
      },
    ]);
    expect(resolved?.status).toBe('done');
    expect(closed?.status).toBe('done');
    expect(new Set(presentation.comments.map((comment) => comment.externalId)).size).toBe(3);
  });

  it('anchors to a shape via its moniker, otherwise to the pin position', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          title: 'Anker',
          comments: [
            { author: 'A', text: 'Am Titel', shapeId: 2, position: { x: 100, y: 100 } },
            { author: 'A', text: 'Frei', position: { x: cx / 4, y: cy / 2 } },
            { author: 'A', text: 'Außerhalb', position: { x: cx * 2, y: -500 } },
          ],
        },
      ],
    });

    expect(presentation.comments.map((comment) => comment.anchor)).toEqual([
      { type: 'shape', shapeId: '2' },
      { type: 'point', point: { x: 0.25, y: 0.5 } },
      { type: 'point', point: { x: 1, y: 0 } },
    ]);
  });
});

describe('legacy comments (BER-113)', () => {
  it('converts legacy positions (1/576 inch) to normalised points', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          legacyComments: [
            { author: 'Markus Klein', text: 'Mitte', position: { x: 3840, y: 2160 } },
            { author: 'Markus Klein', text: 'Rand', position: { x: 99_999, y: 0 } },
          ],
        },
      ],
    });
    const [centre, edge] = presentation.comments;

    // 3840 units = 3840 / 576 in = 6.667 in = half of a 13.333 in wide slide
    expect(3840 * EMU_PER_LEGACY_POSITION_UNIT).toBe(cx / 2);
    expect(centre?.anchor).toEqual({ type: 'point', point: { x: 0.5, y: 0.5 } });
    expect(edge?.anchor).toEqual({ type: 'point', point: { x: 1, y: 0 } });
  });

  it('builds stable external ids from author and index, without status or replies', async () => {
    const { presentation } = await openDeck({
      slides: [
        { legacyComments: [{ author: 'Markus Klein', text: 'Eins', position: { x: 0, y: 0 } }] },
        {
          sldId: 400,
          legacyComments: [
            {
              author: 'Petra Lang',
              text: 'Zwei',
              created: '2026-03-01T12:00:00.000Z',
              position: { x: 0, y: 0 },
            },
            { author: 'Markus Klein', text: 'Drei', position: { x: 0, y: 0 } },
          ],
        },
      ],
    });

    expect(
      presentation.comments.map(({ externalId, sldId, author, text }) => ({
        externalId,
        sldId,
        author,
        text,
      })),
    ).toEqual([
      {
        externalId: '0:1',
        sldId: 256,
        author: { name: 'Markus Klein', initials: 'MK' },
        text: 'Eins',
      },
      {
        externalId: '1:1',
        sldId: 400,
        author: { name: 'Petra Lang', initials: 'PL' },
        text: 'Zwei',
      },
      {
        externalId: '0:2',
        sldId: 400,
        author: { name: 'Markus Klein', initials: 'MK' },
        text: 'Drei',
      },
    ]);
    const legacy = defined(presentation.comments[1]);
    expect(legacy).toMatchObject({ format: 'legacy', status: 'open', replies: [] });
    expect(legacy.createdAt).toBe('2026-03-01T12:00:00.000');
  });
});
