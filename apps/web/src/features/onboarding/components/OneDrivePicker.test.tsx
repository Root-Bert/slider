import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OneDrivePicker } from './OneDrivePicker';

const LABEL = 'Aus OneDrive / SharePoint wählen';

function setup(props: Partial<Parameters<typeof OneDrivePicker>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onClose: vi.fn(), onShownChange: vi.fn() };
  const all = {
    open: false,
    ready: false,
    frameRef: createRef<HTMLIFrameElement>(),
    pending: false,
    error: null,
    ...handlers,
    ...props,
  };
  const view = render(<OneDrivePicker {...all} />);
  return { ...handlers, ...view, props: all };
}

describe('OneDrivePicker', () => {
  it('closed: a button that opens the picker, with the error as an alert', async () => {
    const { onOpen } = setup({ error: 'Das hat nicht geklappt.' });
    expect(screen.queryByRole('region')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: LABEL }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toBe('Das hat nicht geklappt.');
  });

  it('pending: the button is busy and disabled', () => {
    setup({ pending: true });
    const button = screen.getByRole('button', { name: /Aus OneDrive \/ SharePoint/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('open: a focused region with the frame; Escape and the close button close it', async () => {
    const { onClose, onShownChange } = setup({ open: true });
    const region = screen.getByRole('region', { name: LABEL });
    expect(document.activeElement).toBe(region);
    expect(screen.getByTitle('OneDrive-Dateiauswahl').tagName).toBe('IFRAME');
    expect(onShownChange).toHaveBeenLastCalledWith(true);
    // Until the picker page has loaded, a spinner stands in (once the panel has grown).
    await waitFor(() => expect(screen.getByText('OneDrive wird geladen …')).toBeTruthy());

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Schließen (Esc)' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('no loading hint once the frame is ready', async () => {
    setup({ open: true, ready: true });
    await waitFor(() => expect(screen.getByRole('region').dataset['expanded']).toBe('true'));
    expect(screen.queryByText('OneDrive wird geladen …')).toBeNull();
  });

  it('closing: shrinks back, then the button returns and takes the focus', async () => {
    const { rerender, props, onShownChange } = setup({ open: true });
    await waitFor(() => expect(screen.getByRole('region').dataset['expanded']).toBe('true'));
    rerender(<OneDrivePicker {...props} open={false} />);
    // Still on the page while it shrinks.
    expect(screen.getByRole('region')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull(), { timeout: 2000 });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: LABEL }));
    expect(onShownChange).toHaveBeenLastCalledWith(false);
  });

  it('Escape does nothing while closed', async () => {
    const { onClose } = setup();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
