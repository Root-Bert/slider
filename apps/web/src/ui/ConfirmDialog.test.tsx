import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, Dialog } from '@/ui';

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

describe('Dialog', () => {
  it('is labelled by its title and closes via the close button', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Ordner umbenennen" description="Kurz und klar.">
        Inhalt
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Ordner umbenennen', hidden: true });
    expect(dialog.className).toContain('backdrop:bg-scrim');
    expect(screen.getByText('Kurz und klar.').className).toContain('text-body');
    await userEvent.click(screen.getByRole('button', { name: 'Schließen', hidden: true }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  const base = {
    title: 'Ordner löschen?',
    description: 'Die Reviews bleiben erhalten.',
    confirmLabel: 'Ordner löschen',
  };

  it('renders Abbrechen + a danger confirm and wires both', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog {...base} confirmIcon="delete" onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByRole('dialog', { name: 'Ordner löschen?', hidden: true })).toBeTruthy();

    const confirm = screen.getByRole('button', { name: 'Ordner löschen', hidden: true });
    expect(confirm.className).toContain('text-danger');
    expect(confirm.querySelector('svg')).toBeTruthy();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen', hidden: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('pending shows a busy, disabled confirm; confirmDisabled only disables', () => {
    const { rerender } = render(
      <ConfirmDialog {...base} pending onClose={() => {}} onConfirm={() => {}} />,
    );
    let confirm = screen.getByRole('button', { name: /Ordner löschen/, hidden: true });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    // Cancelling stays possible while the action runs.
    expect(
      (screen.getByRole('button', { name: 'Abbrechen', hidden: true }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    rerender(<ConfirmDialog {...base} confirmDisabled onClose={() => {}} onConfirm={() => {}} />);
    confirm = screen.getByRole('button', { name: 'Ordner löschen', hidden: true });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(confirm.hasAttribute('aria-busy')).toBe(false);
  });

  it('shows the error as an alert after the content', () => {
    render(
      <ConfirmDialog {...base} error="Keine Berechtigung" onClose={() => {}} onConfirm={() => {}}>
        <p>Inhalt</p>
      </ConfirmDialog>,
    );
    const alert = screen.getByRole('alert', { hidden: true });
    expect(alert.textContent).toBe('Keine Berechtigung');
    expect(alert.className).toContain('text-body');
    expect(alert.className).toContain('text-danger');
    expect(
      screen.getByText('Inhalt').compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('has no alert without an error', () => {
    render(<ConfirmDialog {...base} error={null} onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
  });

  it('puts extra actions between cancel and confirm; primary tone', () => {
    render(
      <ConfirmDialog
        {...base}
        tone="primary"
        confirmLabel="Löschen"
        extraActions={<Button variant="secondary">Nur Kommentar löschen</Button>}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    const names = screen
      .getAllByRole('button', { hidden: true })
      .map((button) => button.textContent || button.getAttribute('aria-label'));
    expect(names).toEqual(['Schließen', 'Abbrechen', 'Nur Kommentar löschen', 'Löschen']);
    expect(screen.getByRole('button', { name: 'Löschen', hidden: true }).className).toContain(
      'bg-primary',
    );
  });

  it('submits a form in its content with the confirm button (and Enter)', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <ConfirmDialog
        {...base}
        tone="primary"
        confirmLabel="Speichern"
        form="rename"
        onClose={() => {}}
      >
        <form id="rename" onSubmit={onSubmit}>
          <input aria-label="Name" />
        </form>
      </ConfirmDialog>,
    );
    const confirm = screen.getByRole('button', { name: 'Speichern', hidden: true });
    expect(confirm.getAttribute('type')).toBe('submit');
    expect(confirm.getAttribute('form')).toBe('rename');
    await userEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledOnce();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name', hidden: true }), 'x{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('keeps a type=button confirm without a form', () => {
    render(<ConfirmDialog {...base} onClose={() => {}} onConfirm={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Ordner löschen', hidden: true }).getAttribute('type'),
    ).toBe('button');
  });
});
