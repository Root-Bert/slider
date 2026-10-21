import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Legend } from './Legend';

describe('Legend', () => {
  it('names every part with its value', () => {
    render(
      <Legend
        label="Speicher nach Art"
        items={[
          { key: 'a', label: 'Folien', value: '1 GB', color: 'bg-fg' },
          { key: 'b', label: 'Aufnahmen', value: '2 GB', color: 'bg-fg/45' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(screen.getByRole('list', { name: 'Speicher nach Art' })).toBeTruthy();
    expect(items.map((item) => item.textContent)).toEqual(['Folien1 GB', 'Aufnahmen2 GB']);
  });
});
