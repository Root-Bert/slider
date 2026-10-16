import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('Select', () => {
  it('fades disabled to 40 %', () => {
    render(
      <Select
        aria-label="Sortierung"
        value="a"
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
        disabled
      />,
    );
    expect(classes(screen.getByRole('combobox', { name: 'Sortierung' }))).toContain(
      'disabled:opacity-40',
    );
  });
});
