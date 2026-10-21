import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SkipToControls } from './SkipToControls';

function Page() {
  return (
    <>
      <SkipToControls targetId="controls" />
      <button>Folie 1</button>
      <div id="controls">
        <button disabled>Aus</button>
        <button>Zeiger</button>
        <button>Freihand</button>
      </div>
    </>
  );
}

describe('SkipToControls', () => {
  it('is the first focus stop and shows only while focused', async () => {
    render(<Page />);
    await userEvent.tab();
    const link = screen.getByRole('link', { name: 'Zu den Bedienelementen' });
    expect(document.activeElement).toBe(link);
    expect(link.className).toContain('not-focus:sr-only');
  });

  it('leads past the slides to the first control, by Enter', async () => {
    render(<Page />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zeiger' }));
    expect(window.location.hash).toBe('');
  });

  it('and by Tab, while ⇧Tab goes back as usual', async () => {
    render(<Page />);
    const link = screen.getByRole('link', { name: 'Zu den Bedienelementen' });
    link.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zeiger' }));
    link.focus();
    expect(fireEvent.keyDown(link, { key: 'Tab', shiftKey: true })).toBe(true);
  });

  it('skips roving-tabindex items and hidden parts', async () => {
    render(
      <>
        <SkipToControls targetId="controls" />
        <div id="controls">
          <div hidden>
            <button>Versteckt</button>
          </div>
          <button tabIndex={-1}>Freihand</button>
          <button>Zeiger</button>
        </div>
      </>,
    );
    screen.getByRole('link', { name: 'Zu den Bedienelementen' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zeiger' }));
  });

  it('leaves Tab alone when there is nothing to go to', () => {
    render(<SkipToControls targetId="controls" />);
    const link = screen.getByRole('link', { name: 'Zu den Bedienelementen' });
    link.focus();
    // `fireEvent` returns false when the default was prevented.
    expect(fireEvent.keyDown(link, { key: 'Tab' })).toBe(true);
  });
});
