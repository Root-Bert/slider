import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Button } from '@/ui';

it('renders a kit component in the DOM project', () => {
  render(<Button>Speichern</Button>);
  expect(screen.getByRole('button', { name: 'Speichern' }).getAttribute('type')).toBe('button');
});
