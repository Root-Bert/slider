import type { Comment } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../comments/lib/comment-selectors';
import { ViewerDispatchContext } from '../state/viewer-state';
import { GapDivider } from './GapDivider';

const thread = (id: string, status: Comment['status']) =>
  ({
    id,
    root: { id, status, author: { id: 'a1', name: 'Anna', color: 'red' } },
    replies: [],
    repliers: [],
    participants: [],
  }) as unknown as Thread;

function renderGap(props: Partial<ComponentProps<typeof GapDivider>> = {}) {
  const dispatch = vi.fn();
  render(
    <ViewerDispatchContext.Provider value={dispatch}>
      <GapDivider
        gapKey="s1:s2"
        x={100}
        top={0}
        width={40}
        height={200}
        afterSlideId="s1"
        beforeSlideId="s2"
        threads={undefined}
        isDrafting={false}
        canComment
        {...props}
      />
    </ViewerDispatchContext.Provider>,
  );
  return dispatch;
}

const addButton = () =>
  screen.queryByRole('button', { name: 'Kommentar zwischen den Folien – hier fehlt etwas' });

describe('GapDivider', () => {
  it('starts a "slide missing" comment from its ⊕', async () => {
    const dispatch = renderGap();
    const add = addButton()!;
    expect(add.getAttribute('title')).toBe('Hier fehlt eine Folie');
    // Hidden until the gap is hovered or focused.
    expect(add.className).toContain('opacity-0');
    await userEvent.click(add);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'gapDraftStarted',
      afterSlideId: 's1',
      beforeSlideId: 's2',
    });
  });

  it('always shows the ⊕ and its gap in the hairline on touch screens (no hover there)', () => {
    renderGap();
    expect(addButton()!.className).toContain('pointer-coarse:opacity-100');
    const hairline = document.querySelector('[data-gap-key] > span[aria-hidden]')!;
    expect(hairline.className).toContain('pointer-coarse:[mask-image:');
  });

  it('keeps the ⊕ shown while drafting there', () => {
    renderGap({ isDrafting: true });
    expect(addButton()!.className).toContain('opacity-100');
  });

  it('has no ⊕ for viewers who may not comment', () => {
    renderGap({ canComment: false });
    expect(addButton()).toBeNull();
  });

  it('counts the gap comments and opens the first one', async () => {
    const dispatch = renderGap({ threads: [thread('t1', 'open'), thread('t2', 'done')] });
    const marker = screen.getByRole('button', { name: '2 Kommentare zwischen den Folien' });
    expect(marker.textContent).toBe('2');
    // The connector line starts here.
    expect(marker.hasAttribute('data-gap-marker')).toBe(true);
    expect(marker.getAttribute('data-hover-thread')).toBe('t1');
    expect(marker.style.opacity).toBe('1');
    await userEvent.click(marker);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'threadFocused',
      threadId: 't1',
      openPanel: true,
    });
  });

  it('dims the count once every gap comment is resolved', () => {
    renderGap({ threads: [thread('t1', 'done')] });
    const marker = screen.getByRole('button', { name: '1 Kommentar zwischen den Folien' });
    expect(marker.style.opacity).toBe('0.5');
  });
});
