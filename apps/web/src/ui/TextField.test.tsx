import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('TextField', () => {
  it('uses the field focus ring and fades when disabled', () => {
    render(<TextField label="Name" disabled />);
    const input = screen.getByLabelText('Name');
    const field = input.parentElement!;
    expect(classes(field)).toEqual(
      expect.arrayContaining(['focus-field', 'has-[input:disabled]:opacity-40']),
    );
  });

  it('links the error message', () => {
    render(<TextField label="Name" error="Pflichtfeld" />);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Pflichtfeld',
    );
  });
});
