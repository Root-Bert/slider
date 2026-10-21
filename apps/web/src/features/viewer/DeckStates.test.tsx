import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { DeckError } from './DeckStates';

const renderError = (error: Error) =>
  render(
    <MemoryRouter>
      <DeckError error={error} />
    </MemoryRouter>,
  );

describe('DeckError', () => {
  it('offers no retry for a plain missing access', () => {
    renderError(new ApiError(403, 'forbidden', 'Kein Zugriff.'));
    expect(screen.getByText('Kein Zugriff')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });

  it('offers a retry when the server failed', () => {
    renderError(new ApiError(500, 'internal', 'Serverfehler.'));
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });
});
