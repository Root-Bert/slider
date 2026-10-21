import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDeck } from '../lib/deck-fixture';
import { DeckTitleInput } from './DeckTitleInput';

const api = vi.hoisted(() => ({ mutate: vi.fn(), pending: false }));

vi.mock('@/lib/api', () => ({
  useUpdateDeck: () => ({ mutate: api.mutate, isPending: api.pending }),
}));

function setup() {
  const onDone = vi.fn();
  const onNotify = vi.fn();
  render(<DeckTitleInput deck={makeDeck()} onDone={onDone} onNotify={onNotify} />);
  const input = screen.getByRole('textbox', { name: 'Name der Review' }) as HTMLInputElement;
  return { onDone, onNotify, input };
}

type MutateOptions = { onSuccess: () => void; onError: (error: Error) => void };
const lastOptions = () => api.mutate.mock.calls.at(-1)![1] as MutateOptions;

describe('DeckTitleInput', () => {
  beforeEach(() => {
    api.mutate.mockReset();
    api.pending = false;
  });

  it('starts focused with the whole title selected', () => {
    const { input } = setup();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Q4 Strategie');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Q4 Strategie'.length);
    expect(input.className).toContain('bg-surface-1');
  });

  it('Enter saves the trimmed title once, even with the blur that follows', async () => {
    const { input, onDone } = setup();
    await userEvent.clear(input);
    await userEvent.type(input, '  Q1 Plan  {Enter}');
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(api.mutate).toHaveBeenCalledWith({ title: 'Q1 Plan' }, expect.anything());

    lastOptions().onSuccess();
    expect(onDone).toHaveBeenCalledTimes(1);
    // Still on the input: the card puts the focus back on the title.
    expect(onDone).toHaveBeenCalledWith(true);
    fireEvent.blur(input);
    expect(api.mutate).toHaveBeenCalledTimes(1);
  });

  it('an unchanged or empty title just ends the edit', async () => {
    const { input, onDone } = setup();
    fireEvent.blur(input);
    expect(api.mutate).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);

    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it('Escape cancels without saving and stays inside the input', () => {
    const { input, onDone } = setup();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    fireEvent.change(input, { target: { value: 'Anders' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(api.mutate).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
  });

  it('a failed save reports the error and keeps editing', async () => {
    const { input, onDone, onNotify } = setup();
    await userEvent.type(input, 'X{Enter}');
    input.blur();
    lastOptions().onError(new Error('Keine Berechtigung'));
    expect(onNotify).toHaveBeenCalledWith('Keine Berechtigung', 'danger');
    expect(onDone).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('is read-only while saving and keeps the browser menu on right click', () => {
    api.pending = true;
    const { input } = setup();
    expect(input.readOnly).toBe(true);
    expect(input.maxLength).toBe(200);
    const outer = vi.fn();
    document.addEventListener('contextmenu', outer);
    fireEvent.contextMenu(input);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('contextmenu', outer);
  });
});
