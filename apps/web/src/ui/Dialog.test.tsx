import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function setup() {
  const onClose = vi.fn();
  render(
    <Dialog open onClose={onClose} title="Neuer Ordner" footer={<button>OK</button>}>
      <input aria-label="Name" />
    </Dialog>,
  );
  const dialog = screen.getByRole('dialog', { hidden: true });
  return { onClose, dialog, input: screen.getByLabelText('Name') };
}

describe('Dialog', () => {
  it('closes on a click on the backdrop', () => {
    const { onClose, dialog } = setup();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when a text selection is dragged from a field out onto the backdrop', () => {
    const { onClose, dialog, input } = setup();
    fireEvent.pointerDown(input);
    // The browser sends the click to the common ancestor: the <dialog> itself.
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets the footer buttons wrap on narrow screens', () => {
    setup();
    const footer = screen.getByRole('button', { name: 'OK', hidden: true }).parentElement!;
    expect(footer.className).toContain('flex-wrap');
  });
});
