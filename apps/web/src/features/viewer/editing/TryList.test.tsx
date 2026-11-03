import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FontField } from './FontField';

// The font's list and the size's are one (`useTryList`): hovered or stepped, a choice is tried on
// the text; leaving the list, Esc or a press outside puts it back; a click or ↵ takes it.
it('tries a choice hovered or stepped to, puts it back when let go of and takes the one picked', () => {
  const onTry = vi.fn();
  const onPick = vi.fn();
  render(
    <FontField value="Inter" fonts={['Geist', 'Inter', 'Lora']} onTry={onTry} onPick={onPick} />,
  );
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Schrift: Inter' }));

  open();
  const list = screen.getByRole('listbox', { name: 'Schrift' });
  const option = (name: string) => screen.getByRole('option', { name });
  // The one the text has is ticked while others are tried on.
  expect(option('Inter').getAttribute('aria-selected')).toBe('true');
  fireEvent.pointerEnter(option('Lora'));
  expect(onTry).toHaveBeenLastCalledWith('Lora');
  expect(option('Inter').getAttribute('aria-selected')).toBe('true');
  fireEvent.pointerEnter(option('Geist'));
  expect(onTry).toHaveBeenLastCalledWith('Geist');
  fireEvent.pointerLeave(list);
  expect(onTry).toHaveBeenLastCalledWith(null);
  expect(onPick).not.toHaveBeenCalled();

  // Hovered, then clicked: taken.
  fireEvent.pointerEnter(option('Lora'));
  fireEvent.click(option('Lora'));
  expect(onPick).toHaveBeenCalledWith('Lora');
  expect(screen.queryByRole('listbox')).toBeNull();

  // Stepped with the keys, then Esc: put back, nothing taken.
  onTry.mockClear();
  onPick.mockClear();
  open();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
  expect(onTry).toHaveBeenLastCalledWith('Lora');
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'g' });
  expect(onTry).toHaveBeenLastCalledWith('Geist');
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(onTry).toHaveBeenLastCalledWith(null);
  expect(onPick).not.toHaveBeenCalled();

  // Stepped, then ↵: taken.
  open();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith('Geist');
});
