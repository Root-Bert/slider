import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Notice } from './Notice';

const iconOf = (container: HTMLElement) => container.querySelector('[data-slot="icon"]');

describe('Notice', () => {
  it('glass variant by default, with the tone icon', () => {
    const { container } = render(<Notice tone="danger">Kaputt</Notice>);
    const box = container.firstElementChild!;
    expect(box.className).toContain('glass');
    expect(box.className).toContain('rounded-panel');
    expect(iconOf(container)?.getAttribute('class')).toContain('text-danger');
    expect(screen.getByText('Kaputt').className).toContain('text-sm');
  });

  it('tinted variant uses the /10 status tint, a title and an alert role', () => {
    render(
      <Notice tone="danger" variant="tinted" title="Anmeldung fehlgeschlagen" role="alert" animated>
        Versuch es noch einmal.
      </Notice>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('bg-danger/10');
    expect(alert.className).toContain('animate-fade-in');
    expect(alert.textContent).toContain('Anmeldung fehlgeschlagen');
    expect(screen.getByText('Versuch es noch einmal.').className).toContain('text-body');
  });

  it('small tinted notice with dismiss and footer', async () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Notice
        tone="info"
        variant="tinted"
        size="sm"
        icon="checkCircle"
        onDismiss={onDismiss}
        footer={<input aria-label="Einladungslink" readOnly value="x" />}
      >
        Link erstellt.
      </Notice>,
    );
    const box = container.firstElementChild!;
    expect(box.className).toContain('bg-info/10');
    expect(box.className).toContain('rounded-control');
    expect(iconOf(container)?.getAttribute('width')).toBe('18');
    expect(screen.getByRole('textbox', { name: 'Einladungslink' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('plain variant: quiet well, icon in the title line', () => {
    const { container } = render(
      <Notice tone="warning" variant="plain" title="Anmeldung nicht eingerichtet">
        Server-Log prüfen.
      </Notice>,
    );
    const box = container.firstElementChild!;
    expect(box.className).toContain('bg-surface-1');
    const title = screen.getByText('Anmeldung nicht eingerichtet');
    expect(title.contains(iconOf(container))).toBe(true);
    expect(screen.getByText('Server-Log prüfen.').className).toContain('text-fg-subtle');
  });

  it('neutral and info have no default icon; icon={false} hides one', () => {
    const { container, rerender } = render(<Notice tone="neutral">a</Notice>);
    expect(iconOf(container)).toBeNull();
    rerender(<Notice tone="info">a</Notice>);
    expect(iconOf(container)).toBeNull();
    rerender(
      <Notice tone="danger" icon={false}>
        a
      </Notice>,
    );
    expect(iconOf(container)).toBeNull();
  });

  it('takes a custom dismiss label', () => {
    render(
      <Notice onDismiss={() => {}} dismissLabel="Hinweis schließen">
        a
      </Notice>,
    );
    expect(screen.getByRole('button', { name: 'Hinweis schließen' })).toBeTruthy();
  });

  it('inline variant: no box, icon and subtle text in one line', () => {
    const { container } = render(
      <Notice tone="warning" variant="inline">
        Dieser Browser unterstützt keine Passkeys.
      </Notice>,
    );
    const box = container.firstElementChild!;
    expect(box.className).toContain('text-fg-subtle');
    expect(box.className).not.toContain('bg-');
    expect(box.className).not.toContain('rounded');
    expect(iconOf(container)?.getAttribute('class')).toContain('text-warning');
    expect(iconOf(container)?.getAttribute('width')).toBe('18');
  });
});
