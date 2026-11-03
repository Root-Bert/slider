import type { EditSlide, Slide } from '@slider/shared';
import { expect, it } from 'vitest';
import { pendingSlideId, withPendingSlides, type PendingSlide } from './pending-slides';
import { withRemoteSlides, type RemoteSlideOp } from './remote-slides';

const slide = (id: string, position: number) =>
  ({ id, deckId: 'd', position, imageUrl: `${id}.webp`, aspectRatio: 16 / 9 }) as Slide;

it('shows a slide just put in at once after its slide, until the server’s slide is there', () => {
  const stand: PendingSlide = {
    deckId: 'd',
    newPageId: 'slnew1',
    afterSlideId: 'a',
    imageUrl: 'layout.webp',
    thumbnailUrl: 'layout-thumb.webp',
    aspectRatio: 16 / 9,
  };
  const before = [slide('a', 0), slide('b', 1)];

  // Sent, not answered: the stand-in with the tile's picture.
  const sent = withPendingSlides('d', before, undefined, [stand]);
  expect(sent.slides.map((item) => item.id)).toEqual(['a', pendingSlideId('slnew1'), 'b']);
  expect(sent.slides[1]).toMatchObject({ imageUrl: 'layout.webp', hidden: false, shapes: [] });
  expect(sent.settled).toEqual([]);
  // Another deck's stays out.
  expect(withPendingSlides('other', before, undefined, [stand]).slides).toBe(before);

  // Answered, the slides not reloaded yet: still the stand-in – no gap for a moment.
  const edit = [{ pageId: 'slnew1', slideId: 'real' }] as EditSlide[];
  expect(withPendingSlides('d', before, edit, [stand]).slides).toHaveLength(3);

  // The server's slide is there: it alone, the stand-in to be forgotten.
  const after = [slide('a', 0), slide('real', 1), slide('b', 2)];
  const done = withPendingSlides('d', after, edit, [stand]);
  expect(done.slides.map((item) => item.id)).toEqual(['a', 'real', 'b']);
  expect(done.settled).toEqual(['slnew1']);
  // Someone else's slide ops (`remote-slides`): shown at once, let go of once fetched.
  const pages = [
    { pageId: 'pa', slideId: 'a' },
    { pageId: 'pb', slideId: 'b' },
    { pageId: 'pc', slideId: 'c' },
  ] as EditSlide[];
  const three = [slide('a', 0), slide('b', 1), slide('c', 2)];
  const op = (seq: number, operation: RemoteSlideOp['operation']): RemoteSlideOp => ({
    deckId: 'd',
    seq,
    operation,
  });
  const ops = [
    op(5, { type: 'duplicateSlide', pageId: 'pa', newPageId: 'pcopy', after: 'pc' }),
    op(6, { type: 'moveSlide', pageId: 'pc', after: null }),
    op(7, { type: 'deleteSlide', pageId: 'pb' }),
  ];
  const remote = withRemoteSlides('d', three, pages, 4, ops);
  expect(remote.slides.map((item) => item.id)).toEqual(['c', 'a', pendingSlideId('pcopy')]);
  // The copy shows its source's picture until its own is there.
  expect(remote.slides[2]).toMatchObject({ imageUrl: 'a.webp' });
  expect(remote.settled).toEqual([]);
  // Fetched (edit state at the last step, the slides as the steps left them): all let go of.
  const fetched = [slide('c', 0), slide('a', 1), slide('copy', 2)];
  const withCopy = [...pages, { pageId: 'pcopy', slideId: 'copy' }] as EditSlide[];
  const caught = withRemoteSlides('d', fetched, withCopy, 7, ops);
  expect(caught.slides).toBe(fetched);
  expect(caught.settled).toEqual(ops);
});
