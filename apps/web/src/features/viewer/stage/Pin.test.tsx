import type { Comment } from '@slider/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pin } from './Pin';

const comment = (overrides: Partial<Comment> = {}) =>
  ({
    id: 'c1',
    body: 'Logo größer',
    source: 'app',
    sourceStatus: null,
    author: { id: 'a1', name: 'Anna Berg', color: 'blue' },
    ...overrides,
  }) as Comment;

const at = { x: 0.25, y: 0.5 };

describe('Pin', () => {
  it('is a button named after the comment that activates it without reaching the slide', async () => {
    const onActivate = vi.fn();
    const onSlideClick = vi.fn();
    render(
      <div onClick={onSlideClick}>
        <Pin comment={comment()} at={at} state="normal" onActivate={onActivate} />
      </div>,
    );
    const pin = screen.getByRole('button', { name: 'Kommentar von Anna Berg: Logo größer' });
    expect(pin.getAttribute('data-mark')).toBe('pin');
    expect(pin.getAttribute('title')).toBe('Kommentar von Anna Berg: Logo größer');
    expect(pin.style.left).toBe('25%');
    expect(pin.style.top).toBe('50%');
    await userEvent.click(pin);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onSlideClick).not.toHaveBeenCalled();
  });

  it('opens its own menu on a right click', () => {
    const onContextMenu = vi.fn();
    render(
      <Pin
        comment={comment()}
        at={at}
        state="normal"
        onActivate={() => {}}
        onContextMenu={onContextMenu}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button'));
    expect(onContextMenu).toHaveBeenCalledOnce();
  });

  it('lifts an emphasised pin above the rest and fades a dimmed one', () => {
    const { rerender } = render(
      <Pin comment={comment()} at={at} state="emphasized" onActivate={() => {}} />,
    );
    const pin = screen.getByRole('button');
    expect(pin.className).toContain('z-(--z-raised)');
    expect(pin.className).toContain('scale-125');
    rerender(<Pin comment={comment()} at={at} state="dimmed" onActivate={() => {}} />);
    expect(pin.className).toContain('opacity-30');
    expect(pin.className).toContain('z-1');
  });

  it('says when the comment was removed in PowerPoint and quietens it', () => {
    render(
      <Pin
        comment={comment({ source: 'pptx', sourceStatus: 'removed_in_pptx' })}
        at={at}
        state="normal"
        onActivate={() => {}}
      />,
    );
    const pin = screen.getByRole('button', {
      name: 'Kommentar von Anna Berg: Logo größer (in PowerPoint entfernt)',
    });
    expect(pin.className).toContain('grayscale');
  });

  it('marks comments imported from PowerPoint with a decorative "P"', () => {
    const { rerender } = render(
      <Pin comment={comment()} at={at} state="normal" onActivate={() => {}} />,
    );
    expect(screen.queryByText('P')).toBeNull();
    rerender(
      <Pin comment={comment({ source: 'pptx' })} at={at} state="normal" onActivate={() => {}} />,
    );
    const badge = screen.getByText('P');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.className).toContain('bg-powerpoint');
  });

  it('tells that one’s own pin can be dragged', () => {
    render(
      <Pin
        comment={comment()}
        at={at}
        state="normal"
        onActivate={() => {}}
        drag={{
          clamp: (dx, dy) => ({ dx, dy }),
          onPreview: () => {},
          onDrop: (_s, done) => done(),
        }}
      />,
    );
    const pin = screen.getByRole('button');
    expect(pin.getAttribute('title')).toBe(
      'Kommentar von Anna Berg: Logo größer – ziehen zum Verschieben',
    );
    expect(pin.className).toContain('cursor-move');
  });
});
