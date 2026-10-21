import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { TextField } from './TextField';

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

  it('describes itself with the description, so it is read out with the title', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Konto löschen?" description="Gib deine Adresse ein.">
        <input aria-label="Adresse" />
      </Dialog>,
    );
    const describedBy = screen
      .getByRole('dialog', { hidden: true })
      .getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)?.textContent).toBe('Gib deine Adresse ein.');
  });

  it('gives the focus to an autoFocus field, not to the close button', () => {
    // As in browsers: opening runs the dialog focusing steps – the first focusable element (the
    // header's close button) – after React's autoFocus already ran on the closed dialog.
    const showModal = vi
      .spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
        this.querySelector<HTMLElement>('button')?.focus();
      });
    render(
      <Dialog open onClose={vi.fn()} title="Neuer Ordner">
        <TextField aria-label="Name des Ordners" autoFocus />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Name des Ordners'));
    showModal.mockRestore();
  });
});
