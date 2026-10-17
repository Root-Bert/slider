import type { Author, Deck, Viewer } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { author, comment, slide } from '../lib/test-fixtures';
import { deriveViewerData, nearestShownSlideId, withoutHiddenSlides } from './viewer-data';

const me = author('me', { name: 'Ich Selbst', color: 'green' });
const viewer = { kind: 'owner', author: me } as Viewer;
const owner = author('owner', { name: 'Olga Owner', color: 'red' });
const ben = author('ben', { name: 'Ben Ott', color: 'blue' });

const deck = (participants: Author[] = [ben]) =>
  ({
    id: 'd1',
    owner,
    participants,
    permissions: { canManage: true, canComment: true },
  }) as unknown as Deck;

const slides = [slide('s3', 2), slide('s1', 0), slide('s2', 1, { hidden: true })];

describe('deriveViewerData', () => {
  it('sorts slides, indexes them and counts the hidden ones', () => {
    const data = deriveViewerData(deck(), slides, [], viewer);
    expect(data.slides.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(data.slideIndex.get('s3')).toBe(2);
    expect(data.hiddenSlideCount).toBe(1);
    expect(data.canManage).toBe(true);
    expect(data.canComment).toBe(true);
  });

  it('builds threads and looks them up by id and slide', () => {
    const root = comment({ slideId: 's1', author: ben });
    const reply = comment({ slideId: 's1', parentId: root.id, author: owner });
    const data = deriveViewerData(deck(), slides, [root, reply], viewer);
    expect(data.threads).toHaveLength(1);
    expect(data.threadById.get(root.id)?.replies).toEqual([reply]);
    expect(data.threadsBySlide.get('s1')?.map((thread) => thread.id)).toEqual([root.id]);
  });

  it('recolours others but never the viewer', () => {
    const own = comment({ author: me });
    const theirs = comment({ author: ben });
    const data = deriveViewerData(
      deck([ben, me]),
      slides,
      [own, theirs],
      viewer,
      {
        me: 'violet',
        ben: 'yellow',
        owner: 'cyan',
        member: 'red',
      },
      [author('member', { name: 'Mia Member', color: 'blue' })],
    );
    expect(data.deck.owner.color).toBe('cyan');
    expect(data.deck.participants.map((p) => p.color)).toEqual(['yellow', 'green']);
    expect(data.threads.map((t) => t.root.author.color)).toEqual(['green', 'yellow']);
    expect(data.mentionable.find((p) => p.id === 'member')?.color).toBe('red');
  });

  it('keeps the deck untouched without overrides', () => {
    const raw = deck();
    expect(deriveViewerData(raw, slides, [], viewer).deck).toBe(raw);
    expect(deriveViewerData(raw, slides, [], viewer, { me: 'red' }).deck).toBe(raw);
  });

  it('suggests everyone but the viewer, without doubling PowerPoint authors', () => {
    const pptx = author('pptx:ben ott', { name: 'Ben Ott', type: 'external' });
    const data = deriveViewerData(deck([]), slides, [comment({ author: pptx })], viewer, {}, [
      me,
      ben,
      author('mia', { name: 'Mia' }),
    ]);
    expect(data.mentionable.map((p) => p.id)).toEqual(['owner', 'pptx:ben ott', 'mia']);
    expect(data.participantNames).toContain('Ich Selbst');
  });

  it('collects threads where someone else mentions the viewer', () => {
    const mentioned = comment({ author: ben, body: 'Frage an @Ich Selbst' });
    const self = comment({ author: me, body: '@Ich Selbst notiert' });
    const plain = comment({ author: ben, body: 'Nichts' });
    const data = deriveViewerData(deck([ben, me]), slides, [mentioned, self, plain], viewer);
    expect([...data.mentionedThreadIds]).toEqual([mentioned.id]);
  });
});

describe('withoutHiddenSlides', () => {
  it('is the same data without hidden slides', () => {
    const data = deriveViewerData(deck(), [slide('s1', 0)], [], viewer);
    expect(withoutHiddenSlides(data)).toBe(data);
  });

  it('keeps a deck with nothing but hidden slides', () => {
    const data = deriveViewerData(deck(), [slide('s1', 0, { hidden: true })], [], viewer);
    expect(withoutHiddenSlides(data)).toBe(data);
  });

  it('drops hidden slides and re-indexes the rest', () => {
    const shown = withoutHiddenSlides(deriveViewerData(deck(), slides, [], viewer));
    expect(shown.slides.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(shown.slideIndex.get('s3')).toBe(1);
    expect(shown.slideIndex.has('s2')).toBe(false);
  });

  it('moves a gap comment next to a hidden slide to the gap that is shown instead', () => {
    // Written between s1 and the hidden s2 while hidden slides showed.
    const gap = comment({
      slideId: null,
      anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' },
    });
    const all = deriveViewerData(deck(), slides, [gap], viewer);
    expect(all.gapThreads.get('s1→s2')?.map((t) => t.id)).toEqual([gap.id]);
    const shown = withoutHiddenSlides(all);
    expect([...shown.gapThreads.keys()]).toEqual(['s1→s3']);
    expect(shown.threadsBySlide.get('s1')?.map((t) => t.id)).toEqual([gap.id]);
  });
});

describe('nearestShownSlideId', () => {
  const all = [slide('a', 0), slide('b', 1), slide('c', 2), slide('d', 3)];

  it('prefers the next shown slide, else the previous one', () => {
    expect(
      nearestShownSlideId(
        all,
        new Map([
          ['c', 0],
          ['a', 1],
        ]),
        'b',
      ),
    ).toBe('c');
    expect(nearestShownSlideId(all, new Map([['a', 0]]), 'c')).toBe('a');
    expect(nearestShownSlideId(all, new Map([['b', 0]]), 'b')).toBe('b');
  });

  it('is null for unknown slides or when nothing is shown', () => {
    expect(nearestShownSlideId(all, new Map([['a', 0]]), 'zz')).toBeNull();
    expect(nearestShownSlideId(all, new Map(), 'b')).toBeNull();
  });
});
