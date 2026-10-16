import type { Comment } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResolveButton } from './ResolveButton';

const update = { mutate: vi.fn(), isError: false };
vi.mock('@/lib/api', () => ({ useUpdateComment: () => update }));

const comment = (status: Comment['status']) => ({ id: 'c1', status }) as Comment;

beforeEach(() => {
  update.mutate.mockClear();
  update.isError = false;
});

describe('ResolveButton', () => {
  it('marks an open thread as done without reaching the card behind it', async () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <ResolveButton comment={comment('open')} deckId="deck-1" />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Als erledigt markieren' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toBe('');
    await userEvent.click(button);
    expect(update.mutate).toHaveBeenCalledWith({ commentId: 'c1', status: 'done' });
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('reopens a done thread and shows it pressed in the success colour', async () => {
    render(<ResolveButton comment={comment('done')} deckId="deck-1" />);
    const button = screen.getByRole('button', { name: 'Wieder öffnen' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe('Erledigt – klicken zum Wiederöffnen');
    expect(button.className).toContain('text-success');
    await userEvent.click(button);
    expect(update.mutate).toHaveBeenCalledWith({ commentId: 'c1', status: 'open' });
  });

  it('shows the label in the chip variant', () => {
    const { rerender } = render(
      <ResolveButton comment={comment('open')} deckId="deck-1" variant="chip" />,
    );
    expect(screen.getByRole('button', { name: 'Als erledigt markieren' }).textContent).toBe(
      'Erledigen',
    );
    rerender(<ResolveButton comment={comment('done')} deckId="deck-1" variant="chip" />);
    const done = screen.getByRole('button', { name: 'Wieder öffnen' });
    expect(done.textContent).toBe('Erledigt');
    expect(done.className).toContain('bg-success/10');
  });

  it('reports a failed save', () => {
    update.isError = true;
    render(<ResolveButton comment={comment('open')} deckId="deck-1" />);
    expect(screen.getByRole('alert').textContent).toBe('Nicht gespeichert');
  });
});
