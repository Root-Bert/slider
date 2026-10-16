import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('is a labelled status', () => {
    render(<Spinner size="md" label="Wird gespeichert" />);
    expect(screen.getByRole('status', { name: 'Wird gespeichert' }).getAttribute('width')).toBe(
      '16',
    );
  });
});
