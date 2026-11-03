import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusLoop } from './useFocusLoop';

function Chooser() {
  const panel = useRef<HTMLDivElement>(null);
  useFocusLoop(panel);
  return (
    <>
      <button type="button">Davor</button>
      <div ref={panel} role="toolbar">
        <button type="button">Text</button>
        <button type="button">Form</button>
        <button type="button" disabled>
          Video
        </button>
        <button type="button">Bild</button>
      </div>
      <button type="button">Danach</button>
    </>
  );
}

const focused = () => document.activeElement?.textContent?.trim();

describe('useFocusLoop', () => {
  it('goes round the panel and from a roving item with Tab and ⇧Tab, leaving Tab alone outside it', async () => {
    const user = userEvent.setup();
    render(<Chooser />);
    screen.getByRole('button', { name: 'Davor' }).focus();
    await user.tab();
    expect(focused()).toBe('Text');

    await user.tab();
    expect(focused()).toBe('Form');
    await user.tab();
    expect(focused()).toBe('Bild');
    await user.tab();
    expect(focused()).toBe('Text');
    await user.tab({ shift: true });
    expect(focused()).toBe('Bild');

    // From a roving item at the end it goes round too.
    function Listbox() {
      const panel = useRef<HTMLDivElement>(null);
      useFocusLoop(panel);
      return (
        <div ref={panel}>
          <input aria-label="Suche" />
          <div role="listbox">
            <div role="option" aria-selected tabIndex={-1}>
              Eins
            </div>
            <div role="option" aria-selected={false} tabIndex={-1}>
              Zwei
            </div>
          </div>
        </div>
      );
    }
    render(<Listbox />);
    screen.getByRole('option', { name: 'Zwei' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Suche' }));
    screen.getByRole('option', { name: 'Eins' }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Suche' }));
  });
});
