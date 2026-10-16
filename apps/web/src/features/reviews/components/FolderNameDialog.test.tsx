import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FolderNameDialog } from './FolderNameDialog';

beforeAll(() => {
  // happy-dom may lack the modal API; the behaviour under test doesn't depend on the top layer.
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
});

function setup(props: Partial<Parameters<typeof FolderNameDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <FolderNameDialog
      title="Neuer Ordner"
      submitLabel="Anlegen"
      pending={false}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  const field = screen.getByRole('textbox', { name: 'Name des Ordners', hidden: true });
  const confirm = screen.getByRole('button', { name: 'Anlegen', hidden: true });
  return { onSubmit, onClose, field: field as HTMLInputElement, confirm };
}

describe('FolderNameDialog', () => {
  it('starts focused and only allows a non-blank name', async () => {
    const { field, confirm } = setup();
    expect(document.activeElement).toBe(field);
    expect(field.maxLength).toBe(80);
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.type(field, '   ');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.type(field, 'Kunden');
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('the confirm button submits the form with the trimmed name', async () => {
    const { field, confirm, onSubmit } = setup();
    // The confirm button sits in the dialog footer, outside the form, tied to it by `form`.
    const form = field.closest('form')!;
    expect(confirm.getAttribute('type')).toBe('submit');
    expect(confirm.getAttribute('form')).toBe(form.id);
    await userEvent.type(field, '  Kunde Müller  ');
    await userEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Kunde Müller');
  });

  it('Enter in the field submits too', async () => {
    const { field, onSubmit } = setup({ initialName: 'Alt' });
    expect(field.value).toBe('Alt');
    await userEvent.clear(field);
    await userEvent.type(field, 'Neu{Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Neu');
  });

  it('does not submit while pending and shows the error', async () => {
    const { field, confirm, onSubmit } = setup({
      initialName: 'Kunden',
      pending: true,
      error: 'Gibt es schon',
    });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.type(field, '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Gibt es schon')).toBeTruthy();
  });

  it('"Abbrechen" closes without submitting', async () => {
    const { onClose, onSubmit } = setup({ initialName: 'Kunden' });
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen', hidden: true }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
