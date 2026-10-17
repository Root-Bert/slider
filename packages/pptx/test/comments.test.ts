import { describe, expect, it } from 'vitest';
import { EMU_PER_LEGACY_POSITION_UNIT } from '../src/comments/legacy';
import { readModernComments } from '../src/comments/modern';
import { parseXml } from '../src/xml';
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
        author: { name: 'Jonas Weber', initials: 'JW', userId: 'Jonas Weber', providerId: 'None' },
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

  it('drops NUL and other XML-illegal controls from titles and comments', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          title: 'Agen\u0000da\u0001',
          comments: [{ author: 'Le\u0000na', text: 'Bitte\u0000 prüfen\u001F' }],
        },
      ],
    });

    expect(presentation.slides[0]?.title).toBe('Agenda');
    expect(presentation.comments[0]).toMatchObject({
      author: { name: 'Lena' },
      text: 'Bitte prüfen',
    });
    expect(JSON.stringify(presentation)).not.toMatch(/\\u000|\\u001/);
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

describe('legacy reply threads (p15:threadingInfo)', () => {
  it('puts replies under their root comment, in order', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          title: 'Agenda',
          legacyComments: [
            { author: 'Lena', text: 'Frage?', position: { x: 10, y: 10 } },
            { author: 'Jonas', text: 'Antwort', position: { x: 10, y: 10 }, replyTo: 0 },
            { author: 'Lena', text: 'Danke', position: { x: 10, y: 10 }, replyTo: 1 },
            { author: 'Mira', text: 'Eigenes Thema', position: { x: 90, y: 90 } },
          ],
        },
      ],
    });
    expect(presentation.comments.map((c) => [c.text, c.replies.map((r) => r.text)])).toEqual([
      ['Frage?', ['Antwort', 'Danke']],
      ['Eigenes Thema', []],
    ]);
    const reply = defined(defined(presentation.comments[0]).replies[0]);
    expect(reply.author.name).toBe('Jonas');
    expect(reply.externalId).toMatch(/^\d+:\d+$/);
  });
});

describe('modern comments on shape groups', () => {
  const comment = (monikers: string) =>
    parseXml(
      '<p188:cmLst xmlns:p188="x" xmlns:ac="y"><p188:cm id="{C1}" authorId="{A}" created="2026-01-01T00:00:00Z">' +
        `<ac:deMkLst><pc:docMk/><pc:sldMk cId="1" sldId="256"/>${monikers}</ac:deMkLst>` +
        '<p188:txBody><a:p><a:r><a:t>Hm</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>',
    );
  const groups = new Map([['7', { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]]);
  const read = (monikers: string) =>
    readModernComments(
      comment(monikers),
      { sldId: 256, size: SLIDE_SIZE_16_9, groups },
      new Map(),
    )[0]?.anchor;

  it('anchors a comment on a group to the group box', () => {
    expect(read('<ac:grpSpMk id="7" creationId="{G}"/>')).toEqual({
      type: 'rect',
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      shapeId: '7',
    });
  });

  it('prefers the shape inside the group over the enclosing group', () => {
    expect(read('<ac:grpSpMk id="7"/><ac:spMk id="9"/>')).toEqual({ type: 'shape', shapeId: '9' });
  });

  it('computes group boxes from the children when parsing a deck', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          title: 'Gruppe',
          shapes: [
            {
              type: 'group',
              id: 20,
              box: { x: 1_000_000, y: 1_000_000, w: 2_000_000, h: 2_000_000 },
              childBox: { x: 0, y: 0, w: 2_000_000, h: 2_000_000 },
              shapes: [
                { type: 'rect', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 } },
                { type: 'rect', box: { x: 1_000_000, y: 1_000_000, w: 1_000_000, h: 1_000_000 } },
              ],
            },
          ],
        },
      ],
    });
    const slide = defined(presentation.slides[0]);
    const group = defined(slide.groups.find((g) => g.id === '20'));
    expect(group.bbox.x).toBeCloseTo(1_000_000 / SLIDE_SIZE_16_9.cx);
    expect(group.bbox.w).toBeCloseTo(2_000_000 / SLIDE_SIZE_16_9.cx);
    expect(group.bbox.h).toBeCloseTo(2_000_000 / SLIDE_SIZE_16_9.cy);
  });
});
